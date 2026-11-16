// 持股現價：名單資料（證交所 openapi）常在收盤後數小時才更新，會比 Yahoo 報價晚一個交易日。
// 排程把較新的收盤價放在名單每一檔的 q＝[日期, 收盤價]；比名單資料日 asof 新才採用，否則用名單內的收盤價。
export function quoteOf(item, asof) {
  const q = item && item.q;
  return Array.isArray(q) && typeof q[0] === 'string' && q[0] > asof && Number.isFinite(q[1]) && q[1] > 0 ? { day: q[0], close: q[1] } : null;
}
// 回傳 { close, day } 或 null（找不到這檔）。levCode＝進攻版搭配的正2，價格在 data.lev。
export function priceOf(data, code, levCode) {
  if (!data) return null;
  if (code === levCode) { const l = data.lev; return l && l.close > 0 ? { close: l.close, day: l.day || data.asof } : null; }
  const x = (data.list || []).find((y) => y.code === code);
  if (!x || !(x.close > 0)) return null;
  return quoteOf(x, data.asof) || { close: x.close, day: data.asof };
}
