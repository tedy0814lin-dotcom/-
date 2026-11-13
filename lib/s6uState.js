// 策略頁「長期核心」的使用者紀錄：資料結構、持股／現金推算、建立每月計畫、匯出匯入。全部是純函式（沒有 DOM），scripts/s6uState.test.mjs 測。
// 紀錄只存在使用者的瀏覽器（localStorage），並可匯出成 JSON 檔備份、換裝置時匯入；不經過伺服器。
//
// state = {
//   v: 1, start: 'YYYY-MM-DD', monthly: 10000, cashAdj: 0（現金校正：領到股息、帳上現金不同時用）,
//   deposits: { 'YYYY-MM': 該月入金合計 }, flows: [{date,amount}]（每次入金／出金的明細，amount 負數＝領出）,
//   manual: [{id,type:'buy'|'sell',code,name,shares,price,date}],          // 開始前就有的持股、或計畫外自己買賣的
//   plans: { 'YYYY-MM': { basis:{kind,month,day}, createdAt, N, target, V, lim, items:[ {id,kind:'buy'|'sell'|'skip',code,name,rank,price,shares,amount,reason,isNew, done,fill:{price,shares,date}} ] } },
// }
import { planMonth, PLAN_DEFAULTS } from './s6uPlan.js';

// 三個版本（回測見 專案文件《全球多因子長期策略-S6U》）：key 對應名單欄位 rank／rankM／rankH、月底記錄 top／topM／topH；三版本都最多 10 檔（分散），差別在強勢股占分數的比重
export const TIERS = {
  base: { label: '保守', rank: 'rank', top: 'top', nMax: 10, need: null },
  R: { label: '平衡', rank: 'rankM', top: 'topM', nMax: 10, need: 'eOk' },   // 需要 3 個月前本益比（EPS 成長）
  A: { label: '進攻', rank: 'rankH', top: 'topH', nMax: 10, need: 'rotOk' }, // 需要產業別（產業動能）
};
export const tierOf = (ver) => TIERS[ver] || TIERS.base;
// 這個版本今天的名單能不能用（缺它需要的輔助資料就不提供）
export const tierOk = (data, ver) => { const T = tierOf(ver); return !T.need || data?.[T.need] === true; };
// 這個版本的計畫參數＋使用者的指定／排除
export const planArgs = (st, ver, params = PLAN_DEFAULTS) => ({ params: { ...params, nMax: tierOf(ver).nMax }, pins: st?.pins || [], exclude: st?.exclude || [] });

export const STATE_VERSION = 1;
export const RULES_VER = 5; // 計畫規則版本：改了規則（例如 nMin 5→3）時，舊的未打勾計畫會自動重算
export const newState = ({ start, monthly = 10000, cash = 0 }) => ({ v: STATE_VERSION, ver: 'base', start, monthly, cashAdj: 0, deposits: cash > 0 ? { [start.slice(0, 7)]: cash } : {}, flows: cash > 0 ? [{ date: start, amount: cash }] : [], manual: [], plans: {}, pins: [], exclude: [] });

const fee = (side, p = PLAN_DEFAULTS) => (side === 'buy' ? p.buyFee : p.sellFee);
let seq = 0; export const uid = () => 't' + Date.now().toString(36) + (seq++).toString(36);

