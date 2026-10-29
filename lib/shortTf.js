// 短週期策略（2026-10-29 回測後加入）：CRT 前日區間＋30 分
// （AMD 紐約 15 分、Omor OTE 第二波 15 分重新回測扣費後都虧：−0.08R～−0.21R，沒有加）
// bars: [{t, o, h, l, c}] 舊 → 新，只放已收盤的 K 棒；t = 開盤時間（毫秒，UTC）
// 全部用「做多視角」寫，做空把價格上下翻轉後用同一套邏輯

const flipB = (B) => B.map((b) => ({ t: b.t, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
function fracHi(B, k = 2) {
  const n = B.length, f = new Array(n).fill(false);
  for (let i = k; i < n - k; i++) { let ok = true; for (let j = i - k; j <= i + k; j++) if (B[j].h > B[i].h) { ok = false; break; } f[i] = ok; }
  return f;
}

// 在 [s0, s1) 找：先掃到 lvl 下方 → 收盤站上掃針前最近的轉折高點（CHoCH）→ 這段上漲裡最後一個多方 FVG
// 回傳 { i: CHoCH 那根, top, bot, low }
function sweepChochFvg(B, s0, s1, lvl, maxK) {
  const fh = fracHi(B);
  let sw = -1, low = Infinity;
  for (let i = s0; i < Math.min(s1, B.length); i++) {
    if (sw < 0) { if (B[i].l < lvl) { sw = i; low = B[i].l; } continue; }
    low = Math.min(low, B[i].l);
    let piv = -1;
    for (let p = Math.max(0, sw - 40); p < sw - 1; p++) if (fh[p] && p + 2 <= i - 1) piv = p;
    if (piv < 0) continue;
    if (B[i].c > B[piv].h) {
      let fv = null;
      for (let j = sw + 2; j <= i; j++) if (B[j].l > B[j - 2].h) fv = { top: B[j].l, bot: B[j - 2].h };
      return fv ? { i, ...fv, low } : null;
    }
    if (i - sw > maxK) return null;
  }
  return null;
}

// 已經觸發後，掛單有沒有成交、停損或到目標（給畫面顯示狀態）
function stateAfter(B, from, top, bot, target, waitBars) {
  let filled = -1;
  for (let k = from + 1; k < B.length; k++) {
    if (filled < 0) {
      if (B[k].h >= target) return { state: 'missed' }; // 沒回來就直接走了
      if (B[k].l <= top) { filled = k; if (B[k].l <= bot) return { state: 'stopped' }; continue; }
      if (k - from > waitBars) return { state: 'expired' };
    } else {
      if (B[k].l <= bot) return { state: 'stopped' };
      if (B[k].h >= target) return { state: 'done' };
    }
  }
  return filled < 0 ? { state: 'wait', ago: B.length - 1 - from } : { state: 'in', ago: B.length - 1 - filled };
}

const DAY = 864e5;
const mk = (dir, raw) => (dir > 0 ? raw : { ...raw, entry: -raw.entry, stop: -raw.stop, target: -raw.target });

// CRT：前一天（UTC）K 線區間，今天掃一邊 → 30 分 CHoCH → 回 FVG 掛單、停損 FVG 下緣、目標區間另一端（2R 先出一半，最多 6R）
export function crtSignal(b30, prevDay) {
  if (!b30?.length || !prevDay) return null;
  const out = [];
  for (const dir of [1, -1]) {
    const B = dir > 0 ? b30 : flipB(b30);
    const PH = dir > 0 ? prevDay.h : -prevDay.l, PL = dir > 0 ? prevDay.l : -prevDay.h;
    const day0 = Math.floor(B[B.length - 1].t / DAY) * DAY;
    let s0 = B.findIndex((b) => b.t >= day0); if (s0 < 0) continue;
    const r = sweepChochFvg(B, s0, B.length, PL, 24);
    if (!r) continue;
    // 回測（2026-10-29 重測）：停損放 FVG 下緣太近（中位 0.27%），手續費吃掉 → −0.3R；
    // 停損改放掃針低點、3R 全出 → +0.08R（前後段都賺），所以用這版
    const risk = r.top - r.low;
    if (!(risk > 0)) continue;
    const target = r.top + 3 * risk;
    const st = stateAfter(B, r.i, r.top, r.low, target, 24);
    if (!['wait', 'in'].includes(st.state) || (st.state === 'in' && st.ago > 4)) continue;
    out.push({ dir, ...mk(dir, { entry: r.top, stop: r.low, target }), state: st.state, ago: st.ago, rangeHi: prevDay.h, rangeLo: prevDay.l });
  }
  return out[0] || null;
}
