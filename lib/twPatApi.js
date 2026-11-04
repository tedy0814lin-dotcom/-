// GET /api/twhist?pat=1&codes=2330,2317,...（最多 20 檔；併在 twhist 裡，因為免費方案最多 12 個函式）
// 抓個股近 1 年日 K（Yahoo 財經，上市 .TW、查不到再試上櫃 .TWO），用 lib/chartPat.js 偵測型態：
//   已經形成＝最近 6 根內收盤突破頸線；正在形成＝型態已成形、還沒突破頸線。偏空型態用鏡像偵測。
//   另外附 K 棒型態、MACD 柱狀體波峰背離（含持續背離）、突破量能，以及最近 120 根 K 線供前端畫圖。
// 台股型態回測沒有通過（見待辦清單 2026-11-03），這裡只做看圖參考，不計分、不推播。
import { getJSON, pool } from '../api/_lib.js';
import { scanAll } from './chartPat.js';
import { candleScan } from './candles.js';
import { macdHumpEvents } from './macdHump.js';

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
        const b = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: (q.volume[i] || 0) / 1000, d: new Date(r.timestamp[i] * 1000 + 8 * 3600e3).toISOString().slice(5, 10) };
        if (b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0) out.push(b);
      }
      if (out.length) return out;
    } catch { /* 換下一個後綴 */ }
  }
  return null;
}

const W = 120; // 圖上顯示最近 120 根
const r2 = (x) => Math.round(x * 100) / 100;
export function analyze(B) {
  const n = B.length;
  if (n < 120) return null;
  const pats = scanAll(B), cds = candleScan(B);
  const A20 = (end) => { let t = 0, k = 0; for (let i = Math.max(0, end - 20); i < end; i++) { t += B[i].v; k++; } return k ? t / k : 0; };
  // MACD 柱狀體波峰背離：最近 10 根內剛確認的（偏多＝底背離、偏空＝頂背離）；k≥2 為持續背離
  const div = {};
  for (const side of [1, -1]) {
    const ev = macdHumpEvents(B, side), x = ev[ev.length - 1];
    if (x && n - 1 - x.i <= 10) div[side > 0 ? 'bull' : 'bear'] = { ago: n - 1 - x.i, k: x.k };
  }
  if (!pats.length && !cds.length) return null;
  const off = n - W;
  const sh = (a) => (a == null ? a : a - off);
  const items = pats.map((p) => {
    const bi = p.state === 'formed' ? n - 1 - p.ago : null;
    const volX = bi != null && A20(bi) > 0 ? B[bi].v / A20(bi) : null; // 突破（跌破）那天的量 ÷ 前 20 日均量
    return { dir: p.dir, kind: p.kind, name: p.name, state: p.state, ago: p.ago, left: p.left, distPct: p.distPct == null ? null : r2(p.distPct), neck: p.neck == null ? null : r2(p.neck), stop: r2(p.stop), volX: volX == null ? null : r2(volX),
      pts: p.pts.map(([i, y]) => [sh(i), r2(y)]), neckLine: p.neckLine ? { i: sh(p.neckLine.i), v: r2(p.neckLine.v), s: p.neckLine.s } : null,
      lines: p.lines ? { t0: sh(p.lines.t0), u: p.lines.u.map((x) => +x.toFixed(4)), l: p.lines.l.map((x) => +x.toFixed(4)) } : null };
  });
  const v5 = B.slice(-5).reduce((a, b) => a + b.v, 0) / 5, a20 = A20(n);
  return {
    close: B[n - 1].c, n, off, items, candles: cds.map((c) => ({ dir: c.dir, name: c.name, ago: c.ago, len: c.len, i: sh(c.i) })), div, vol5x: a20 > 0 ? r2(v5 / a20) : null,
    bars: B.slice(-W).map((b) => [r2(b.o), r2(b.h), r2(b.l), r2(b.c), Math.round(b.v)]), d0: B[n - W].d, d1: B[n - 1].d, dates: B.slice(-W).map((b) => b.d),
  };
}

export async function twPat(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const codes = String(req.query.codes || '').split(',').map((s) => s.trim()).filter((s) => /^\d{4}$/.test(s)).slice(0, 20);
  if (!codes.length) return res.status(400).json({ error: '沒有代號' });
  const day = taipeiDay(), results = {}, miss = [];
  await pool(codes, 6, async (code) => {
    const hit = cache.get(code);
    if (hit && hit.day === day) { if (hit.out) results[code] = hit.out; return; }
    const B = await bars(code);
    if (!B) { miss.push(code); return; }
    if (req.query.debug) { results[code] = { bars: B.slice(-260).map((b) => [b.o, b.h, b.l, b.c]) }; return; }
    const out = analyze(B);
    cache.set(code, { day, out });
    if (out) results[code] = out;
  });
  res.status(200).json({ results, miss, day });
}
