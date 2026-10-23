// 維加斯通道（EMA12 + 小通道 144/169 + 大通道 288/338）
// 多頭：小通道整條在大通道上面，而且最近 30 根一直維持、通道往上走、兩條通道有拉開（不糾纏）
// 做多步驟：① 價格回到通道（碰小通道或大通道）② 第一次收盤站上 EMA12（突破 K）
//          ③ 回踩 EMA12 有拒絕（下影線 / 收紅、收在 EMA12 上）④ 價格突破「突破 K」的高點 = 確認進場
// 空頭全部反過來：把價格上下翻轉後用同一套邏輯算
// bars: [{o,h,l,c,v,d}] 舊 → 新；d = 主動買 − 主動賣（加密才有）

function ema(a, n) {
  const k = 2 / (n + 1), out = new Array(a.length);
  let e = a[0];
  for (let i = 0; i < a.length; i++) { e = i ? a[i] * k + e * (1 - k) : a[0]; out[i] = e; }
  return out;
}

function prep(B) {
  const c = B.map((b) => b.c);
  const E = { e12: ema(c, 12), e144: ema(c, 144), e169: ema(c, 169), e288: ema(c, 288), e338: ema(c, 338) };
  const atr = new Array(B.length).fill(0);
  let s = 0;
  for (let i = 1; i < B.length; i++) {
    const tr = Math.max(B[i].h, B[i - 1].c) - Math.min(B[i].l, B[i - 1].c);
    s += tr; if (i > 14) s -= Math.max(B[i - 14].h, B[i - 15].c) - Math.min(B[i - 14].l, B[i - 15].c);
    atr[i] = s / Math.min(i, 14);
  }
  const n = B.length, up = new Array(n).fill(false), smooth = new Array(n).fill(false);
  const sTop = (i) => Math.max(E.e144[i], E.e169[i]), sBot = (i) => Math.min(E.e144[i], E.e169[i]);
  const bTop = (i) => Math.max(E.e288[i], E.e338[i]), bBot = (i) => Math.min(E.e288[i], E.e338[i]);
  for (let i = 0; i < n; i++) up[i] = sBot(i) > bTop(i);
  // 平滑：最近 30 根都維持多頭排列、大通道 EMA288 有 80% 的時間往上、兩通道距離至少 0.3 倍 ATR
  for (let i = 30; i < n; i++) {
    let hold = true, rise = 0;
    for (let j = i - 29; j <= i; j++) { if (!up[j]) { hold = false; break; } if (E.e288[j] > E.e288[j - 1]) rise++; }
    smooth[i] = hold && rise >= 24 && sBot(i) - bTop(i) >= 0.3 * atr[i];
  }
  return { E, atr, smooth, sTop, sBot, bTop, bBot };
}

// 用多頭邏輯掃一遍，回傳歷史訊號、通道反應紀錄、現在的狀態
function scan(B, P, s0) {
  const { E, atr, smooth, sTop, sBot, bTop, bBot } = P;
  const n = B.length, events = [], touches = [];
  let st = null;
  for (let i = s0; i < n; i++) {
    const b = B[i], a = atr[i] || 1e-9;
    if (!smooth[i] || b.c < bBot(i) - 0.5 * a) { st = null; continue; } // 結構壞了就重來
    // ① 碰通道
    if (b.l <= sTop(i) + 0.2 * a) {
      const tunnel = b.l <= bTop(i) + 0.2 * a ? '大' : '小';
      if (!st) {
        st = { phase: 'touch', touchIdx: i, tunnel };
        touches.push({ i, tunnel, c: b.c });
      } else if (st.phase === 'touch' && tunnel === '大') st.tunnel = '大';
    }
    if (!st) continue;
    if (st.phase === 'touch') {
      // ② 第一次收盤站上 EMA12
      if (b.c > E.e12[i] && B[i - 1].c <= E.e12[i - 1]) { st.phase = 'broke'; st.bIdx = i; st.bHigh = b.h; }
      else if (i - st.touchIdx > 40) st = null;
      continue;
    }
    if (st.phase === 'broke') {
      if (i - st.bIdx > 10) { st = null; continue; }
      if (b.c < E.e12[i] - 0.3 * a) { st.phase = 'touch'; continue; } // 又跌回去，等下一次突破
      // ③ 回踩 EMA12 有拒絕：碰到（或很接近）EMA12，收在上面，留下影線或收紅
      const range = b.h - b.l || 1e-9, wick = Math.min(b.o, b.c) - b.l;
      if (b.l <= E.e12[i] + 0.15 * a && b.c >= E.e12[i] && (wick >= 0.4 * range || b.c > b.o)) {
        st.phase = 'retest'; st.rIdx = i; st.rLow = b.l;
      }
      continue;
    }
    if (st.phase === 'retest') {
      if (b.c < E.e12[i] - 0.3 * a) { st.phase = 'touch'; continue; }
      if (i - st.rIdx > 8) { st = null; continue; }
      st.rLow = Math.min(st.rLow, b.l);
      // ④ 突破「突破 K」的高點 = 確認
      if (b.h > st.bHigh && i > st.rIdx) {
        const entry = st.bHigh, stop = st.rLow - 0.1 * a;
        let target = -Infinity;
        for (let j = Math.max(0, st.touchIdx - 60); j < st.touchIdx; j++) target = Math.max(target, B[j].h);
        if (!(target > entry)) target = entry + 2 * (entry - stop);
        let flow = 0, vAvg = 0;
        for (let j = st.rIdx; j <= i; j++) flow += B[j].d || 0;
        for (let j = Math.max(0, st.bIdx - 20); j < st.bIdx; j++) vAvg += (B[j].v || 0) / 20;
        events.push({ i, entry, stop, target, tunnel: st.tunnel, flow: B[i].d == null ? null : flow, volUp: vAvg > 0 && B[st.bIdx].v >= 1.2 * vAvg });
        st = null;
      }
    }
  }
  return { events, touches, st };
}

