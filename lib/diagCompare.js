// 診斷頁：持股 vs 三因子「平衡（含營收濾網）」名單的對照。只描述策略規則怎麼排、持股落在哪、差在哪個因子，不是買賣建議。
// 規則與計畫一律重用策略頁的 lib/s6uPlan.js（planMonth）與 lib/s6uState.js（buildListInfo），數字與策略頁一致。
// 規則：持有名次 > 緩衝(2)×目標檔數、或已不在名單才賣；目標檔數 N 依總資金（每檔約 3 萬）落在 3～15；月底名單才是正式名單。
import { buildListInfo, tierOk } from './s6uState.js';
import { planMonth, PLAN_DEFAULTS } from './s6uPlan.js';

export const VER = 'R';              // 平衡（含營收濾網）
export const GAP_WEAK = 0.10;        // 因子百分位低於目標名單平均 0.10 以上才標「偏弱」：慣例門檻，沒有回測支持
export const FACTORS = [['value', '價值'], ['lowvol', '低波動'], ['trend', '趨勢']];
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// holds：[{code, shares, px, cost?}]（shares>0、px>0）；cash：可再投入的現金
export function compareHoldings({ data, holds, cash = 0 }) {
  if (!data?.list?.length) return { error: '三因子名單讀不到' };
  if (!tierOk(data, VER)) return { error: '今天平衡版（含營收濾網）名單的輔助資料不足，無法比較' };
  const info = buildListInfo(data, 'final', VER) || buildListInfo(data, 'preview', VER);
  if (!info) return { error: '找不到平衡版的正式名單' };
  const live = new Map(data.list.map((x) => [x.code, x]));
  const rankOf = new Map(info.list.map((x) => [x.code, x.rank]));
  const plan = planMonth({ list: info.list, holdings: holds.map((h) => ({ code: h.code, shares: h.shares, px: h.px })), cash: Math.max(0, cash || 0), params: { ...PLAN_DEFAULTS, nMax: 15 } });
  const { N, lim } = plan, sellMap = new Map(plan.sells.map((s) => [s.code, s]));
  const rows = holds.map((h) => {
    const x = live.get(h.code), rank = rankOf.get(h.code) ?? null, mv = h.shares * h.px;
    const base = { code: h.code, shares: h.shares, px: h.px, mv, name: x?.name || '' };   // mv＝持股市值；value 留給「價值因子」
    if (!x) return { ...base, status: 'outside' };                       // 不在前 300 大上市股的母體內
    const f = { value: x.value, lowvol: x.lowvol, trend: x.trend, score: x.score, ind: x.ind || '' };
    const filteredNow = x.rankM == null;                                   // 最新資料已被營收濾網排除（月底名單不一定反映）
    const status = sellMap.has(h.code) ? 'sell' : rank != null && rank <= N ? 'core' : 'buffer';
    return { ...base, ...f, status, rank: rank >= 999 ? null : rank, liveRank: x.rankM ?? null, filteredNow, sellReason: sellMap.get(h.code)?.reason || '' };
  });
  // 因子輪廓：組合（市值加權，只含名單內的持股）對規則目標名單（前 N 名等權）
  const inList = rows.filter((r) => r.mv > 0 && r.status !== 'outside'), totalV = rows.reduce((s, r) => s + (r.mv || 0), 0), listV = inList.reduce((s, r) => s + r.mv, 0);
  const target = info.list.filter((x) => x.rank <= N).map((x) => live.get(x.code)).filter(Boolean);
  const profile = FACTORS.map(([k, label]) => {
    const p = listV > 0 ? inList.reduce((s, r) => s + r[k] * r.mv, 0) / listV : null, t = mean(target.map((x) => x[k])), all = mean(data.list.map((x) => x[k]));
    const gap = p != null && t != null ? p - t : null;
    return { k, label, port: p, target: t, all, gap, verdict: gap == null ? null : gap <= -GAP_WEAK ? 'weak' : gap >= GAP_WEAK ? 'strong' : 'same' };
  });
  const weakest = profile.filter((x) => x.gap != null && x.gap < 0).sort((a, b) => a.gap - b.gap)[0] || null;
  // 補強候選：規則目標名單裡你還沒持有的，依你最弱的因子由高到低（沒有偏弱因子就依名次）
  const heldSet = new Set(holds.map((h) => h.code));
  const cands = info.list.filter((x) => x.rank <= N && !heldSet.has(x.code)).map((x) => ({ ...live.get(x.code), code: x.code, name: x.name, rank: x.rank })).filter((x) => x.value != null)
    .sort((a, b) => (weakest && weakest.verdict === 'weak' ? b[weakest.k] - a[weakest.k] : a.rank - b.rank)).slice(0, 8);
  return { info: { kind: info.kind, month: info.month, day: info.day }, asof: data.asof, N, lim, V: plan.V, cash: Math.max(0, cash || 0), rows, profile, weakest, coverage: totalV > 0 ? listV / totalV : null, plan: { sells: plan.sells, buys: plan.buys.filter((b) => b.status === 'buy'), skips: plan.buys.filter((b) => b.status === 'skip'), keeps: plan.keeps, cashAfter: plan.cashAfter }, cands, universe: data.list.length };
}
