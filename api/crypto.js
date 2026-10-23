// GET /api/crypto?n=50&refresh=1
import { requireUser, getJSON, pool } from './_lib.js';
import { buildCrypto } from '../lib/cryptoCore.js';

const TTL = 4 * 60 * 1000; // 4 分鐘內重複開不重抓
let cache = { at: 0, n: 0, data: null };

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const n = Math.min(Math.max(parseInt(req.query.n, 10) || 120, 10), 200);
  const fresh = cache.data && cache.n === n && Date.now() - cache.at < TTL;
  if (fresh && req.query.refresh !== '1') return res.status(200).json({ ...cache.data, cached: true });
  try {
    const data = await buildCrypto(n, { getJSON, pool });
    cache = { at: Date.now(), n, data };
    res.status(200).json(data);
  } catch (e) {
    if (cache.data) return res.status(200).json({ ...cache.data, stale: true, warning: e.message });
    res.status(502).json({ error: `抓不到幣安資料（${e.message}）` });
  }
}
