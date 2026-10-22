// GET /api/xchg?bases=BTC,ETH,SOL
// 其他交易所（Bybit、OKX、Bitget、Gate、MEXC、KuCoin、HTX、BingX、Hyperliquid）的持倉量與資金費率
import { requireUser, getJSON, pool, sleep } from './_lib.js';
import { fetchExchanges } from '../lib/exchanges.js';

const TTL = 4 * 60 * 1000;
let cache = { at: 0, key: '', data: null };

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (whale-radar)' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const bases = String(req.query.bases || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{1,15}$/.test(s)).slice(0, 60);
  if (!bases.length) return res.status(400).json({ error: '缺少 bases' });
  const key = bases.join(',');
  if (cache.data && cache.key === key && Date.now() - cache.at < TTL && req.query.refresh !== '1') return res.status(200).json({ ...cache.data, cached: true });
  try {
    const data = await fetchExchanges(bases, { getJSON, postJSON, pool, sleep });
    cache = { at: Date.now(), key, data };
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: `抓不到其他交易所資料（${e.message}）` });
  }
}
