// 營收加速度（平衡版／進攻版的排除濾網用）。回測見專案文件《網站變更紀錄-續-長期核心頁》（七）（八）、《全球多因子長期策略-S6U》。
// 定義（與 Python revlib.py 相同）：S3(m)＝m 月起往前 3 個月營收合計；YoY3(m)＝S3(m)／S3(m−12)−1；加速度＝YoY3(L)−YoY3(L−3)，上下限 ±5；
//   任一個月缺值、或分母 0 → 無值（與回測相同：金控等營收可能為負，照算）（NaN，濾網不動它）。L＝最新「已公布」的營收月份（月底快照只用到上個月營收；次月 10 日前公布，沒有前視）。
// 濾網：母體（上市前 300 檔）內有值者的加速度百分位 < 10% → 排除（不進平衡版名單；已持有者會被標賣出）。
export const REV_CUT = 0.10;
export const ymIdx = (ym) => Math.floor(ym / 100) * 12 + (ym % 100) - 1; // 202610 → 月序
export const idxYm = (i) => Math.floor(i / 12) * 100 + (i % 12) + 1;
// h：{ '202610': 營收, ... }；L：月序
function s3(h, L) { let s = 0; for (let j = 0; j < 3; j++) { const v = h[idxYm(L - j)]; if (v == null || !Number.isFinite(v)) return NaN; s += v; } return s; }
function yoy3(h, L) { const a = s3(h, L), b = s3(h, L - 12); return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b - 1 : NaN; }
export function revAcc(h, L) {
  if (!h) return NaN;
  const a = yoy3(h, L), b = yoy3(h, L - 3);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(-5, Math.min(5, a - b)) : NaN;
}
// 把 openapi 一筆（當月、上月、去年當月）合進歷史；L 為資料年月（西元月序）。回傳 true 表示有更新
export function mergeRev(hist, code, L, cur, prevM, lastY) {
  const h = (hist[code] ||= {});
  const put = (idx, v) => { if (Number.isFinite(v)) h[idxYm(idx)] = v; };
  put(L, cur); put(L - 1, prevM); put(L - 12, lastY);
}
// 只留最近 months 個月，避免檔案無限變大
export function trimRev(hist, L, months = 22) {
  for (const c of Object.keys(hist)) { for (const k of Object.keys(hist[c])) if (ymIdx(+k) < L - months + 1) delete hist[c][k]; if (!Object.keys(hist[c]).length) delete hist[c]; }
}
