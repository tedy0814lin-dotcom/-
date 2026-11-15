// 持股診斷頁的純函式（不碰 DOM，方便測試）：持股資料驗證／匯出匯入、單檔診斷、組合摘要。
// 規格：專案文件《持股診斷頁規格》。頁面只描述歷史統計，不構成投資建議；成本價只用來算損益與回本幅度，不影響任何判斷。
import { DIAG_STATS } from './diagStats.js';
import { DIAG_RECOVER } from './diagRecover.js';

export const FLAG_BITS = { A: 1, B: 2, C: 4, D: 8, S: 16 };
export const FLAG_TEXT = {
  A: { name: '弱 A', rule: '收盤跌破 200 日線，且 6-1 動能 < 0' },
  B: { name: '弱 B', rule: '收盤距 250 日高點回落 ≥ 30%' },
  C: { name: '弱 C', rule: '6-1 動能在全體排最後 20%' },
  D: { name: '弱 D', rule: '趨勢分數在全體排最後 20%' },
  S: { name: '強勢', rule: '趨勢分數在全體排最前 20%' },
};
export const SINGLE_WEIGHT_WARN = 0.30; // 單檔占組合市值提醒線：慣例，沒有回測支持，只作集中度提醒

// ---- 持股資料 ----
const num = (x) => (x === '' || x == null ? null : Number(x));
export function normalizeHolding(h) {
  const code = String(h?.code ?? '').trim();
  if (!/^\d{4}$/.test(code)) return { error: `代號要是 4 碼數字（收到「${code}」）` };
  const shares = num(h.shares), cost = num(h.cost);
  if (shares != null && (!Number.isFinite(shares) || shares < 0)) return { error: `${code} 的股數不正確` };
  if (cost != null && (!Number.isFinite(cost) || cost <= 0)) return { error: `${code} 的成本價要大於 0（不想填就留空）` };
  return { holding: { code, shares: shares ?? 0, cost: cost ?? null } };
}
export function upsertHolding(list, h) {
  const r = normalizeHolding(h); if (r.error) return { list, error: r.error };
  const i = list.findIndex((x) => x.code === r.holding.code);
  const out = list.slice(); if (i >= 0) out[i] = r.holding; else out.push(r.holding);
  return { list: out };
}
export function exportHoldings(list) { return JSON.stringify({ v: 1, kind: 'wr_diag', holdings: list }, null, 1); }
export function parseHoldings(text) {
  let j; try { j = JSON.parse(text); } catch { return { error: '不是有效的 JSON 檔' }; }
  const arr = Array.isArray(j) ? j : j?.holdings;
  if (!Array.isArray(arr)) return { error: '找不到持股清單（holdings）' };
  let list = [], errs = [];
  for (const h of arr) { const r = upsertHolding(list, h); if (r.error) errs.push(r.error); else list = r.list; }
  if (errs.length && !list.length) return { error: errs[0] };
  return { list, skipped: errs };
}

// ---- 快照列（pp_diag.json 的 rows[code] 陣列）→ 具名欄位 ----
export function rowObj(row, cols) { if (!row) return null; const o = {}; cols.forEach((k, i) => { o[k] = row[i]; }); return o; }
export const flagsOf = (mask) => Object.fromEntries(Object.entries(FLAG_BITS).map(([k, b]) => [k, !!((mask | 0) & b)]));

