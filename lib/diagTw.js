// 持股診斷（台股）：弱勢／強勢旗標與趨勢分數。定義與 Python 回測 pk/wk3.py 逐行對應（日資料版；月資料版以 10 月線≈200 日線、
// 6-1 月動能≈(t−20)/(t−140)、12 月高點≈250 日高為近似）。scripts/diag.test.mjs 用 scripts/diag_vectors.json（Python 算的期望值）逐檔對照。
// 研究見專案文件《淘汰弱勢留強檢驗》；頁面只描述歷史統計，不構成投資建議。
//
// 價格口徑：Yahoo 原始收盤（含股票分割調整、不含除息調整）——與回測資料集 tw.pkl 完全相同（2026-11-15 實測 40 檔 mom／near／lvl 差 0；Yahoo adjclose 則差 2% 左右，不可用）。
// features(c)：c＝收盤（最舊→最新；缺值用 null／NaN），回傳 { c, ma200, hi250, mom, near, lvl }
//   ma200 ＝ 近 200 根平均（至少 190 個有效值）；hi250 ＝ 近 250 根最高（至少 240）；
//   mom ＝ C[t−20]／C[t−140]−1；near ＝ C／hi250；lvl ＝ C／ma200−1。
// 母體條件（valid）：收盤 ≥ 10、當日有成交量；ok ＝ valid 且 ma200、mom、near 都有值。
// crossSection(rows)：rows＝[{ c, v, ma200, hi250, mom, near, lvl }]，回傳每檔旗標與趨勢分數百分位。
export const MIN_PRICE = 10;
export const LIQ_LOTS = 1000;   // 流動性門檻：20 日均量（張）；這裡只標示，不排除
const fin = Number.isFinite;

function winStat(c, n, minN, kind) {
  const L = c.length, from = Math.max(0, L - n);
  let cnt = 0, s = 0, mx = -Infinity;
  for (let i = from; i < L; i++) { const x = c[i]; if (x != null && fin(x)) { cnt++; s += x; if (x > mx) mx = x; } }
  if (cnt < minN) return NaN;
  return kind === 'mean' ? s / cnt : mx;
}

export function features(c) {
  const L = c.length, last = L ? c[L - 1] : NaN, cur = last != null && fin(last) ? last : NaN;
  const ma200 = winStat(c, 200, 190, 'mean'), hi250 = winStat(c, 250, 240, 'max');
  const a = L > 20 ? c[L - 1 - 20] : NaN, b = L > 140 ? c[L - 1 - 140] : NaN;
  const mom = a != null && b != null && fin(a) && fin(b) ? a / b - 1 : NaN;
  return { c: cur, ma200, hi250, mom, near: cur / hi250, lvl: cur / ma200 - 1 };
}

// 平均名次百分位（跟 pandas rank(pct=True) 相同：同分取平均名次，除以有效個數）
export function pctRank(vals, mask) {
  const idx = [];
  for (let i = 0; i < vals.length; i++) if (mask[i] && fin(vals[i])) idx.push(i);
  idx.sort((x, y) => vals[x] - vals[y]);
  const out = new Array(vals.length).fill(NaN), n = idx.length;
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && vals[idx[j + 1]] === vals[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) out[idx[t]] = avg / n;
    i = j + 1;
  }
  return out;
}

// numpy.percentile（線性內插）
export function percentile(arr, q) {
  const s = arr.filter(fin).sort((x, y) => x - y), n = s.length;
  if (!n) return NaN;
  const pos = (n - 1) * q / 100, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function crossSection(rows) {
  const n = rows.length;
  const valid = rows.map((r) => fin(r.c) && r.c >= MIN_PRICE && fin(r.v) && r.v > 0);
  const ok = rows.map((r, i) => valid[i] && fin(r.ma200) && fin(r.mom) && fin(r.near));
  const pm = pctRank(rows.map((r) => r.mom), ok), pn = pctRank(rows.map((r) => r.near), ok), pl = pctRank(rows.map((r) => r.lvl), ok);
  const tScore = rows.map((_, i) => (ok[i] ? (pm[i] + pn[i] + pl[i]) / 3 : NaN));
  const okIdx = []; for (let i = 0; i < n; i++) if (ok[i]) okIdx.push(i);
  const t20 = percentile(okIdx.map((i) => tScore[i]), 20), t80 = percentile(okIdx.map((i) => tScore[i]), 80), mom20 = percentile(okIdx.map((i) => rows[i].mom), 20);
  const tPct = pctRank(tScore, ok);
  const out = rows.map((r, i) => ({
    valid: valid[i], ok: ok[i], tScore: tScore[i], tPct: tPct[i],
    A: ok[i] && r.c < r.ma200 && r.mom < 0,
    B: ok[i] && r.near <= 0.70,
    C: ok[i] && r.mom <= mom20,
    D: ok[i] && tScore[i] <= t20,
    S: ok[i] && tScore[i] >= t80,
  }));
  return { rows: out, q: { mom20, t20, t80 }, nOk: okIdx.length };
}
