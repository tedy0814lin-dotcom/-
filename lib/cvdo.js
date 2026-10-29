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
