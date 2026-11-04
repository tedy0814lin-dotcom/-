// K 棒型態（依使用者給的兩張圖：吞噬、射擊之星／流星線、錘子線、孕線、黃昏之星、曙光初現、平頭頂／底、貫穿）
// 偏多（買進）：錘子線、多頭吞噬、多頭孕線、貫穿（曙光初現）、晨星、平頭底；偏空（賣出）用鏡像：射擊之星／流星線、空頭吞噬、空頭孕線、烏雲罩頂、黃昏之星、平頭頂。
// 規則（全部用 ATR 當尺度，且要有「前面一段走勢」才算反轉）：
//   前面一段走勢：偏多要「前 5 根收盤下跌 ≥1 ATR」，偏空鏡像。
//   錘子線：下影線 ≥2 倍實體、上影線 ≤ 全長 10%、全長 ≥0.8 ATR、實體 ≥ 全長 5%（避免一字線）。
//   多頭吞噬：前一根陰線（實體 ≥0.3 ATR）、這根陽線實體完整包住前一根實體。
//   多頭孕線：前一根大陰線（實體 ≥0.7 ATR）、這根實體完全在前一根實體內且 ≤ 前一根的一半。
//   貫穿：前一根大陰線（實體 ≥0.7 ATR）、這根陽線開在前一根收盤以下、收在前一根實體中點之上但沒超過前一根開盤。
//   晨星：大陰線（≥0.7 ATR）→ 小實體（≤ 前者 40%、不超過前者收盤上方 0.2 ATR）→ 大陽線收在第一根實體中點之上。
//   平頭底：前一根陰線、這根陽線，兩根最低點差 ≤ 0.15 ATR。
// 這些 K 棒型態在台股／加密都沒有逐一回測過，只當「確認條件」和看圖參考，不單獨計分。
function atr14(B) {
  const o = new Array(B.length); let a = 0;
  for (let i = 0; i < B.length; i++) {
    const pc = i ? B[i - 1].c : B[0].c;
    const tr = Math.max(B[i].h - B[i].l, Math.abs(B[i].h - pc), Math.abs(B[i].l - pc));
    a = i ? a * (1 - 1 / 14) + tr / 14 : tr; o[i] = a;
  }
  return o;
}
export const CANDLE_NAME = {
  hammer: ['錘子線', '射擊之星／流星線'], engulf: ['多頭吞噬', '空頭吞噬'], harami: ['多頭孕線', '空頭孕線'],
  piercing: ['貫穿（曙光初現）', '烏雲罩頂'], star: ['晨星', '黃昏之星'], tweezer: ['平頭底', '平頭頂'],
};
// 偏多版偵測（輸入 bars；偏空版把價格取負號、高低互換後呼叫同一個函式）
function bullAt(B, A, t) {
  const out = [], b = B[t], p = B[t - 1], a = A[t];
  const body = (x) => Math.abs(x.c - x.o), top = (x) => Math.max(x.o, x.c), bot = (x) => Math.min(x.o, x.c);
  if (t < 7) return out;
  const down = B[t - 1].c <= B[t - 6].c - 1.0 * a;
  if (!down) return out;
  const rg = b.h - b.l, bd = body(b);
  if (rg >= 0.8 * a && bd >= 0.05 * rg && (bot(b) - b.l) >= 2 * bd && (b.h - top(b)) <= 0.1 * rg) out.push({ kind: 'hammer', len: 1 });
  const pr = p.c < p.o, pbd = body(p), cg = b.c > b.o;
  if (pr && cg && pbd >= 0.3 * a && b.o <= p.c && b.c >= p.o && bd > pbd) out.push({ kind: 'engulf', len: 2 });
  if (pr && pbd >= 0.7 * a && top(b) <= p.o && bot(b) >= p.c && bd <= 0.5 * pbd && bd > 0) out.push({ kind: 'harami', len: 2 });
  if (pr && pbd >= 0.7 * a && cg && b.o <= p.c && b.c > (p.o + p.c) / 2 && b.c < p.o) out.push({ kind: 'piercing', len: 2 });
  if (pr && cg && Math.abs(b.l - p.l) <= 0.15 * a && pbd >= 0.3 * a) out.push({ kind: 'tweezer', len: 2 });
  if (t >= 8) {
    const f = B[t - 2], m = p, fb = body(f);
    if (f.c < f.o && fb >= 0.7 * a && body(m) <= 0.4 * fb && top(m) <= f.c + 0.2 * a && cg && b.c > (f.o + f.c) / 2) out.push({ kind: 'star', len: 3 });
  }
  return out;
}
const mirror = (B) => B.map((x) => ({ o: -x.o, h: -x.l, l: -x.h, c: -x.c, v: x.v }));
// 掃描最近 2 根內剛出現的 K 棒型態；回傳 [{ kind, dir（1 偏多、-1 偏空）, name, i, ago, len }]
export function candleScan(B) {
  const n = B.length; if (n < 30) return [];
  const A = atr14(B), M = mirror(B), out = [];
  for (let t = n - 2; t <= n - 1; t++) {
    for (const e of bullAt(B, A, t)) out.push({ ...e, dir: 1, name: CANDLE_NAME[e.kind][0], i: t, ago: n - 1 - t });
    for (const e of bullAt(M, A, t)) out.push({ ...e, dir: -1, name: CANDLE_NAME[e.kind][1], i: t, ago: n - 1 - t });
  }
  return out;
}