// 所有已成交的買賣（手動＋計畫內打勾的），依日期排序
export function allTrades(st) {
  const t = [];
  for (const m of st.manual || []) t.push({ id: m.id, type: m.type, code: m.code, name: m.name || '', shares: +m.shares, price: +m.price, date: m.date, src: 'manual' });
  for (const [month, p] of Object.entries(st.plans || {})) for (const it of p.items || []) {
    if ((it.kind === 'buy' || it.kind === 'sell') && it.done && it.fill) t.push({ id: it.id, type: it.kind, code: it.code, name: it.name || '', shares: +it.fill.shares, price: +it.fill.price, date: it.fill.date, src: 'plan', month });
  }
  return t.filter((x) => x.shares > 0 && x.price > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

// 推算持股（成本含買進手續費，賣出時依平均成本扣除）、現金、已實現損益
export function derive(st, params = PLAN_DEFAULTS) {
  const pos = new Map(); let cash = (st.cashAdj || 0), realized = 0, invested = 0;
  for (const v of Object.values(st.deposits || {})) { cash += +v || 0; invested += +v || 0; }
  for (const t of allTrades(st)) {
    const gross = t.shares * t.price;
    if (t.type === 'buy') {
      const cost = gross * (1 + fee('buy', params)); cash -= cost;
      const p = pos.get(t.code) || { code: t.code, name: t.name, shares: 0, cost: 0, firstDate: t.date };
      p.shares += t.shares; p.cost += cost; if (t.name) p.name = t.name; pos.set(t.code, p);
    } else {
      const net = gross * (1 - fee('sell', params)); cash += net;
      const p = pos.get(t.code); if (!p) continue; // 賣了沒有紀錄的持股：只加現金
      const sh = Math.min(t.shares, p.shares), avg = p.cost / p.shares;
      realized += net - avg * sh; p.cost -= avg * sh; p.shares -= sh;
      if (p.shares <= 1e-9) pos.delete(t.code);
    }
  }
  return { positions: [...pos.values()], cash, realized, invested };
}

// 把「名單」整理成 planMonth 要的格式：名次取自採用的名單，價格用最新收盤（月底名單的收盤價可能已經過時）
export function buildListInfo(data, which, ver = 'base') {
  const T = tierOf(ver), cur = new Map((data.list || []).map((x) => [x.code, x]));
  const indOf = (c) => cur.get(c)?.ind || null;
  if (!tierOk(data, ver)) return null;
  if (which === 'preview') {
    const l = data.list.filter((x) => x[T.rank] != null).map((x) => ({ code: x.code, name: x.name, close: x.close, rank: x[T.rank], ind: x.ind || null }));
    return { kind: 'preview', ver, month: data.month, day: data.asof, list: l };
  }
  const fm = (data.months || []).find((e) => e.month === data.finalMonth);
  const topx = fm && fm[T.top]; if (!topx) return null;
  // 月底記錄只存前 60 名；名單內但名次在 60 之外的股票，用最新收盤價、名次標 999（＝60 名之外，一定會被標賣出）
  const top = topx.map(([code, name, close, rank]) => ({ code, name: cur.get(code)?.name || name, close: cur.get(code)?.close ?? close, rank, ind: indOf(code) }));
  const seen = new Set(top.map((x) => x.code));
  for (const x of data.list || []) if (!seen.has(x.code)) top.push({ code: x.code, name: x.name, close: x.close, rank: 999, ind: x.ind || null });
  return { kind: 'final', ver, month: fm.month, day: fm.day, list: top };
}

// 建立（或重算）某月的計畫。已打勾的項目保留，其餘依目前持股／現金重新計算
export function makePlan(st, month, info, now = new Date().toISOString().slice(0, 10), params = PLAN_DEFAULTS) {
  const old = st.plans?.[month];
  const done = (old?.items || []).filter((it) => it.done);
  const d = derive(st, params);
  const priceNow = new Map(info.list.map((x) => [x.code, x.close]));
  const pa = planArgs(st, info.ver || 'base', params);
  const r = planMonth({ list: info.list, holdings: d.positions.map((p) => ({ code: p.code, shares: p.shares, px: p.cost / p.shares / (1 + params.buyFee) })), cash: d.cash, ...pa });
  const indOf = new Map(info.list.map((x) => [x.code, x.ind]));
  const items = [...done];
  for (const s of r.sells) items.push({ id: uid(), kind: 'sell', code: s.code, name: s.name || d.positions.find((p) => p.code === s.code)?.name || '', rank: s.rank, price: s.price, shares: s.shares, amount: s.proceeds, reason: s.reason, done: false });
  for (const b of r.buys) {
    if (b.status === 'buy') items.push({ id: uid(), kind: 'buy', code: b.code, name: b.name, rank: b.rank, price: b.price, shares: b.shares, amount: b.amount, isNew: b.isNew, pinned: b.pinned || undefined, target: b.target, done: false });
    else if (b.status === 'skip') items.push({ id: uid(), kind: 'skip', code: b.code, name: b.name, rank: b.rank, price: b.price, shares: 0, amount: 0, reason: `缺口 ${Math.round(b.need).toLocaleString()} 元，不到最低單筆 ${params.minTicket.toLocaleString()} 元（或現金不夠）`, isNew: b.isNew, target: b.target, done: false });
  }
  for (const it of items) if (!it.ind) it.ind = indOf.get(it.code) || null;
  return { rv: RULES_VER, ver: info.ver || 'base', basis: { kind: info.kind, month: info.month, day: info.day }, createdAt: now, N: r.N, lim: r.lim, target: r.target, V: r.V, cashBefore: d.cash, items, priceNow: Object.fromEntries(priceNow) };
}

// 同樣的現金流改買 0050 會怎樣（只比價格報酬，不含股息）。bench: [[date,close]]
export function benchCompare(st, bench, totalValue) {
  if (!bench?.length || !Object.keys(st.deposits || {}).length) return null;
  const px = (date) => { let lo = 0, hi = bench.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bench[m][0] <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans < 0 ? null : bench[ans][1]; };
  const last = bench[bench.length - 1][1]; let sh = 0, inv = 0;
  for (const [m, v] of Object.entries(st.deposits)) {
    const date = m === st.start.slice(0, 7) ? st.start : m + '-01', p = px(date); if (!p) continue;
    sh += v / p; inv += v;
  }
  if (!inv) return null;
  const val = sh * last;
  return { invested: inv, bench: val, mine: totalValue, benchRet: val / inv - 1, mineRet: totalValue / inv - 1 };
}

// ---- 匯出入 ----
export function exportState(st) { return JSON.stringify({ app: 'chip-radar-s6u', exportedAt: new Date().toISOString(), state: st }, null, 1); }
export function parseImport(text) {
  let o; try { o = JSON.parse(text); } catch { throw new Error('檔案不是有效的 JSON'); }
  const st = o?.app === 'chip-radar-s6u' ? o.state : o;
  if (!st || st.v !== STATE_VERSION || typeof st.start !== 'string' || typeof st.deposits !== 'object' || !Array.isArray(st.manual) || typeof st.plans !== 'object') throw new Error('這不是本頁匯出的紀錄檔（格式不對）');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(st.start)) throw new Error('起始日格式不對');
  for (const k of ['pins', 'exclude']) { if (st[k] == null) st[k] = []; else if (!Array.isArray(st[k]) || st[k].some((c) => !/^\d{4}$/.test(c))) throw new Error('「' + (k === 'pins' ? '指定' : '排除') + '」清單格式不對'); }
  for (const m of st.manual) if (!m.code || !(m.shares > 0) || !(m.price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) throw new Error('手動紀錄裡有不完整的買賣：' + JSON.stringify(m).slice(0, 80));
  for (const p of Object.values(st.plans)) for (const it of p.items || []) if (it.done && !(it.fill && it.fill.shares > 0 && it.fill.price > 0)) throw new Error('計畫裡有打勾但沒有成交價／股數的項目：' + it.code);
  return st;
}
