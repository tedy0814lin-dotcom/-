// 給排程用的警報掃描（不用登入，要帶正確的 x-alert-key）
// GET /api/alert?m=crypto                → 加密前 50 檔裡「非常強」的機會
// GET /api/alert?m=tw&step=pick          → 台股要抓日 K 的股票清單
// GET /api/alert?m=tw&codes=2330,2317    → 這幾檔（最多 8 檔）裡「非常強」的機會
import crypto from 'node:crypto';
import { getJSON, pool } from './_lib.js';
import { buildCrypto, CRYPTO_SIGNALS, cryptoSignals } from '../lib/cryptoCore.js';
import { CATS, classify } from '../lib/categories.js';
import { TW_SIGNALS, twPick, applyTwHist } from '../lib/twCore.js';
import { twData } from './twstock.js';
import { histData } from './twhist.js';

function authed(req) {
  const want = process.env.ALERT_KEY || '';
  const got = String(req.headers['x-alert-key'] || '');
  if (want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// 只留夠強的（預設只要「非常強」；min=1 連「強」「中」也要，給每日摘要用）
// 整理成要推播的內容；id 用來避免同一個訊號重複通知
const RANK = { 非常強: 3, 強: 2, 中: 1 };
function pick(rows, dict, mkt, min = 3) {
  const out = [];
  for (const r of rows) {
    classify(r, dict);
    if (!(RANK[r.catLevel] >= min)) continue;
    const c = r.choch || r.div?.choch || {};
    const name = mkt === 'crypto' ? r.base || r.symbol : `${r.code} ${r.name}`;
    out.push({
      id: [mkt, r.symbol || r.code, r.cat, c.stage || '', c.key ?? '', c.low1 ?? ''].join('|'),
      mkt, name, cat: CATS[r.cat].label, level: r.catLevel,
      price: r.price ?? r.close ?? null,
      why: r.catWhy.slice(0, 4),
      choch: (r.chochWhy || []).slice(0, 4),
    });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authed(req)) return res.status(401).json({ error: '金鑰不對' });
  const min = req.query.min === '1' ? 1 : 3;
  try {
    if (req.query.m === 'crypto') {
      const d = await buildCrypto(50, { getJSON, pool });
      for (const r of d.rows) r.signals = cryptoSignals(r);
      return res.status(200).json({ items: pick(d.rows, CRYPTO_SIGNALS, 'crypto', min) });
    }
    const d = await twData();
    if (req.query.step === 'pick') return res.status(200).json({ date: d.date, codes: twPick(d.rows) });
    const codes = String(req.query.codes || '').split(',').filter((c) => /^\d{4}$/.test(c)).slice(0, 8);
    const rows = [];
    for (const code of codes) {
      const base = d.rows.find((x) => x.code === code);
      if (!base) continue;
      const r = { ...base, signals: [...base.signals] };
      try { applyTwHist(r, await histData(code)); rows.push(r); } catch {}
    }
    res.status(200).json({ date: d.date, items: pick(rows, TW_SIGNALS, 'tw', min) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
