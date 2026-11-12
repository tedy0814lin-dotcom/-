// 大單推升的「頂背離」標記（2026-11-12 起，用來把這類訊號排除出優先名單）。
// 定義（舊簡易版，不是 macdRef 的包絡法）：收盤創 20 日新高，而且 MACD 柱狀體（12/26/9）低於「前 20 日柱峰」（往前 3 天起算）的 80%（柱峰 > 0）。
// 回測（上櫃 2021～2026，扣 0.585%，排除 2026）：帶這個標記的 195 筆每筆比同期 0050 少 4.35%（90% 區間 −6.75～−1.92），前後半皆負；排除後 960 → 810 筆，每筆贏 0050 從 −0.66% 到 +0.02%。
// 注意：新版包絡法頂背離只命中 1% 的訊號，無法用來過濾，所以這裡用舊簡易版。上市股回測沒有穩定重現（見專案文件《台股現有策略統一重測》）。
// closes：收盤價（舊→新），至少 PKDIV_MIN 根（EMA 要暖機；用 60 根與完整歷史的判斷一致率約 98.7%，越長越準）。回傳 1＝有頂背離、0＝沒有、null＝資料不夠。
export const PKDIV_MIN = 60;
export function topDivSimple(c) {
  const n = c.length;
  if (n < PKDIV_MIN) return null;
  const k = (s) => 2 / (s + 1);
  let e12 = c[0], e26 = c[0], sg = 0;
  const hist = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i) { e12 = c[i] * k(12) + e12 * (1 - k(12)); e26 = c[i] * k(26) + e26 * (1 - k(26)); }
    const m = e12 - e26;
    sg = i ? m * k(9) + sg * (1 - k(9)) : m;
    hist[i] = m - sg;
  }
  const t = n - 1;
  let hi = -Infinity; for (let i = t - 19; i <= t; i++) hi = Math.max(hi, c[i]);
  if (!(c[t] >= hi)) return 0;
  let mx = -Infinity; for (let i = t - 22; i <= t - 3; i++) mx = Math.max(mx, hist[i]);
  return mx > 0 && hist[t] < mx * 0.8 ? 1 : 0;
}