// ---- 單檔診斷 ----
// h：{code, shares, cost}；row：rowObj 結果或 null；s6：策略頁三因子名單中的該檔（或 null）
export function diagnose(h, row, s6) {
  const r = { code: h.code, shares: h.shares || 0, cost: h.cost ?? null, name: row?.name || s6?.name || '', found: !!row, inUniverse: !!row?.ok };
  if (/^00/.test(h.code)) return { ...r, status: 'etf' }; // 00 開頭是 ETF：回測母體只有個股，不套用旗標與機率
  if (!row) return { ...r, status: 'notfound' };
  r.px = row.px; r.value = r.shares > 0 && row.px > 0 ? r.shares * row.px : 0;
  if (r.cost != null && row.px > 0) { r.pnl = row.px / r.cost - 1; r.needGain = row.px < r.cost ? r.cost / row.px - 1 : 0; } // 成本只用在損益與回本幅度
  r.liqLow = row.v20 < 1000; r.v20 = row.v20;
  if (!row.ok) return { ...r, status: 'outside' };            // 價格 <10 元或歷史不足：不在歷史統計母體
  r.flags = flagsOf(row.flags); r.tPct = row.tPct; r.tScore = row.tScore;
  r.vals = { px: row.px, ma200: row.ma200, hi250: row.hi250, mom: row.mom, near: row.near };
  r.s6 = s6 ? { value: s6.value, lowvol: s6.lowvol, trend: s6.trend, score: s6.score, rank: s6.rank, rankM: s6.rankM ?? null, ind: s6.ind || '' } : null;
  r.status = 'ok';
  return r;
}

// ---- 歷史統計列（只描述）----
export function statRow(g, hold = 3) {
  const b = DIAG_STATS.bt.byHold[hold], v = DIAG_STATS.val.byHold[hold], x = b?.groups?.[g]; if (!x) return null;
  const y = v?.groups?.[g], z = DIAG_STATS.bt.byHold[6]?.groups?.[g];
  return { g, ex: x.ex, lo: x.lo, hi: x.hi, pWeak: x.pWeak, pStrong: x.pStrong, pMid: 100 - x.pWeak - x.pStrong, pUp: x.pUp, pUp10: x.pUp10, val: y ? { ex: y.ex, lo: y.lo, hi: y.hi, months: DIAG_STATS.val.months?.[String(hold)] } : null, ex6: z ? z.ex : null, months: DIAG_STATS.bt.months?.[String(hold)] };
}
export function baseRow(hold = 3) { const x = DIAG_STATS.bt.byHold[hold]?.base; return x ? { pWeak: x.pWeak, pStrong: x.pStrong, pMid: 100 - x.pWeak - x.pStrong, pUp: x.pUp, pUp10: x.pUp10 } : null; }

// ---- 組合摘要 ----
export function summarize(results) {
  const okR = results.filter((r) => r.status === 'ok' || r.status === 'outside');
  const total = okR.reduce((s, r) => s + (r.value || 0), 0);
  const w = (r) => (total > 0 ? (r.value || 0) / total : null);
  const weakValue = results.filter((r) => r.status === 'ok' && r.flags.A).reduce((s, r) => s + (r.value || 0), 0);
  const strongValue = results.filter((r) => r.status === 'ok' && r.flags.S).reduce((s, r) => s + (r.value || 0), 0);
  const warns = [];
  for (const r of okR) { const x = w(r); if (x != null && x > SINGLE_WEIGHT_WARN) warns.push(`${r.code} ${r.name} 占組合市值 ${(x * 100).toFixed(0)}%，超過 ${SINGLE_WEIGHT_WARN * 100}% 的集中度提醒線（慣例，非回測結果）`); }
  const ind = {}; for (const r of results) if (r.s6?.ind && r.value) ind[r.s6.ind] = (ind[r.s6.ind] || 0) + r.value;
  const indTotal = Object.values(ind).reduce((s, x) => s + x, 0), top = Object.entries(ind).sort((a, b) => b[1] - a[1])[0];
  if (top && indTotal > 0 && top[1] / indTotal > 0.5 && Object.keys(ind).length > 1) warns.push(`有產業別資料的持股中，${top[0]} 占 ${(top[1] / indTotal * 100).toFixed(0)}%，超過一半`);
  return { total, weights: Object.fromEntries(okR.map((r) => [r.code, w(r)])), weakShare: total > 0 ? weakValue / total : null, strongShare: total > 0 ? strongValue / total : null, warns };
}

