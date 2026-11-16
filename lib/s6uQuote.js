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

// 排程用：從 Yahoo 日線（bars＝[日期, 還原收盤, 收盤]）與 meta 報價（{t 秒, p 價}）挑出「晚於名單資料日 asof 的最新收盤價」，沒有就回 null。
// 優先用最新一根日線；它的收盤是 null（Yahoo 尚未定稿，bars 裡就沒有這一天）時改用 meta 報價，且報價時間須在台北 13:25 之後才算收盤價。
// quoteMax＝可接受的最晚日期（台北 14:10 前不收當天，避免盤中價）；與名單收盤差 25% 以上視為異常。
export function pickQuote(bars, meta, asof, quoteMax, ref) {
  let lq = null; const lb = bars[bars.length - 1];
  if (lb && lb[0] > asof) lq = [lb[0], lb[2]];
  else if (meta && meta.t && meta.p > 0) {
    const mt = new Date(meta.t * 1000 + 8 * 3600e3), md = mt.toISOString().slice(0, 10);
    if (md > asof && mt.getUTCHours() * 60 + mt.getUTCMinutes() >= 13 * 60 + 25) lq = [md, meta.p];
  }
  if (lq && lq[0] <= quoteMax && lq[1] > 0 && Math.abs(lq[1] / ref - 1) < 0.25) return [lq[0], +(+lq[1]).toFixed(2)];
  return null;
}
