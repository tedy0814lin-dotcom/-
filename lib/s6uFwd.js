// 三因子長期（S6-U）前瞻記錄：每個「正式月底」固定當時的前 15 名（保守＝top、平衡＝topM），之後每天用最新收盤標示相對 0050 的報酬；
// 下一個正式月底出現時結算成一筆月報酬（扣換股成本），累積成可以做 alpha／beta 迴歸的月序列。純函式，沒有網路與檔案；scripts/s6uFwd.test.mjs 測。
// 口徑：個股與 0050（snap 的 bench＝0050 當日收盤價，不是還原價）都只看價格、不含股息，兩邊一致；回測是含息的，所以前瞻數字對回測只能看方向與大小，不能逐位比。
export const N_HOLD = 15;
export const BUY = 0.001425, SELL = 0.004425;
export const TIERS = { base: 'top', R: 'topM' };
const px = (v) => (Number.isFinite(v) && v > 0 ? v : null);

export const pickHoldings = (entry, key, n = N_HOLD) => (entry?.[key] || []).slice(0, n).map(([code, name, p]) => ({ code, name, px: p }));

// 等權報酬：holdings 內有現價者的 close/px−1 平均；回傳 {ret, n, miss}
export function markEW(holdings, closeBy) {
  let s = 0, k = 0; const miss = [];
  for (const h of holdings) { const c = px(closeBy.get(h.code)), p0 = px(h.px); if (c && p0) { s += c / p0 - 1; k++; } else miss.push(h.code); }
  return { ret: k ? s / k : null, n: k, miss };
}
// 換股成本：新進名單占 f 比例，賣舊（SELL）買新（BUY）都只發生在換掉的那一部分；首次建倉只有買進成本
export function rebalanceCost(prevCodes, newCodes) {
  if (!prevCodes?.length) return BUY;
  const prev = new Set(prevCodes), f = newCodes.filter((c) => !prev.has(c)).length / Math.max(1, newCodes.length);
  return f * (BUY + SELL);
}
// 0050 兩個日期之間的報酬（bench: [[date, 還原收盤]]）；日期不在表上時取前一個有資料的日子
export function benchRet(bench, d0, d1) {
  const at = (d) => { let v = null; for (const [x, c] of bench || []) { if (x <= d) v = c; else break; } return px(v); };
  const a = at(d0), b = at(d1); return a && b ? b / a - 1 : null;
}
const compound = (rs) => rs.reduce((a, r) => a * (1 + r), 1) - 1;

// rec：{ v:1, periods:[{month,day,holdings:{base,R},cost:{base,R},end:null|{day,exact,ret:{base,R},bench,miss:{base,R}}}], current:null|{...} }
// snap：s6_u.json（asof、list、months、bench）＋可選 extra：{代號:當日收盤}（母體以外持股的補價）。回傳新的 rec（不改原物件）
export function step(recIn, snap) {
  const rec = JSON.parse(JSON.stringify(recIn || { v: 1, periods: [], current: null }));
  const official = (snap.months || []).filter((m) => m.official).sort((a, b) => (a.month < b.month ? -1 : 1));
  const closeBy = new Map((snap.list || []).map((x) => [x.code, x.close]));
  for (const [c, v] of Object.entries(snap.extra || {})) if (!closeBy.has(c)) closeBy.set(c, v); // 掉出母體前 300 名的持股：用證交所全部上市證券當日收盤補價（沒補到就維持缺價，記在 miss）
  const last = () => rec.periods[rec.periods.length - 1];
  for (const e of official) {
    if (rec.periods.some((p) => p.month === e.month)) continue;
    const prev = last();
    // 新的正式月底出現：先結算上一期（用今天的 list 收盤；今天就是該月底時 exact＝true，否則是補算，標 exact＝false）
    if (prev && !prev.end) {
      const ret = {}, miss = {};
      for (const t of Object.keys(TIERS)) { const m = markEW(prev.holdings[t], closeBy); ret[t] = m.ret == null ? null : m.ret - prev.cost[t]; miss[t] = m.miss; }
      prev.end = { day: snap.asof, exact: snap.asof === e.day, ret, bench: benchRet(snap.bench, prev.day, snap.asof), miss };
    }
    const holdings = {}, cost = {};
    for (const t of Object.keys(TIERS)) { holdings[t] = pickHoldings(e, TIERS[t]); cost[t] = rebalanceCost(prev?.holdings?.[t]?.map((h) => h.code), holdings[t].map((h) => h.code)); }
    rec.periods.push({ month: e.month, day: e.day, holdings, cost, end: null });
  }
  const cur = last();
  rec.current = null;
  if (cur && !cur.end) {
    const ret = {}, miss = {};
    for (const t of Object.keys(TIERS)) { const m = markEW(cur.holdings[t], closeBy); ret[t] = m.ret == null ? null : m.ret - cur.cost[t]; miss[t] = m.miss; }
    rec.current = { since: cur.day, asof: snap.asof, ret, bench: benchRet(snap.bench, cur.day, snap.asof), miss };
  }
  return rec;
}
// 摘要：已結算月數、累積報酬（保守／平衡／0050）、每月超額平均；月數 <36 不做 alpha 迴歸
export function summarize(rec) {
  const done = rec.periods.filter((p) => p.end && p.end.bench != null);
  const cum = (f) => compound(done.map(f));
  const ex = (t) => (done.length ? done.reduce((a, p) => a + ((p.end.ret[t] ?? 0) - p.end.bench), 0) / done.length : null);
  return { months: done.length, late: done.filter((p) => !p.end.exact).length, cum: { base: cum((p) => p.end.ret.base ?? 0), R: cum((p) => p.end.ret.R ?? 0), bench: cum((p) => p.end.bench) }, avgExcess: { base: ex('base'), R: ex('R') }, canRegress: done.length >= 36 };
}
