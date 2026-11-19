// GET /api/crt?m=crypto&s=BTCUSDT,ETHUSDT → 每檔 1H CRT（看 5 分進場）、4H CRT（看 15 分進場）
// GET /api/crt?m=tw&s=2330.TW,6147.TWO    → 台股日線 CRT（看 15 分進場，只做多）
// 觀察用：專案回測（Yuki CRT 教室規則，加密 60 檔）扣費後約 −0.12R、贏不過隨機進場，不計分、不推播。
import { requireUser, getJSON, pool } from './_lib.js';
import { crt, CRT_CFG } from '../lib/crt.js';
import { yahooBars } from './vegas.js';

const BN = 'https://fapi.binance.com';
const cache = new Map();
const rows = async (sym, iv, limit) => (await getJSON(`${BN}/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=${limit}`, { timeout: 25000 }))
  .slice(0, -1).map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] })); // 最後一根未收盤，去掉

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
        out[s] = isTw
          ? { '1d': crt(await yahooBars(s, '15m', '60d'), CRT_CFG.tw1d) }
          : { '1h': crt(await rows(s, '5m', 3000), CRT_CFG.crypto1h), '4h': crt(await rows(s, '15m', 1500), CRT_CFG.crypto4h) };
        cache.set(s, { at: Date.now(), data: out[s] });
      } catch (e) { out[s] = { error: e.message }; }
    });
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
