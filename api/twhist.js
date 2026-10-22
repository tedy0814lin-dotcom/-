// GET /api/twhist?codes=2330,2317
// 抓個股近 4 個月日 K，算日線 MACD 背離與型態（大漲大跌、箱型突破）。一次最多 8 檔（證交所會擋太快的請求）。
import { requireUser, getJSON, sleep } from './_lib.js';
import { divergence, pattern } from '../lib/indicators.js';
import { structure, STRUCT_TW } from '../lib/structure.js';

const TWSE = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const cache = new Map(); // code → { day, data }

const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(v) ? v : NaN;
};

function months(n) {
  const out = [];
  const d = new Date(Date.now() + 8 * 3600e3);
  for (let i = 0; i < n; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}${String(m.getUTCMonth() + 1).padStart(2, '0')}01`);
  }
  return out.reverse();
}

async function history(code) {
  const bars = [];
  for (const ym of months(5)) {
    const j = await getJSON(`${TWSE}?date=${ym}&stockNo=${code}&response=json`);
    if (j.stat === 'OK' && Array.isArray(j.data)) {
      const f = j.fields.map(String);
      const iO = f.findIndex((x) => x.includes('開盤')), iH = f.findIndex((x) => x.includes('最高')), iL = f.findIndex((x) => x.includes('最低')), iC = f.findIndex((x) => x.includes('收盤'));
      const iV = f.findIndex((x) => x.includes('成交股數'));
      for (const r of j.data) {
        const b = { o: iO >= 0 ? num(r[iO]) : undefined, h: num(r[iH]), l: num(r[iL]), c: num(r[iC]), v: iV >= 0 ? num(r[iV]) / 1000 : 0 };
        if (b.h > 0 && b.l > 0 && b.c > 0) bars.push(b);
      }
    }
    await sleep(300);
  }
  return bars;
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  const codes = String(req.query.codes || '').split(',').map((c) => c.trim()).filter((c) => /^\d{4}$/.test(c)).slice(0, 8);
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const out = {};
  for (const code of codes) {
    const hit = cache.get(code);
    if (hit && hit.day === day) { out[code] = hit.data; continue; }
    try {
      const bars = await history(code);
      // 日線：20 日箱型、往回 60 日找大漲大跌
      const data = {
        ...divergence(bars, { lookback: 70, w: 3, recent: 12 }),
        pat: pattern(bars, { box: 20, runWin: 60, boxMax: 15 }),
        st: structure(bars, bars, STRUCT_TW), // 日線大箱 / 短箱 / 趨勢回踩
        bars: bars.length,
      };
      cache.set(code, { day, data });
      out[code] = data;
    } catch (e) {
      out[code] = { error: e.message };
    }
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json(out);
}
