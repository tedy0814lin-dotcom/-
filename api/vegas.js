// GET /api/vegas?list=crypto|tw            → 要掃的清單
// GET /api/vegas?m=crypto&s=BTCUSDT,ETHUSDT  → 每檔 15 分 / 1 小時 / 4 小時 的維加斯通道狀態（一次最多 8 檔）
// GET /api/vegas?m=tw&s=2330.TW,6147.TWO     → 台股 15 分 / 1 小時 / 日線（一次最多 6 檔，Yahoo 財經資料）
import { requireUser, getJSON, pool } from './_lib.js';
import { vegas } from '../lib/vegas.js';

const BN = 'https://fapi.binance.com';
const cache = new Map(); // key → { at, data }
const hit = (k, ttl) => { const c = cache.get(k); return c && Date.now() - c.at < ttl ? c.data : null; };
const num = (s) => { const v = Number(String(s ?? '').replace(/[,\s+]/g, '')); return Number.isFinite(v) ? v : null; };
const pick = (row, tests) => { for (const k of Object.keys(row)) if (tests.some((t) => t.test(k))) return row[k]; };

async function listCrypto() {
  const [t, info] = await Promise.all([getJSON(`${BN}/fapi/v1/ticker/24hr`), getJSON(`${BN}/fapi/v1/exchangeInfo`)]);
  const ok = new Set(info.symbols.filter((x) => x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT' && x.status === 'TRADING').map((x) => x.symbol));
  return t.filter((x) => ok.has(x.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 80)
    .map((x) => ({ s: x.symbol, name: x.symbol.replace(/USDT$/, '') }));
}

// 台股：股價 10–200 元、成交值前 120 名（上市＋上櫃，排除 ETF / 權證）
async function listTw(all = false) {
  const [twse, tpex] = await Promise.all([
    getJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { timeout: 15000 }).catch(() => []),
    getJSON('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', { timeout: 15000 }).catch(() => []),
  ]);
  const rows = [];
  for (const [arr, sfx] of [[twse, '.TW'], [tpex, '.TWO']]) {
    for (const r of arr) {
      const code = String(pick(r, [/^Code$/i, /SecuritiesCompanyCode/i]) ?? '').trim();
      if (!/^[1-9]\d{3}$/.test(code)) continue;
      const close = num(pick(r, [/^ClosingPrice$/i, /^Close$/i]));
      const value = num(pick(r, [/^TradeValue$/i, /TransactionAmount/i, /TradingValue/i]));
      if (!all && (!close || close < 10 || close > 200 || !value)) continue;
      rows.push({ s: code + sfx, name: `${code} ${String(pick(r, [/^Name$/i, /CompanyName/i]) ?? '').trim()}`, value });
    }
  }
  return rows.sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, all ? 5000 : 120).map(({ s, name }) => ({ s, name }));
}

async function crypto(sym) {
  const tf = async (iv) => {
    const k = await getJSON(`${BN}/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=1500`, { timeout: 12000 });
    return vegas(k.slice(0, -1).map((x) => ({ o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[7], d: 2 * +x[10] - +x[7] })));
  };
  const [m15, h1, h4] = await Promise.all([tf('15m'), tf('1h'), tf('4h')]);
  return { '15m': m15, '1h': h1, '4h': h4 };
}

async function yahoo(sym, interval, range) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`, { timeout: 12000 });
  const r = j.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!q) throw new Error('Yahoo 沒有資料');
  const bars = [];
  // 只用已經收盤的 K 棒：分 K 看開始時間＋週期；日 K 要過 13:30 收盤
  const span = { '15m': 900, '60m': 3600, '1d': 4.5 * 3600 }[interval] || 0;
  const now = Date.now() / 1000;
  for (let i = 0; i < (r.timestamp || []).length; i++) {
    if (r.timestamp[i] + span > now) continue;
    const b = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 };
    if (b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0) bars.push(b);
  }
  return vegas(bars);
}

async function tw(sym) {
  const [m15, h1, d1] = await Promise.all([yahoo(sym, '15m', '60d'), yahoo(sym, '60m', '2y'), yahoo(sym, '1d', '10y')]);
  return { '15m': m15, '1h': h1, '1d': d1 };
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const list = req.query.list;
    if (list) {
      const k = 'list:' + list;
      const data = hit(k, 30 * 60e3) || (list === 'tw' ? await listTw() : list === 'twall' ? await listTw(true) : await listCrypto());
      cache.set(k, { at: Date.now(), data });
      return res.status(200).json(data);
    }
    const isTw = req.query.m === 'tw';
    const syms = String(req.query.s || '').split(',').map((x) => x.trim()).filter((x) => /^[A-Z0-9.]{2,20}$/.test(x)).slice(0, isTw ? 6 : 8);
    const out = {};
    await pool(syms, 4, async (s) => {
      const k = 'v:' + s;
      const c = hit(k, isTw ? 10 * 60e3 : 4 * 60e3);
      if (c) { out[s] = c; return; }
      try { out[s] = isTw ? await tw(s) : await crypto(s); cache.set(k, { at: Date.now(), data: out[s] }); }
      catch (e) { out[s] = { error: e.message }; }
    });
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
