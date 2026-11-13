// 長期核心策略「價值＋低波動＋趨勢」(S6-U) 的排名計算。研究與回測見專案文件《全球多因子長期策略-S6U》。
// 這個檔案是 Python 回測（all/tw2：bt2.py、mf_lib.py、r2.py、univ.py）的逐行移植，scripts/s6u.test.mjs 用 6 個月底的輸入逐檔對照分數。
// 規則：
//  母體＝上市 4 碼股票（代號 [1-9]\d{3}）、收盤 ≥10、當月成交值在「全部證券」中排前 300。
//  三個因子家族（母體內百分位，平均）：
//    價值＝(EP=1/本益比[本益比≤0 或缺值記 0 分]、BP=1/淨值比[缺值整檔排除]、殖利率[缺值記 0 分]) 三者百分位平均
//    低波動＝−(近 12 個月月報酬標準差)[至少 10 個月]
//    趨勢＝(動能 6-1、距近 12 月高點的接近度、站上 10 月均線幅度) 三者百分位平均
//  綜合分＝三家族平均；越高越好。
//  三個版本：保守＝上面的三家族平均；平衡＝(價值＋低波動＋2×趨勢＋產業動能)/5；進攻＝(價值＋0.5×低波動＋2×趨勢＋產業動能)/4.5；產業動能＝母體內各產業 6-1 動能中位數的產業間百分位（成員 ≥3 檔的產業，其餘 0.5）。
// 輸入每檔需要 13 個月底「還原收盤」(最舊→最新，最新＝本期；沒有資料給 null)。

// 證交所「產業別」代號 → 名稱（t187ap03_L）
export const IND_NAMES = { '01': '水泥', '02': '食品', '03': '塑膠', '04': '紡織', '05': '電機機械', '06': '電器電纜', '08': '玻璃陶瓷', '09': '造紙', '10': '鋼鐵', '11': '橡膠', '12': '汽車', '14': '建材營造', '15': '航運', '16': '觀光餐旅', '17': '金融保險', '18': '貿易百貨', '19': '綜合', '20': '其他', '21': '化學', '22': '生技醫療', '23': '油電燃氣', '24': '半導體', '25': '電腦週邊', '26': '光電', '27': '通信網路', '28': '電子零組件', '29': '電子通路', '30': '資訊服務', '31': '其他電子', '32': '文化創意', '33': '農業科技', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活' };
export const MIN_PRICE = 10;
export const TOP_LIQ = 300;
const LOG_MIN = Math.log1p(-0.95);

// 平均名次百分位（跟 pandas rank(pct=True) 相同：同分取平均名次，除以有效個數）
function pctRank(vals, mask) {
  const idx = [];
  vals = vals.map((x) => (Number.isFinite(x) && x !== 0 ? +x.toPrecision(12) : x)); // 去除浮點雜訊，讓「理論上相同」的值正確同分
  for (let i = 0; i < vals.length; i++) if (mask[i] && Number.isFinite(vals[i])) idx.push(i);
  idx.sort((a, b) => vals[a] - vals[b]);
  const out = new Array(vals.length).fill(NaN), n = idx.length;
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && vals[idx[j + 1]] === vals[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) out[idx[t]] = avg / n;
    i = j + 1;
  }
  return out;
}

// 單檔價格因子。hist 長度 13（t−12..t），回傳 null 代表缺資料
export function priceFactors(hist) {
  if (!Array.isArray(hist) || hist.length < 13) return null;
  const h = hist.slice(-13);
  // 月報酬 tr_j (j=1..12 對應 t−11..t)，兩端都有價才有；上限 3.0（跟回測相同）
  const tr = [];
  for (let j = 1; j <= 12; j++) {
    const a = h[j - 1], b = h[j];
    tr.push(a > 0 && b > 0 ? Math.min(b / a - 1, 3.0) : NaN);
  }
  // ---- 低波動：近 12 個月報酬標準差(ddof=1)，至少 10 個 ----
  const v = tr.filter(Number.isFinite);
  let vol = NaN;
  if (v.length >= 10) { const m = v.reduce((s, x) => s + x, 0) / v.length; vol = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); }
  const lg = tr.map((r) => (Number.isFinite(r) ? Math.max(Math.log1p(r), LOG_MIN) : NaN));
  // ---- 動能 6-1：t−6..t−1 六個月報酬(跳過最新一個月)，至少 4 個 ----
  const w6 = lg.slice(5, 11).filter(Number.isFinite); // tr 索引 5..10 對應 t−6..t−1
  const mom = w6.length >= 4 ? Math.expm1(w6.reduce((s, x) => s + x, 0)) : NaN;
  // ---- 距 12 月高點、站上 10 月均線：用累積水準 lvl（NaN 報酬當 0 變動）----
  const lvl = [1]; for (let j = 0; j < 12; j++) lvl.push(lvl[j] * Math.exp(Number.isFinite(lg[j]) ? lg[j] : 0)); // lvl[0..12] 對應 t−12..t
  const cnt12 = lg.filter(Number.isFinite).length;                     // 近 12 個報酬中有效個數
  const prox = cnt12 >= 11 ? lvl[12] / Math.max(...lvl.slice(1, 13)) : NaN; // 近 12 個水準（t−11..t）的最大值
  const l10 = lvl.slice(3, 13), cnt10 = lg.slice(2, 12).filter(Number.isFinite).length;
  const trend = cnt10 >= 9 ? lvl[12] / (l10.reduce((s, x) => s + x, 0) / 10) - 1 : NaN;
  return { vol, mom, prox, trend };
}

