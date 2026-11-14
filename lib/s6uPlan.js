// 長期核心策略（S6-U）的「每月定期定額」操作規則：給定本月名單、目前持股、現金，算出該賣什麼、先買什麼、各買幾股。
// 規則是 Python 回測 all/tw2/dca_real.py sim() 的逐步移植（回測的 XIRR 就是用這套規則算的），scripts/s6uPlan.test.mjs 用隨機情境逐筆對照。
//
//  N（持股檔數）＝ clamp( floor(總資產 V / perName), nLow, nMax )；2026-11-14 起 nMax＝15，且 nLow＝min(15, max(3, floor(V / minTicket)))，即每檔至少 minTicket（3,000 元）、最少 3 檔、最多 15 檔（V≥4.5 萬就是 15 檔）；此前是每檔至少 3 萬、5～10 檔。V＝現金＋持股市值
//  賣出：持有的股票名次 > band×N（預設 2 倍緩衝，即 N=10 時名次>20），或已不在名單（掉出母體）
//  補進：持股不足 N 檔時，依名次由高到低加入「沒持有」的股票
//  買進：目標＝賣完後的 V / N；依名次由高到低，把每檔補到目標，單筆不到 minTicket（預設 3,000）就跳過（現金留到下個月）
//  實務：零股交易，股數取整數（無條件捨去），手續費 0.1425%、賣出再加證交稅 0.3% 估算。

export const PLAN_DEFAULTS = { perName: 30000, nMin: 15, nFloor: 3, nMax: 15, band: 2, minTicket: 3000, buyFee: 0.001425, sellFee: 0.004425 };

// list: [{code,name,close,rank}]（本月名單，rank 1 起，含所有母體內股票）
// holdings: [{code,shares,px?}]（px＝名單裡找不到時用的最近價格）
// opts.integer=false 時用小數股數、手續費不影響買進金額（只用在跟 Python 回測逐筆對照）
// 使用者排除的股票從名單拿掉，剩下的重新編名次（名次 999＝60 名之外，維持原樣）
export function applyExclude(list, exclude = []) {
  const ex = new Set(exclude); if (!ex.size) return list;
  let k = 0; return list.filter((x) => !ex.has(x.code)).sort((a, b) => a.rank - b.rank).map((x) => (x.rank >= 999 ? x : { ...x, rank: ++k }));
}

