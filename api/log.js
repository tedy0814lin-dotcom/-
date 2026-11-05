// GET /api/log → 數據記錄（GitHub Actions 每 15 分鐘整理後存在 repo 的 data 分支 signals.json）
import { requireUser } from './_lib.js';
import { stratResults } from '../lib/stratlog.js';

const REPO = process.env.LOG_REPO || 'tedy0814lin-dotcom/-';
let cache = { at: 0, data: null };
let scache = { at: 0, data: null };

// 同一個訊號會連續被掃到好幾次（進場價是即時價格）：同檔、同策略、同時區、同方向、停損價相同，
// 前一筆在 48 小時內記的或還沒結算 → 算同一個，只留最早那筆（跟 scripts/log.mjs 的規則一樣）
function dedupe(items) {
  const sameSig = (a, b) => a.s === b.s && a.k === b.k && a.tf === b.tf && a.dir === b.dir && Math.abs(a.stop - b.stop) / b.stop < 0.002;
  const kept = [];
  for (const x of [...items].sort((a, b) => a.t - b.t)) {
    if (!kept.some((e) => sameSig(e, x) && (Math.abs(x.t - e.t) < 48 * 3600e3 || e.st === 'open' || e.st === 'pending'))) kept.push(x);
  }
  return kept;
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.strat) { // 主力策略（大陽線突破／Delta 階梯／大單推升）的實盤記錄＋結算重播
    try {
      if (!scache.data || !scache.data.updated || req.query.force || Date.now() - scache.at > 5 * 60e3) {
        const r = await fetch(`https://raw.githubusercontent.com/${REPO}/data/strat.json`, { headers: { 'Cache-Control': 'no-cache' } });
        const j = r.status === 404 ? { items: [] } : r.ok ? await r.json() : (() => { throw new Error('讀取策略記錄失敗 HTTP ' + r.status); })();
        scache = { at: Date.now(), data: { updated: j.updated ?? null, items: await stratResults(j.items || []) } };
      }
      return res.status(200).json(scache.data);
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }
  try {
    if (!cache.data || Date.now() - cache.at > 60e3) {
      const r = await fetch(`https://raw.githubusercontent.com/${REPO}/data/signals.json`, { headers: { 'Cache-Control': 'no-cache' } });
      if (r.status === 404) cache = { at: Date.now(), data: { items: [], updated: null } };
      else if (!r.ok) throw new Error('讀取紀錄失敗 HTTP ' + r.status);
      else { const j = await r.json(); cache = { at: Date.now(), data: { ...j, items: dedupe(j.items || []) } }; }
    }
    res.status(200).json(cache.data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
