// GET /api/ema?m=crypto&s=BTCUSDT,ETHUSDT → 每檔 1H＋日線的均線突破狀態（多、空）
// GET /api/ema?m=tw&s=2330.TW,6147.TWO    → 台股（只做多）
// 觀察用：專案回測（加密 15 分 −0.10～−0.13R；台股 1H 回踩再突破 −0.22R）都不比隨機進場好，不計分、不推播。
import { requireUser, getJSON, pool } from './_lib.js';
import { emaScan } from '../lib/ema.js';
import { yahooBars } from './vegas.js';

const BN = 'https://fapi.binance.com';
const cache = new Map();
const rows = async (sym, iv, limit) => (await getJSON(`${BN}/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=${limit}`, { timeout: 25000 }))
  .slice(0, -1).map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })); // 最後一根未收盤，去掉
const twH1 = async (s) => (await yahooBars(s, '60m', '2y')).filter((b) => new Date(b.t + 8 * 3600e3).getUTCMinutes() !== 30); // 去掉 13:30 尾盤零碎 K

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const isTw = req.query.m === 'tw';
    const syms = String(req.query.s || '').split(',').map((x) => x.trim()).filter((x) => /^[A-Z0-9.]{2,20}$/.test(x)).slice(0, isTw ? 6 : 4);
    const out = {};
    await pool(syms, 2, async (s) => {
      const c = cache.get(s);
      if (c && Date.now() - c.at < 5 * 60e3) { out[s] = c.data; return; }
      try {
        const [h, d] = isTw ? [await twH1(s), await yahooBars(s, '1d', '3y')] : [await rows(s, '1h', 1500), await rows(s, '1d', 600)];
        out[s] = isTw ? { L: emaScan(h, d, 1, { risk: [0.005, 0.06] }) } : { L: emaScan(h, d, 1, { risk: [0.003, 0.05] }), S: emaScan(h, d, -1, { risk: [0.003, 0.05] }) };
        cache.set(s, { at: Date.now(), data: out[s] });
      } catch (e) { out[s] = { error: e.message }; }
    });
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
