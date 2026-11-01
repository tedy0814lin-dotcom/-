// 日線「大陽線突破 POC」做多（使用者訂單流策略二）：價格原本在 POC 下方，一根大陽線開在 POC 下、收在 POC 上
// POC＝訊號前 60 根日線的成交量分布（每根量均勻分到 high–low，40 格）中量最大的那一格中心
// 條件：前 5 根收盤都在 POC 下；這根實體 ≥ 1.5×ATR14（不含這根）、開在 POC 下、收在 POC 上；
//       下一根開盤進場、停損＝這根最低點再往下 0.1 ATR、4R 全出；停損超過 25% 不做
// 2026-11-01 回測（幣安全部 USDT 永續日線 895 幣、日成交額 ≥500 萬美元、2020 起）：
//   做多 342 筆 4R +0.67R（區間 +0.26～+1.09；原 31 幣 115 筆 +0.95R／新樣本 227 筆 +0.53R，前後半段都賺），隨機做多 +0.07R
//   但「單純一根大陽線（不看 POC）」也有 +0.40R（3,222 筆），POC 額外加分 +0.26R（區間 −0.04～+0.57）→ 優勢主要來自大陽線本身
//   4H +0.08R（不夠）、台股日線 −0.07R（不成立）、做空 +0.48R 但區間跨 0 且 31 幣前半段虧 → 只做多、只用日線
const B = 40;
function atrAt(Bs, i, n = 14) {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n; k < i; k++) {
    const pc = k > 0 ? Bs[k - 1].c : Bs[0].c;
    s += Math.max(Bs[k].h - Bs[k].l, Math.abs(Bs[k].h - pc), Math.abs(Bs[k].l - pc));
  }
  return s / n;
}
function pocOf(Bs, a, b) {
  let pl = Infinity, ph = -Infinity;
  for (let k = a; k < b; k++) { pl = Math.min(pl, Bs[k].l); ph = Math.max(ph, Bs[k].h); }
  if (!(ph > pl)) return null;
  const w = (ph - pl) / B, vol = new Array(B).fill(0);
  for (let k = a; k < b; k++) {
    const { l, h, v } = Bs[k], rng = Math.max(h - l, (ph - pl) * 1e-6);
    for (let j = 0; j < B; j++) {
      const lo = pl + j * w, hi = lo + w;
      const ov = Math.min(hi, h) - Math.max(lo, l);
      if (ov > 0) vol[j] += (ov / rng) * v;
    }
  }
  let m = 0;
  for (let j = 1; j < B; j++) if (vol[j] > vol[m]) m = j;
  return pl + (m + 0.5) * w;
}
export function pocBreakAt(Bs, i, N = 60, M = 5) {
  if (i < N + M) return null;
  const a = atrAt(Bs, i);
  if (!a) return null;
  const x = Bs[i];
  if (!(x.c - x.o >= 1.5 * a)) return null;
  const poc = pocOf(Bs, i - N, i);
  if (poc == null) return null;
  for (let k = i - M; k < i; k++) if (!(Bs[k].c < poc)) return null;
  if (!(x.o < poc && poc < x.c)) return null;
  return { poc, entry: x.c, stop: x.l - 0.1 * a };
}
// 單純大陽線（不看 POC）：實體 ≥ 1.5 ATR 的陽線，進場＝收盤、停損＝這根最低點 − 0.1 ATR
export function bigBull(Bs) {
  if (!Bs || Bs.length < 70) return null;
  const i = Bs.length - 1, a = atrAt(Bs, i), x = Bs[i];
  if (!a || !(x.c - x.o >= 1.5 * a)) return null;
  return { entry: x.c, stop: x.l - 0.1 * a, ago: 0 };
}
// 最後一根已收盤日線剛出現的訊號
export function pocBreak(Bs) {
  if (!Bs || Bs.length < 70 || Bs[Bs.length - 1].v == null) return null;
  const x = pocBreakAt(Bs, Bs.length - 1);
  return x ? { ...x, ago: 0 } : null;
}
// 日線 POC 空方吞噬做空（B 型）：價格原本在 POC 上方（前一根收盤 > POC），這根陰線吞噬前一根陽線的實體，而且這根自己碰到 POC
// POC＝這根之前 60 根日線的成交量分布最大格；進場＝收盤、停損＝這根最高點（吞噬 K 棒頂部），4R 全出，停損超過 25% 不做
// 2026-11-01 回測（成交額前 150 幣、不含原 31 幣，扣 0.1% 費用）：1,260 筆 4R +0.34R（90% 區間 +0.16～+0.51，前 +0.33／後 +0.35，隨機 −0.02R）；
//   原 31 幣另外 844 筆 +0.31R；不看 POC 只看空方吞噬 +0.14R → POC 額外貢獻約 +0.2R。逐年 2021～2025 為正、2020（38 筆）−0.56R、2026 −0.06R。
//   做多（多方吞噬）所有時區都沒有穩定優勢；12H／4H 做空不穩或不足；1H 以下全部虧。
export function pocEngulfShort(Bs) {
  if (!Bs || Bs.length < 70 || Bs[Bs.length - 1].v == null) return null;
  const i = Bs.length - 1, x = Bs[i], q = Bs[i - 1];
  if (!(x.c < x.o && q.c > q.o && x.o >= q.c && x.c <= q.o)) return null;
  const poc = pocOf(Bs, i - 60, i);
  if (poc == null || !(q.c > poc) || !(x.l <= poc && poc <= x.h)) return null;
  return { poc, entry: x.c, stop: x.h, ago: 0 };
}