// rows: [{code,name,close,amt,pe,pb,dy,hist}]，必須包含全部上市證券（含 ETF），因為成交值排名是在全部證券中排的。
// 回傳 { universe, ranked:[{code,name,close,score,fam:{value,lowvol,trend},raw:{...},rank}] } 依分數由高到低
// 母體遮罩：上市 4 碼股票、收盤 ≥ minPrice、成交值在「全部證券」中排前 topLiq（先篩出來才需要抓歷史價格）
export function universeMask(rows, { topLiq = TOP_LIQ, minPrice = MIN_PRICE } = {}) {
  const amtRank = pctRank(rows.map((r) => -r.amt), rows.map(() => true)); // 以 −成交值排名：越大成交值名次越前
  const nAmt = rows.filter((r) => Number.isFinite(r.amt)).length;
  return rows.map((r, i) => /^[1-9]\d{3}$/.test(r.code) && r.close >= minPrice && Number.isFinite(r.amt) && Math.round(amtRank[i] * nAmt) <= topLiq);
}

export function s6uRank(rows, opts = {}) {
  const n = rows.length;
  const U = universeMask(rows, opts);
  const pf = rows.map((r) => priceFactors(r.hist));
  const num = (x) => (x == null || !Number.isFinite(+x) ? NaN : +x);
  const pe = rows.map((r) => num(r.pe)), pb = rows.map((r) => num(r.pb)), dy = rows.map((r) => num(r.dy));
  const ep = pe.map((x) => (x > 0 ? 1 / x : NaN)), bp = pb.map((x) => (x > 0 ? 1 / x : NaN));
  const pEP = pctRank(ep, U), pBP = pctRank(bp, U), pDY = pctRank(dy, U);
  const pLV = pctRank(pf.map((f) => (f ? -f.vol : NaN)), U);
  const pMO = pctRank(pf.map((f) => (f ? f.mom : NaN)), U), pPX = pctRank(pf.map((f) => (f ? f.prox : NaN)), U), pTR = pctRank(pf.map((f) => (f ? f.trend : NaN)), U);
  // ---- 產業動能（進攻版用）：母體內各股 6-1 動能的「產業中位數」，成員 ≥3 的產業之間排百分位；其他股票給中性 0.5 ----
  const imArr = new Array(n).fill(0.5);
  {
    const g = new Map();
    for (let i = 0; i < n; i++) if (U[i] && rows[i].ind && pf[i] && Number.isFinite(pf[i].mom)) { if (!g.has(rows[i].ind)) g.set(rows[i].ind, []); g.get(rows[i].ind).push(pf[i].mom); }
    const inds = [...g.entries()].filter(([, v]) => v.length >= 3).map(([k, v]) => { const a = v.slice().sort((x, y) => x - y), m = a.length >> 1; return [k, a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2]; });
    const pr = pctRank(inds.map((x) => x[1]), inds.map(() => true)), pm = new Map(inds.map((x, j) => [x[0], pr[j]]));
    for (let i = 0; i < n; i++) if (U[i] && pm.has(rows[i].ind)) imArr[i] = pm.get(rows[i].ind);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!U[i]) continue;
    const value = ((Number.isFinite(pEP[i]) ? pEP[i] : 0) + pBP[i] + (Number.isFinite(pDY[i]) ? pDY[i] : 0)) / 3; // BP 缺值 → NaN → 整檔排除
    const trend = (pMO[i] + pPX[i] + pTR[i]) / 3, lowvol = pLV[i];
    const score = (value + lowvol + trend) / 3;
    if (!Number.isFinite(score)) continue;
    const r = rows[i], f = pf[i];
    const scoreR = (value + lowvol + 2 * trend + imArr[i]) / 5; // 平衡版：趨勢加倍＋產業動能
    const scoreA = (value + 0.5 * lowvol + 2 * trend + imArr[i]) / 4.5; // 進攻版：再把低波動權重減半
    out.push({ code: r.code, name: r.name || '', close: r.close, score, scoreR, scoreA, im: imArr[i], ind: r.ind || null, fam: { value, lowvol, trend },
      raw: { pe: Number.isFinite(pe[i]) ? pe[i] : null, pb: Number.isFinite(pb[i]) ? pb[i] : null, dy: Number.isFinite(dy[i]) ? dy[i] : null, vol: f.vol, mom: f.mom, prox: f.prox, trend: f.trend } });
  }
  out.sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : 1));
  out.forEach((o, i) => { o.rank = i + 1; });
  [...out].sort((a, b) => b.scoreR - a.scoreR || (a.code < b.code ? -1 : 1)).forEach((o, i) => { o.rankR = i + 1; });
  [...out].sort((a, b) => b.scoreA - a.scoreA || (a.code < b.code ? -1 : 1)).forEach((o, i) => { o.rankA = i + 1; });
  return { universe: out.length, ranked: out };
}
