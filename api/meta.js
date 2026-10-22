// GET /api/meta
// 上市＋上櫃每檔股票的股本（億元）、收盤價、漲跌幅。資料來源：證交所與櫃買中心 OpenAPI。
import { requireUser, getJSON } from './_lib.js';

const TTL = 6 * 3600 * 1000;
let cache = { at: 0, data: null };

const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s+]/g, ''));
  return Number.isFinite(v) ? v : null;
};
// 依欄位名稱找值（各家 OpenAPI 欄位命名不一樣）
const pick = (row, tests) => {
  for (const k of Object.keys(row)) if (tests.some((t) => t.test(k))) return row[k];
  return undefined;
};

async function build() {
  const out = {};
  const status = {};
  const jobs = {
    twseCap: getJSON('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', { timeout: 15000 }),
    tpexCap: getJSON('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', { timeout: 15000 }),
    twsePx: getJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { timeout: 15000 }),
    tpexPx: getJSON('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', { timeout: 15000 }),
  };
  const got = {};
  await Promise.all(Object.entries(jobs).map(async ([k, p]) => {
    try { got[k] = await p; status[k] = Array.isArray(got[k]) ? got[k].length : 0; } catch (e) { got[k] = []; status[k] = `失敗：${e.message}`; }
  }));
  const ensure = (code, mkt) => (out[code] ||= { mkt, name: '', cap: null, close: null, chg: null });

  for (const [key, mkt] of [['twseCap', '上市'], ['tpexCap', '上櫃']]) {
    for (const r of got[key] || []) {
      const code = String(pick(r, [/公司代號/, /CompanyCode/i, /^Code$/i]) ?? '').trim();
      if (!/^\d{4}$/.test(code)) continue;
      const capital = num(pick(r, [/實收資本額/, /Paidin.*Capital/i, /Capital/i]));
      const o = ensure(code, mkt);
      o.name = String(pick(r, [/公司簡稱/, /Abbreviation/i, /CompanyName/i]) ?? o.name).trim();
      if (capital) o.cap = capital / 1e8; // 元 → 億元
    }
  }
  for (const [key, mkt] of [['twsePx', '上市'], ['tpexPx', '上櫃']]) {
    for (const r of got[key] || []) {
      const code = String(pick(r, [/^Code$/i, /SecuritiesCompanyCode/i, /代號/]) ?? '').trim();
      if (!/^\d{4}$/.test(code)) continue;
      const close = num(pick(r, [/^ClosingPrice$/i, /^Close$/i, /收盤/]));
      const change = num(pick(r, [/^Change$/i, /漲跌/]));
      const o = ensure(code, out[code]?.mkt || mkt);
      if (!o.name) o.name = String(pick(r, [/^Name$/i, /CompanyName/i, /名稱/]) ?? '').trim();
      if (close) {
        o.close = close;
        if (change != null && close - change > 0) o.chg = (change / (close - change)) * 100;
      }
    }
  }
  return { updatedAt: Date.now(), status, stocks: out };
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  if (cache.data && Date.now() - cache.at < TTL && req.query.refresh !== '1') return res.status(200).json(cache.data);
  try {
    const data = await build();
    if (Object.keys(data.stocks).length) cache = { at: Date.now(), data };
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: `抓不到股本與股價（${e.message}）` });
  }
}
