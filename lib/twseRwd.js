// 證交所官網介面（www.twse.com.tw/rwd）→ 轉成跟 openapi（STOCK_DAY_ALL、BWIBBU_ALL）相同的列格式。
// 為什麼：openapi 常在收盤後數小時～隔天才更新，官網介面同一天晚上就有。2026-11-13 兩者逐檔比對：
// 收盤價、成交金額完全一致；本益比、淨值比一致；殖利率只差「無股利」openapi 給空值、官網給 0.00（這裡轉成空值對齊）。
const clean = (s) => { const t = String(s ?? '').trim(); return t === '--' || t === '-' ? '' : t; };

// mi＝MI_INDEX?type=ALLBUT0999 的回應；bw＝BWIBBU_d?selectType=ALL 的回應；ymd＝YYYYMMDD
// 回傳 { dayAll, bw } 或丟錯（日期不符、筆數太少）
export function parseRwd(mi, bw, ymd) {
  if (!mi || mi.stat !== 'OK' || !Array.isArray(mi.tables)) throw new Error('MI_INDEX 無資料');
  if (!bw || bw.stat !== 'OK' || String(bw.date) !== ymd || !Array.isArray(bw.data)) throw new Error('BWIBBU_d 日期不符或無資料');
  const t = mi.tables.find((x) => String(x.title || '').includes('每日收盤行情') && Array.isArray(x.data));
  if (!t) throw new Error('找不到每日收盤行情表');
  const f = t.fields, ic = f.indexOf('證券代號'), inm = f.indexOf('證券名稱'), icl = f.indexOf('收盤價'), iam = f.indexOf('成交金額');
  if ([ic, inm, icl, iam].some((i) => i < 0)) throw new Error('欄位名稱改了');
  // 表名帶日期（例：115年11月13日 每日收盤行情），再核對一次，避免拿到別天
  const m = String(t.title).match(/(\d+)年(\d+)月(\d+)日/);
  if (m && `${+m[1] + 1911}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}` !== ymd) throw new Error('收盤行情表日期不符：' + t.title);
  const roc = `${+ymd.slice(0, 4) - 1911}${ymd.slice(4)}`;
  const dayAll = t.data.map((r) => ({ Date: roc, Code: String(r[ic]).trim(), Name: String(r[inm]).trim(), ClosingPrice: clean(r[icl]), TradeValue: clean(r[iam]) }));
  const g = bw.fields, jc = g.indexOf('證券代號'), jn = g.indexOf('證券名稱'), jp = g.indexOf('本益比'), jb = g.indexOf('股價淨值比'), jd = g.indexOf('殖利率(%)');
  if ([jc, jn, jp, jb, jd].some((i) => i < 0)) throw new Error('本益比表欄位名稱改了');
  const bwRows = bw.data.map((r) => { const dy = clean(r[jd]); return { Date: roc, Code: String(r[jc]).trim(), Name: String(r[jn]).trim(), PEratio: clean(r[jp]), PBratio: clean(r[jb]), DividendYield: Number(dy.replace(/,/g, '')) === 0 ? '' : dy }; });
  if (dayAll.length < 1000 || bwRows.length < 800) throw new Error(`筆數太少 ${dayAll.length}/${bwRows.length}`);
  return { dayAll, bw: bwRows };
}

// 往回找最新一個「官網已有資料」且比 openapi 日期新的交易日。candidates＝YYYYMMDD 由新到舊；fetchJ(url)→json。
export async function latestRwd(candidates, fetchJ) {
  for (const ymd of candidates) {
    try {
      const mi = await fetchJ(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`);
      if (mi?.stat !== 'OK') continue;
      const bw = await fetchJ(`https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d?date=${ymd}&selectType=ALL&response=json`);
      return { ymd, ...parseRwd(mi, bw, ymd) };
    } catch (e) { /* 這天沒有或不完整，試前一天 */ }
  }
  return null;
}

// 台北日期 tpDay（YYYY-MM-DD）起往回 back 天內的平日，只留比 openapiAsof（YYYY-MM-DD）新的；今天要台北 14:30 之後才試（收盤資料公布後）
export function rwdCandidates(tpDay, tpMin, openapiAsof, back = 6) {
  const out = [];
  for (let k = 0; k <= back; k++) {
    const d = new Date(Date.parse(tpDay) - k * 864e5), iso = d.toISOString().slice(0, 10), w = d.getUTCDay();
    if (iso <= openapiAsof || w === 0 || w === 6) continue;
    if (k === 0 && tpMin < 14 * 60 + 30) continue;
    out.push(iso.replace(/-/g, ''));
  }
  return out;
}