// ---- 三種行動的歷史統計（只描述；來源與日期見各欄；不含稅、股利、滑價）----
export const ACTION_STATS = {
  source: '研究程式 tw2/wk6.py（2026-11-15 重跑核對）；母體＝上市＋上櫃全部個股；持有 3 個月；換股扣來回 0.585%；不含稅、股利差、滑價',
  // 弱 A 股票 vs 0050（3 個月，回測 240 個月 2005-10～2025-12；2026 驗證 7 個訊號月）
  weakVs0050: {
    bt: { months: 240, weak: 1.38, same: 3.37, etf: 3.49, diff: -2.11, lo: -2.89, hi: -1.39, losePct: 66, swap0050: 1.52, swapTop20: 3.78 },
    val: { months: 7, weak: 1.67, same: 6.30, etf: 19.39, diff: -17.72, lo: -25.76, hi: -9.97, losePct: 86, swap0050: 17.14, swapTop20: 5.59 },
  },
  strongTop20vs0050: '趨勢分數前 20 名的名單：回測期每月平均贏 0050 約 +0.6～+0.9%，但信賴區間多半含 0；去掉最賺的 10% 月份後轉負；最大回撤約 −71～−73%（0050 −54%）；2026 前 9 個月輸 0050（約 +29～+74% 對 +109.7%）→ 未通過變更準則，所以本頁不列個股名單。',
  s6u: {
    note: '三因子（價值＋低波動＋趨勢）每月定期定額，上市前 300 大，15 檔規則，2005-10～2025（含 2008，扣成本）。2008 年沒有比較抗跌。',
    bt: { base: { cagr: 17.9, mdd: -53 }, bal: { cagr: 21.4, mdd: -56 }, balF: { cagr: 25.1, mdd: -56 }, etf: { cagr: 14.8, mdd: -54 } },
    alpha: '對 0050 的 alpha 年化 +11.1%／+14.8%／+17.6%（t 約 3.5～3.7），有選策略時的挑選偏誤，請打折看',
    y2026: { months: 10, base: 58.5, bal: 43.8, balF: 79.1, etf: 63.2 },
  },
};

// ---- 回本機率（歷史）：成本價只用來換算「需要再漲多少」，統計本身與成本價無關 ----
// needGain＝成本/現價−1。統計是「月底收盤在 H 個月內曾回到現價 +x%」，x 取最接近 needGain 的檔位（對數距離）。
export const RECOVER_MIN_GAIN = 0.08;   // 需漲不到 8%：幅度太小，不另列
export function recoverBucket(needGain) {
  const xs = DIAG_RECOVER.xs; if (!(needGain >= RECOVER_MIN_GAIN)) return null;
  let j = 0, best = Infinity; xs.forEach((x, i) => { const d = Math.abs(Math.log(needGain * 100 / x)); if (d < best) { best = d; j = i; } });
  return { j, x: xs[j], beyond: needGain * 100 > xs[xs.length - 1] * 1.5, exact: Math.abs(needGain * 100 - xs[j]) / xs[j] < 0.2 };
}
export function recoverRows(flags, needGain) {
  const b = recoverBucket(needGain); if (!b) return null;
  const names = { A: '弱A', B: '弱B', D: '弱D', S: '強' };
  const gs = ['A', 'B', 'D', 'S'].filter((k) => flags[k]).map((k) => names[k]); gs.push('全體');
  const cell = (src, g, h) => { const v = src.g?.[g]?.[h]; return v ? { p: v.p[b.j], lo: v.lo[b.j], hi: v.hi[b.j], dn20: v.dn20 } : null; };
  return { b, rows: gs.map((g) => ({ g, m6: cell(DIAG_RECOVER.bt, g, '6'), m12: cell(DIAG_RECOVER.bt, g, '12'), v6: cell(DIAG_RECOVER.val, g, '6') })), months: DIAG_RECOVER.bt.months, valMonths: DIAG_RECOVER.val.months };
}