// pins：使用者指定一定要持有的股票（必須在名單內；算在 N 檔裡，不會因為名次被賣；沒持有就優先買，必要時賣掉名次最差的持股騰出名額）
// exclude：使用者不想買的股票（從名單移除；已持有的會被標賣出）
export function planMonth({ list: list0, holdings, cash, params = {}, integer = true, pins = [], exclude = [] }) {
  const P = { ...PLAN_DEFAULTS, ...params };
  const excl = new Set(exclude), byAll = new Map(list0.map((x) => [x.code, x]));
  const list = applyExclude(list0, exclude);
  const byCode = new Map(list.map((x) => [x.code, x]));
  const held = new Map();
  for (const h of holdings) if (h.shares > 0) held.set(h.code, { code: h.code, shares: h.shares, px: h.px });
  const priceOf = (c) => { const x = byAll.get(c); return x ? x.close : (held.get(c)?.px ?? 0); };
  const val = (c) => held.get(c).shares * priceOf(c);
  let V = cash; for (const c of held.keys()) V += val(c);
  // 檔數下限：回測驗證的是 5 檔；只有資金少到 5 檔每檔不到最低單筆時（V < 5×minTicket），才降到 nFloor～4 檔，讓小資金不會整個月空手
  const nLow = Math.min(P.nMin, Math.max(P.nFloor, Math.floor(V / P.minTicket)));
  const N = Math.min(P.nMax, Math.max(nLow, Math.floor(V / P.perName)));
  const lim = Math.max(N, Math.round(P.band * N));
  // ---- 賣出 ----
  const sells = [];
  const pinAll = [...new Set(pins)].filter((c) => byCode.has(c)), pinSet = new Set(pinAll.slice(0, N)), ignoredPins = pins.filter((c) => !pinSet.has(c));
  const sellOne = (c, reason) => {
    const x = byCode.get(c), h = held.get(c), px = priceOf(c), nm = (x || byAll.get(c))?.name || '';
    const gross = h.shares * px, net = integer && (x || byAll.get(c)) ? gross * (1 - P.sellFee) : gross;
    sells.push({ code: c, name: nm, shares: h.shares, price: px, rank: x ? x.rank : null, reason, proceeds: net });
    cash += net; held.delete(c);
  };
  for (const c of [...held.keys()]) {
    const x = byCode.get(c), r = x ? x.rank : Infinity;
    if (pinSet.has(c)) continue;
    if (r > lim) sellOne(c, excl.has(c) ? '你設定不買這檔（已排除）' : x ? (r >= 999 ? `名次在 60 名之外（> ${lim}）` : `名次 ${r} > ${lim}`) : '已不在名單（掉出母體，或平衡版排除營收加速度最差 10%）');
  }
  // 指定的股票還沒持有、名額不夠：賣掉名次最差的非指定持股騰出名額
  const needPins = [...pinSet].filter((c) => !held.has(c)).length;
  if (needPins) {
    const worst = [...held.keys()].filter((c) => !pinSet.has(c)).sort((a, b) => (byCode.get(b)?.rank ?? 1e9) - (byCode.get(a)?.rank ?? 1e9));
    while (held.size + needPins > N && worst.length) sellOne(worst.shift(), '騰出名額給你指定的股票（賣掉名次最差的）');
  }
  // ---- 補進名單不足的檔數 ----
  V = cash; for (const c of held.keys()) V += val(c);
  const tgt = V / N;
  const topN = list.filter((x) => x.rank <= N).sort((a, b) => a.rank - b.rank);
  const entries = new Map(); // code → 持有金額（含 0＝新進）
  for (const c of held.keys()) entries.set(c, val(c));
  for (const c of pinSet) if (!entries.has(c)) entries.set(c, 0);
  for (const x of topN) { if (entries.size >= N) break; if (!entries.has(x.code)) entries.set(x.code, 0); }
  // ---- 依名次買進 ----
  const ord = (c) => (byCode.get(c)?.rank ?? 1e9) - (pinSet.has(c) ? 1e6 : 0);
  const order = [...entries.keys()].sort((a, b) => ord(a) - ord(b));
  const buys = [];
  for (const c of order) {
    const x = byCode.get(c), cur = entries.get(c), need = tgt - cur, isNew = !held.has(c);
    const row = { code: c, name: x?.name || '', rank: x?.rank ?? null, price: x?.close ?? 0, isNew, pinned: pinSet.has(c), target: tgt, current: cur, need, shares: 0, amount: 0, status: 'hold' };
    if (need >= P.minTicket && cash >= P.minTicket) {
      const amt = Math.min(need, cash);
      if (amt >= P.minTicket) {
        if (integer) {
          const sh = Math.floor(amt / (row.price * (1 + P.buyFee)));
          const cost = sh * row.price * (1 + P.buyFee);
          if (sh >= 1) { row.shares = sh; row.amount = cost; row.status = 'buy'; cash -= cost; }
          else row.status = 'skip';
        } else { row.shares = amt / row.price; row.amount = amt; row.status = 'buy'; cash -= amt; }
      } else row.status = 'skip';
    } else if (need > 0 && cur === 0) row.status = 'skip'; // 新進但錢不夠買（或缺口 < 最低單筆）
    buys.push(row);
  }
  const keeps = [...held.keys()].map((c) => ({ code: c, rank: byCode.get(c)?.rank ?? null }));
  return { V, N, lim, target: tgt, sells, buys, keeps, cashAfter: cash, params: P, ignoredPins };
}
