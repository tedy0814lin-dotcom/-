// GET /api/twpat?codes=2330,2317,...（最多 20 檔）
// 抓個股近 1 年日 K（Yahoo 財經，上市 .TW、查不到再試上櫃 .TWO），用 lib/chartPat.js 偵測型態：
//   已經形成＝最近 6 根內收盤突破頸線；正在形成＝型態已成形、還沒突破頸線。
// 台股型態回測沒有通過（見待辦清單 2026-11-03），這裡只做看圖參考，不計分、不推播。
import { requireUser, getJSON, pool } from './_lib.js';
import { patScan, PAT_TW } from '../lib/chartPat.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cache = new Map(); // code → { day, out }
const taipeiDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

async function bars(code) {
  for (const sfx of ['TW', 'TWO']) {
    try {
      const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.${sfx}?interval=1d&range=1y`, { timeout: 12000, retries: 1, headers: { 'User-Agent': UA } });
      const r = j.chart?.result?.[0], q = r?.indicators?.quote?.[0];
      if (!q || !(r.timestamp || []).length) continue;
      const out = [];
      for (let i = 0; i < r.timestamp.length; i++) {
        if (r.timestamp[i] + 4.5 * 3600 > Date.now() / 1000) continue; // 今天還沒收盤的不算
        const b = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: (q.volume[i] || 0) / 1000 };
        if (b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0) out.push(b);
      }
      if (out.length) return out;
    } catch { /* 換下一個後綴 */ }
  }
  return null;
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const codes = String(req.query.codes || '').split(',').map((s) => s.trim()).filter((s) => /^\d{4}$/.test(s)).slice(0, 20);
  if (!codes.length) return res.status(400).json({ error: '沒有代號' });
  const day = taipeiDay(), results = {}, miss = [];
  await pool(codes, 6, async (code) => {
    const hit = cache.get(code);
    if (hit && hit.day === day) { if (hit.out) results[code] = hit.out; return; }
    const B = await bars(code);
    if (!B) { miss.push(code); return; }
    const r = patScan(B, PAT_TW);
    const out = r.formed.length || r.forming.length ? { ...r, close: B[B.length - 1].c, n: B.length } : null;
    cache.set(code, { day, out });
    if (out) results[code] = out;
  });
  res.status(200).json({ results, miss, day });
}
