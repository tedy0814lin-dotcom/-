// GET /api/log → 數據記錄（GitHub Actions 每 15 分鐘整理後存在 repo 的 data 分支 signals.json）
import { requireUser } from './_lib.js';

const REPO = process.env.LOG_REPO || 'tedy0814lin-dotcom/-';
let cache = { at: 0, data: null };

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!cache.data || Date.now() - cache.at > 60e3) {
      const r = await fetch(`https://raw.githubusercontent.com/${REPO}/data/signals.json`, { headers: { 'Cache-Control': 'no-cache' } });
      if (r.status === 404) cache = { at: Date.now(), data: { items: [], updated: null } };
      else if (!r.ok) throw new Error('讀取紀錄失敗 HTTP ' + r.status);
      else cache = { at: Date.now(), data: await r.json() };
    }
    res.status(200).json(cache.data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
