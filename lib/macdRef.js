// MACD 背離「參考」判讀（只供看圖參考，不計分、不排序、不當訊號）。2026-11-12 新版。
// 用柱狀體一段一段的波峰（0 軸同一側的連續段）比，不用快慢線：
//   頂背離：價格高點一峰比一峰高、柱狀體峰值一峰比一峰低；中間夾的小峰略過（包絡法）。
//   底背離：價格低點一峰比一峰低、柱狀體（負向）一峰比一峰淺。
//   連續次數 chain＝包絡序列裡有幾次「價更極端、柱更弱」。華南金 2026 年就是柱峰 0.73→0.51→0.25、價 38.8→48.3→51 ＝連續 2 次。
//   收斂 conv＝最末峰的 ATR% ÷ 第一峰的 ATR%（<1 代表波動變小）。
// 規格與回測見專案文件「MACD背離新版判讀規格」「多因子系統設計與網站診斷」。回測結論（台股 1,371 檔日線、500 檔週線 2005–2026）：
//   · 日線（含各種分組）之後的報酬跟隨機沒有差別；週線只有「連續 ≥3 次頂背離」有資訊（65 筆，13 週後平均落後大盤 4.2%，前後半都是負）
//   · 「峰縮小越多越準」不成立（縮小一半以上的反而略強）；底背離不偏多
//   · 波動收斂（conv<0.9）時，之後大跌的機率較低（週線 39% vs 45%；日線 26% vs 36%）──收斂後跌破，但跌幅常不大
// 所以這裡只做「判讀得更準、顯示更少雜訊」：價格已經創新高／低而失效的不顯示、柱峰相差無幾（縮小 <15%）的不顯示、確認太久的不顯示。
const ema = (x, n) => { const k = 2 / (n + 1); let e = x[0]; return x.map((v, i) => (e = i ? v * k + e * (1 - k) : v)); };

export const REF_MIN_SHRINK = 0.85;           // 末峰 ÷ 首峰 ≥ 0.85 ＝相差無幾，不顯示
export const REF_CFG = {
  d: { maxSpan: 250, maxAgo: 10, name: '日線' },
  w: { maxSpan: 80, maxAgo: 6, name: '週線' },
};
const NEAR_ATR = 1.5;                          // 價格離該段極值超過 1.5 個 ATR ＝已發動

// side = -1 頂背離、1 底背離。回傳所有柱峰段（含尚未結束的最後一段）
export function humpSegs(B, side) {
  const n = B.length;
  if (n < 60) return null;
  const c = B.map((b) => b.c), h = B.map((b) => b.h), l = B.map((b) => b.l);
  const e12 = ema(c, 12), e26 = ema(c, 26), dif = c.map((_, i) => e12[i] - e26[i]), dea = ema(dif, 9);
  const hist = dif.map((d, i) => (d - dea[i]) * -side);
  const tr = c.map((_, i) => { const pc = i ? c[i - 1] : c[0]; return Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)); });
  let a = tr[0]; const atr = tr.map((v, i) => (a = i ? v / 14 + a * (13 / 14) : v));
  const X = side < 0 ? h : l.map((v) => -v);
  const segs = [];
  let i = 35;
  while (i < n) {
    if (hist[i] > 0) {
      const s = i;
      while (i < n && hist[i] > 0) i++;
      const e = i - 1;
      let pk = s, pi = s;
      for (let q = s; q <= e; q++) { if (hist[q] > hist[pk]) pk = q; if (X[q] > X[pi]) pi = q; }
      segs.push({ s, e, pk, H: hist[pk], P: X[pi], pi, open: i >= n });
    } else i++;
  }
  return { segs, hist, atr, c, h, l, X };
}

// 以第 k 段為最新一峰，往回找價格一峰比一峰高、柱峰一峰比一峰低的包絡序列（略過中間的小峰）
export function chainEnv(segs, k, maxSpan) {
  const mem = [k];
  for (let q = k - 1; q >= 0; q--) {
    const g = segs[q], last = segs[mem[mem.length - 1]];
    if (segs[k].s - g.e > maxSpan) break;
    if (g.P >= last.P) break;
    if (g.H > last.H) mem.push(q);
  }
  return mem.reverse();
}

