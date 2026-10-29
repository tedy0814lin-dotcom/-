// CVD Oscillator（TradingView，使用者提供）：volDelta = 成交量 ×（收−開）／（高−低）；osc = EMA34(volDelta) − EMA200(volDelta)
// 2026-10-29 回測（隔根開盤進場、停損前 10 根低點、6R 全出、扣費；跟同樣出場的隨機做多比）：
//   上穿 0 做多：台股日線 +0.24R（隨機 +0.06R，12,668 筆，前 +0.27／後 +0.21）
//                加密 12H +0.30R（隨機 +0.09R，3,201 筆，前 +0.44／後 +0.17）
//                加密 4H +0.13R（隨機 +0.01R，9,082 筆，前 +0.13／後 +0.14）
//                加密日線 +0.45R 但隨機也有 +0.34R（只多 0.11R），15 分～2H 都輸隨機 → 不用
//   下穿 0 做空、底背離、頂背離：各時區都不到門檻 → 不用
//   用幣安真實主動買賣量算反而比較差（4H +0.05R）
const ema = (x, n) => { const k = 2 / (n + 1), o = new Array(x.length); let e = x[0]; for (let i = 0; i < x.length; i++) { e = i ? x[i] * k + e * (1 - k) : x[0]; o[i] = e; } return o; };
export function cvdoSeries(B) {
  const vd = B.map((b) => ((b.v || 0) * (b.c - b.o)) / Math.abs(b.h - b.l + 1e-6));
  const f = ema(vd, 34), s = ema(vd, 200);
  return f.map((x, i) => x - s[i]);
}
// 最近 2 根內上穿 0（而且現在還在 0 以上）→ 做多計畫：進場最新收盤、停損上穿那根往前 10 根最低點
export function cvdoCross(B) {
  if (!B || B.length < 250) return null;
  const O = cvdoSeries(B), n = B.length;
  for (let i = n - 1; i >= Math.max(1, n - 2); i--) {
    if (O[i - 1] <= 0 && O[i] > 0) {
      if (O[n - 1] <= 0) return null;
      let lo = Infinity; for (let j = Math.max(0, i - 9); j <= i; j++) lo = Math.min(lo, B[j].l);
      return { ago: n - 1 - i, entry: B[n - 1].c, stop: lo };
    }
  }
  return null;
}

// 使用者規則（2026-10-29 回測後加入）：CVD 一直在跌（震盪在 0 以下 ≥20 根、而且還在往下），突然一根主動買（delta>0）＋爆量（≥ 前 20 根均量 2 倍）→ 看多反轉
//   加密 4H（用幣安真實主動買賣量）：4R +0.26R（454 筆，前 +0.19／後 +0.33，隨機 −0.06R）
//   加密 12H：4R +0.36R（135 筆，前 +0.36／後 +0.36，隨機 −0.01R）
//   台股日線：6R +0.44R（679 筆，前 +0.45／後 +0.42，隨機 +0.13R）
//   做空（一直漲突然轉負爆量）、CVD 背離（價破低 CVD 墊高）各時區都不到門檻 → 不用
// useD：用真實主動買賣量（bar.d = 主動買−主動賣），沒有就用 K 棒估算
export function cvdFlip(B, useD = false) {
  if (!B || B.length < 250) return null;
  const vd = B.map((b) => (useD && b.d != null ? b.d : ((b.v || 0) * (b.c - b.o)) / Math.abs(b.h - b.l + 1e-6)));
  const k1 = 2 / 35, k2 = 2 / 201; let f = vd[0], s = vd[0]; const O = vd.map((x, i) => { if (i) { f = x * k1 + f * (1 - k1); s = x * k2 + s * (1 - k2); } return f - s; });
  const n = B.length; let below = 0, sig = -1;
  for (let i = 0; i < n; i++) {
    if (i >= 21) {
      let a = 0; for (let j = i - 20; j < i; j++) a += B[j].v || 0; a /= 20;
      if (below >= 20 && O[i - 1] < O[i - 6] && vd[i] > 0 && a > 0 && (B[i].v || 0) >= 2 * a) sig = i;
    }
    below = O[i] < 0 ? below + 1 : 0;
  }
  if (sig < 0 || n - 1 - sig > 1) return null;
  let lo = Infinity; for (let j = Math.max(0, sig - 9); j <= sig; j++) lo = Math.min(lo, B[j].l);
  return { ago: n - 1 - sig, entry: B[n - 1].c, stop: lo };
}
// 上穿 0 之前已經在 0 以下 ≥20 根、而且上穿那根量 ≥ 前 20 根均量 1.5 倍（加密 4H：6R +0.24R，823 筆，前 +0.26／後 +0.23，隨機 0R）
export function cvdoCrossStrong(B) {
  const x = cvdoCross(B);
  if (!x) return null;
  const O = cvdoSeries(B), i = B.length - 1 - x.ago;
  let below = 0; for (let j = i - 1; j >= 0 && O[j] < 0; j--) below++;
  let a = 0; for (let j = i - 20; j < i; j++) a += B[j].v || 0; a /= 20;
  return below >= 20 && a > 0 && (B[i].v || 0) >= 1.5 * a ? x : null;
}