// 歷史統計：訊號打到 1.5 倍風險算贏、先打到停損算輸；通道反應：碰到後 20 根內往上 2 倍 ATR 才算有反應
function stats(B, P, res) {
  let win = 0, loss = 0;
  const byT = { 小: [0, 0], 大: [0, 0] };
  for (const e of res.events) {
    const r = e.entry - e.stop, tp = e.entry + 1.5 * r;
    for (let j = e.i + 1; j < Math.min(B.length, e.i + 80); j++) {
      if (B[j].l <= e.stop) { loss++; break; }
      if (B[j].h >= tp) { win++; break; }
    }
  }
  for (const t of res.touches) {
    const a = P.atr[t.i], floor = (t.tunnel === '小' ? P.sBot(t.i) : P.bBot(t.i)) - 0.3 * a;
    if (t.i + 20 >= B.length) continue;
    let ok = 0;
    for (let j = t.i + 1; j <= t.i + 20; j++) {
      if (B[j].c < floor) break;
      if (B[j].h >= t.c + 2 * a) { ok = 1; break; }
    }
    byT[t.tunnel][0]++; byT[t.tunnel][1] += ok;
  }
  return { win, loss, byT };
}

const flip = (B) => B.map((b) => ({ o: -b.o, h: -b.l, l: -b.h, c: -b.c, v: b.v, d: b.d == null ? null : -b.d }));

// 主函式：回傳這個時區的趨勢、現在的狀態、歷史統計
export function vegas(bars) {
  const n = bars.length;
  if (n < 400) return null;
  const s0 = Math.min(400, n - 60);
  const out = { trend: 0, smooth: false, now: null, inTunnel: 0 };
  const agg = { win: 0, loss: 0, byT: { 小: [0, 0], 大: [0, 0] } };
  for (const dir of [1, -1]) {
    const B = dir > 0 ? bars : flip(bars);
    const P = prep(B);
    const res = scan(B, P, s0);
    const s = stats(B, P, res);
    agg.win += s.win; agg.loss += s.loss;
    for (const t of ['小', '大']) { agg.byT[t][0] += s.byT[t][0]; agg.byT[t][1] += s.byT[t][1]; }
    const L = n - 1;
    if (P.smooth[L]) { out.trend = dir; out.smooth = true; }
    else if (P.sBot(L) > P.bTop(L) && !out.trend) out.trend = dir; // 有排列但不夠平滑
    if (!P.smooth[L]) continue;
    const px = (v) => v * dir;
    // 現在是否在通道裡（最近 3 根碰過）→ 給大週期當背景
    for (let j = L - 2; j <= L; j++) if (B[j].l <= P.sTop(j) + 0.2 * P.atr[j]) out.inTunnel = dir;
    const last = res.events[res.events.length - 1];
    if (last && last.i >= L - 2) {
      const rr = (last.target - last.entry) / (last.entry - last.stop);
      out.now = { dir, status: '確認', tunnel: last.tunnel, ago: L - last.i, entry: px(last.entry), stop: px(last.stop), target: px(last.target), rr,
        flow: last.flow == null ? null : last.flow > 0, volUp: last.volUp };
    } else if (res.st) {
      const st = res.st;
      out.now = { dir, status: st.phase === 'touch' ? '碰通道' : st.phase === 'broke' ? '已突破EMA12' : '回踩完成', tunnel: st.tunnel,
        trigger: st.bHigh != null ? px(st.bHigh) : null };
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  out.stats = {
    n: agg.win + agg.loss, winRate: pct(agg.win, agg.win + agg.loss),
    small: { n: agg.byT['小'][0], rate: pct(agg.byT['小'][1], agg.byT['小'][0]) },
    big: { n: agg.byT['大'][0], rate: pct(agg.byT['大'][1], agg.byT['大'][0]) },
  };
  out.price = bars[n - 1].c;
  return out;
}