// 最新一個背離序列的判讀。tf: 'd' | 'w'。回傳 null（沒有）或：
// { side, chain, peaks, ratio, conv, status, ago, distAtr, i0, i1 }
//   status：forming＝柱峰已過、柱狀體還在 0 軸這一側（尚未確認）；active＝已確認、價格離極值 ≤1.5 ATR、沒再創新高；
//           moved＝已確認、價格已離極值 >1.5 ATR（已發動，連續 ≥2 次才顯示）；broken＝之後價格又超過這個極值（失效）；expired＝確認太久
//   show：預設要不要顯示
export function macdRef(B, side, tf = 'd') {
  const cfg = REF_CFG[tf];
  const R = humpSegs(B, side);
  if (!R) return null;
  const { segs, hist, atr, c, X } = R, n = B.length;
  if (!segs.length) return null;
  const k = segs.length - 1, g = segs[k];
  // 最新一段如果已經結束＝已確認；沒結束（柱狀體還在這一側）只有柱峰已經過了才算形成中
  const mem = chainEnv(segs, k, cfg.maxSpan);
  const chain = mem.length - 1;
  if (chain < 1) return null;
  const f = segs[mem[0]];
  const ratio = g.H / f.H;
  const conv = (atr[g.pk] / c[g.pk]) / (atr[f.pk] / c[f.pk]);
  let status, ago = null;
  if (g.open) {
    if (!(hist[n - 1] < g.H)) return null;      // 柱峰還沒過，還在長
    status = 'forming';
  } else {
    const t = g.e + 1; ago = n - 1 - t;
    let mx = -Infinity;
    for (let q = g.e + 1; q < n; q++) mx = Math.max(mx, X[q]);
    const dist = (g.P - (side < 0 ? c[n - 1] : -c[n - 1])) / atr[n - 1];
    if (mx > g.P) status = 'broken';
    else if (ago > cfg.maxAgo) status = 'expired';
    else status = dist > NEAR_ATR ? 'moved' : 'active';
  }
  const ext = side < 0 ? g.P : -g.P;
  const distAtr = side < 0 ? (ext - c[n - 1]) / atr[n - 1] : (c[n - 1] - ext) / atr[n - 1];
  const shrunk = ratio < REF_MIN_SHRINK;
  // 預設顯示：已確認而且價格還在極值附近（有效）；形成中（尚未確認）與已發動（價格已離開）只在連續 ≥2 次時才顯示，單次的雜訊太多
  const show = shrunk && (status === 'active' || ((status === 'forming' || status === 'moved') && chain >= 2));
  return { side, tf, chain, peaks: chain + 1, ratio, conv, status, ago, distAtr, show, i0: f.pi, i1: g.pi, H0: f.H, H1: g.H };
}

// 日線 K 線 → 週線（週一到週五合成一根；最後一根未完成的週不算）。bars 要有 t（毫秒時間戳）
export function toWeekly(B, nowMs = Date.now()) {
  const out = [];
  let cur = null, curKey = null;
  const keyOf = (t) => { const d = new Date(t + 8 * 3600e3); const day = (d.getUTCDay() + 6) % 7; return Math.floor((t + 8 * 3600e3) / 864e5) - day; };
  for (const b of B) {
    if (b.t == null) return [];
    const k = keyOf(b.t);
    if (k !== curKey) { if (cur) out.push(cur); cur = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: b.t }; curKey = k; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  if (cur) out.push(cur);
  // 最後一週：還沒到週五收盤（含）之後就視為未完成
  if (out.length) {
    const last = out[out.length - 1], wk = keyOf(last.t), nowWk = keyOf(nowMs);
    const d = new Date(nowMs + 8 * 3600e3), dow = (d.getUTCDay() + 6) % 7, hr = d.getUTCHours() + d.getUTCMinutes() / 60;
    const nowDone = dow > 4 || (dow === 4 && hr >= 13.6);
    if (wk === nowWk && !nowDone) out.pop();
  }
  return out;
}

// 一檔的完整判讀：日線（用傳入的日線）＋週線（需要 bars 有 t，且至少約 70 週）
export function refAll(B) {
  const out = { d: {}, w: {} };
  for (const [key, side] of [['top', -1], ['bot', 1]]) {
    const d = macdRef(B, side, 'd'); if (d) out.d[key] = d;
  }
  const W = toWeekly(B);
  if (W.length >= 70) for (const [key, side] of [['top', -1], ['bot', 1]]) {
    const w = macdRef(W, side, 'w'); if (w) out.w[key] = w;
  }
  return out;
}

// 給畫面用的文字
export function refText(r) {
  const nm = r.side < 0 ? '頂背離' : '底背離';
  const st = { forming: '形成中（尚未確認）', active: '有效', moved: '已發動', broken: '已失效', expired: '過期' }[r.status];
  const sh = `柱峰縮小 ${Math.round((1 - r.ratio) * 100)}%`;
  const cv = r.conv < 0.9 ? `，波動收斂（ATR% 為首峰的 ${r.conv.toFixed(2)} 倍）` : r.conv > 1.1 ? '，波動放大' : '';
  return `${REF_CFG[r.tf].name}${r.chain >= 2 ? `連續 ${r.chain} 次` : ''}${nm}・${st}・${sh}${cv}`;
}
