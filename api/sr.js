// GET /api/sr?m=crypto&s=BTCUSDT,ETHUSDT → 每檔 4H／1H／15 分的支撐壓力區＋SMC 趨勢（觀察用，不計分、不推播）。規則見 lib/sr.js
// GET /api/sr?m=tw&s=2330.TW            → 台股（Yahoo；4H 由 1H 合成）
import { requireUser, pool } from './_lib.js';
import { srScan, tw4h, useBigZones } from '../lib/sr.js';
import { rawBars } from './vegas.js';

const cache = new Map();
async function one(m, s) {
  if (m === 'tw') {
    const [h1, m15] = await Promise.all([rawBars('tw', s, '1h'), rawBars('tw', s, '15m')]);
    const H = h1.filter((b) => new Date(b.t + 8 * 3600e3).getUTCMinutes() !== 30); // 去掉 13:30 尾盤零碎 K
    const b = srScan(tw4h(h1));
    return { '4h': b, '1h': useBigZones(srScan(H, 140, false), b), '15m': useBigZones(srScan(m15, 140, false), b) };
  }
  const o = {};
  for (const tf of ['4h', '1h', '15m']) o[tf] = srScan(await rawBars('crypto', s, tf), 140, tf === '4h');
  useBigZones(o['1h'], o['4h']); useBigZones(o['15m'], o['4h']);
  return o;
}
export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const m = req.query.m === 'tw' ? 'tw' : 'crypto';
    const syms = String(req.query.s || '').split(',').map((x) => x.trim()).filter((x) => /^[A-Z0-9.]{2,20}$/.test(x)).slice(0, 6);
    const out = {};
    await pool(syms, 2, async (s) => {
      const c = cache.get(m + s);
      if (c && Date.now() - c.at < 5 * 60e3) { out[s] = c.data; return; }
      try { out[s] = await one(m, s); cache.set(m + s, { at: Date.now(), data: out[s] }); } catch (e) { out[s] = { error: e.message }; }
    });
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
