// GET /api/vegas?list=crypto|tw            → 要掃的清單
// GET /api/vegas?m=crypto&s=BTCUSDT,ETHUSDT  → 每檔 15 分 / 1 小時 / 4 小時 的維加斯通道狀態（一次最多 8 檔）
// GET /api/vegas?m=tw&s=2330.TW,6147.TWO     → 台股 15 分 / 1 小時 / 日線（一次最多 6 檔，Yahoo 財經資料）
import { requireUser, getJSON, pool } from './_lib.js';
import { vegas, vegasChart } from '../lib/vegas.js';

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

async function yahooBars(sym, interval, range) {
  let j, e0;
  for (const h of ['query1', 'query2', 'query1']) { // Yahoo 偶爾限流（429），換主機再試
    try { j = await getJSON(`https://${h}.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`, { timeout: 12000, retries: 0 }); break; }
    catch (e) { e0 = e; await new Promise((r) => setTimeout(r, 700)); }
  }
  if (!j) throw e0;
  const r = j.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!q) throw new Error('Yahoo 沒有資料');
  const bars = [];
  // 只用已經收盤的 K 棒：分 K 看開始時間＋週期；日 K 要過 13:30 收盤
  const span = { '15m': 900, '60m': 3600, '1d': 4.5 * 3600 }[interval] || 0;
  const now = Date.now() / 1000;
  for (let i = 0; i < (r.timestamp || []).length; i++) {
    if (r.timestamp[i] + span > now) continue;
    const b = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0, t: r.timestamp[i] * 1000 };
    if (b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0) bars.push(b);
  }
  return bars;
}
const yahoo = async (sym, interval, range) => vegas(await yahooBars(sym, interval, range));

// 看圖：單檔、單一時區，回傳近 150 根 K 棒＋維加斯通道線
const TWCH = { '15m': ['15m', '60d'], '1h': ['60m', '2y'], '1d': ['1d', '10y'] };
async function chartData(m, sym, tf) {
  if (m === 'tw') {
    const [iv, range] = TWCH[tf] || TWCH['1h'];
    return vegasChart(await yahooBars(sym, iv, range), 150);
  }
  const iv = tf === '1d' ? '1d' : tf; // 加密：15m / 1h / 4h
  // 先用 BingX；沒有該幣或被限流 → 幣安合約 → Bybit 永續 → 幣安現貨（價格幾乎相同）
  const bnRows = (k) => k.slice(0, -1).map((x) => ({ o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[7], t: +x[0] }));
  const srcs = [
    async () => { // BingX 永續（圖面與 BingX 一致）；newest first，最新一根未收盤
      const j = await getJSON(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${sym.replace(/USDT$/, '')}-USDT&interval=${iv}&limit=1000`, { timeout: 10000, retries: 1 });
      const l = j?.data; if (!Array.isArray(l) || l.length < 700) throw new Error('BingX 沒有資料');
      return l.slice(1).reverse().map((x) => ({ o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume * +x.close, t: +x.time }));
    },
    async () => bnRows(await getJSON(`${BN}/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=1500`, { timeout: 10000, retries: 0 })),
    async () => {
      const j = await getJSON(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${{ '15m': 15, '1h': 60, '4h': 240, '1d': 'D' }[iv]}&limit=1000`, { timeout: 10000, retries: 0 });
      const l = j?.result?.list; if (!l?.length) throw new Error('Bybit 沒有資料');
      return l.slice(1).reverse().map((x) => ({ o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6], t: +x[0] })); // 最新一根未收盤，去掉
    },
    async () => bnRows(await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${iv}&limit=1000`, { timeout: 10000, retries: 0 })),
  ];
  let e0;
  for (const f of srcs) { try { return vegasChart(await f(), 150); } catch (e) { e0 ||= e; } }
  throw e0;
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
    if (req.query.chart) {
      const m = req.query.m === 'tw' ? 'tw' : 'crypto', tf = String(req.query.tf || '1h');
      const sym = String(req.query.s || '').trim();
      if (!/^[A-Z0-9.]{2,20}$/.test(sym)) return res.status(400).json({ error: 'bad symbol' });
      const k = `chart:${m}:${sym}:${tf}`;
      let data = hit(k, (m === 'tw' ? 10 : 4) * 60e3);
      if (!data) {
        try { data = await chartData(m, sym, tf); }
        catch (e) { const old = cache.get(k); if (!old) throw e; data = old.data; } // 來源限流時先用舊資料
        cache.set(k, { at: Date.now(), data });
      }
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
