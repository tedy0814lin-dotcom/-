// MACD 柱狀體「波峰」背離（使用者規則：用柱狀體一段一段的波峰比，不用快慢線；價格還沒反轉時就算）
// 頂背離：柱狀體在 0 以上的一段（波峰），這段的價格高點比上一段更高、但柱狀體峰值比上一段低；
//         這段柱狀體從峰值開始往下縮的第一根確認。連續背離＝連續兩段以上都「價更高、柱更低」。
// 2026-10-29 回測（隔根開盤進場、停損＝這一段的最高點、扣費；31 幣 4 年）：
//   4H 連續頂背離 ≥2 次做空：6R +0.74R（142 筆，前 +0.76／後 +0.71，隨機做空 −0.06R）
//   4H 頂背離＋價格還沒反轉（收盤仍高於上一段高點）做空：6R +0.28R（408 筆，前 +0.36／後 +0.16）
//   12H 頂背離＋價格還沒反轉做空：3R +0.35R（135 筆，前 +0.34／後 +0.38，隨機 −0.07R）
//   底背離做多：各時區都沒贏隨機（日線連續底背離 +1.06R 但只有 39 筆）；台股做多全虧 → 不用
const ema = (x, n) => { const k = 2 / (n + 1); let e = x[0]; return x.map((v, i) => (e = i ? v * k + e * (1 - k) : v)); };
// side = 1 找底背離、-1 找頂背離；回傳所有事件 { i, k（連續次數）, still, stop }
export function macdHumpEvents(B, side) {
  const c = B.map((b) => b.c), n = B.length;
  const e12 = ema(c, 12), e26 = ema(c, 26), dif = c.map((_, i) => e12[i] - e26[i]), sig = ema(dif, 9);
  const Hs = dif.map((d, i) => (d - sig[i]) * side);
  const P = B.map((b) => (side > 0 ? b.l : -b.h)), C = c.map((x) => x * side);
  const ev = []; let prev = null, seg = null;
  for (let i = 35; i < n; i++) {
    if (Hs[i] < 0) {
      if (!seg) seg = { s: i, minH: Hs[i], minP: P[i], fired: false };
      else {
        seg.minH = Math.min(seg.minH, Hs[i]); seg.minP = Math.min(seg.minP, P[i]);
        if (!seg.fired && Hs[i] > Hs[i - 1] && Hs[i - 1] === seg.minH && prev && seg.s - prev.e <= 60 && seg.minP < prev.minP && seg.minH > prev.minH) {
          ev.push({ i, k: prev.chain + 1, still: C[i] < prev.minP, stop: seg.minP * side });
          seg.fired = true;
        }
      }
    } else if (seg) {
      seg.e = i - 1;
      const div = prev && seg.s - prev.e <= 60 && seg.minP < prev.minP && seg.minH > prev.minH;
      seg.chain = div ? prev.chain + 1 : 0;
      prev = seg; seg = null;
    }
  }
  return ev;
}
// 最近 2 根內的頂背離（做空）：回傳 { ago, k, still, entry, stop }
export function macdTopDiv(B) {
  if (!B || B.length < 120) return null;
  const ev = macdHumpEvents(B, -1), x = ev[ev.length - 1], n = B.length;
  if (!x || n - 1 - x.i > 1) return null;
  return { ago: n - 1 - x.i, k: x.k, still: x.still, entry: B[n - 1].c, stop: x.stop };
}
