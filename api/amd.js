// GET /api/amd?m=tw&s=2330.TW,6147.TWO → 台股每檔 1H 的 AMD 操縱模型狀態（多、空）。規則與回測見 lib/amd.js
// 觀察用：專案回測（台股 1H 2R／24 根扣費 −0.30R）不比隨機進場好，不計分、不推播。
import { requireUser, pool } from './_lib.js';
import { amdScan } from '../lib/amd.js';
import { yahooBars } from './vegas.js';

const cache = new Map();
const twH1 = async (s) => (await yahooBars(s, '60m', '2y')).filter((b) => new Date(b.t + 8 * 3600e3).getUTCMinutes() !== 30); // 去掉 13:30 尾盤零碎 K

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const syms = String(req.query.s || '').split(',').map((x) => x.trim()).filter((x) => /^[A-Z0-9.]{2,20}$/.test(x)).slice(0, 6);
    const out = {};
    await pool(syms, 2, async (s) => {
      const c = cache.get(s);
      if (c && Date.now() - c.at < 5 * 60e3) { out[s] = c.data; return; }
      try {
        const h = await twH1(s);
        out[s] = { L: amdScan(h, 1), S: amdScan(h, -1) };
        cache.set(s, { at: Date.now(), data: out[s] });
      } catch (e) { out[s] = { error: e.message }; }
    });
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
