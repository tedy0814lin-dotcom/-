// GET /api/twhist?pat=1&codes=2330,2317,...（最多 20 檔；併在 twhist 裡，因為免費方案最多 12 個函式）
// 抓個股近 1 年日 K（Yahoo 財經，上市 .TW、查不到再試上櫃 .TWO），用 lib/chartPat.js 偵測型態：
//   已經形成＝最近 6 根內收盤突破頸線；正在形成＝型態已成形、還沒突破頸線。偏空型態用鏡像偵測。
//   另外附 K 棒型態、MACD 柱狀體波峰背離（含持續背離）、突破量能，以及最近 120 根 K 線供前端畫圖。
// 台股型態回測沒有通過（見待辦清單 2026-11-03），這裡只做看圖參考，不計分、不推播。
import { getJSON, pool } from '../api/_lib.js';
import { scanAll, earlySignals } from './chartPat.js';
import { candleScan } from './candles.js';
import { macdHumpEvents } from './macdHump.js';
import { refAll } from './macdRef.js';
import { topDivSimple } from './pickDiv.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cache = new Map(); // code → { day, out }
const taipeiDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

async function bars(code) {
  for (const sfx of ['TW', 'TWO']) {
    try {
      const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.${sfx}?interval=1d&range=5y`, { timeout: 12000, retries: 1, headers: { 'User-Agent': UA } });
      const r = j.chart?.result?.[0], q = r?.indicators?.quote?.[0];
      if (!q || !(r.timestamp || []).length) continue;
      const out = [], full = [];
      // 型態偵測仍然只用最近 1 年（跟原本 range=1y 完全相同的區間：台北日期 ≥ 今天 − 366 天），避免改變已回測的型態結果；5 年資料只給背離判讀（週線）用
      const cut = new Date(Date.now() + 8 * 3600e3 - 366 * 864e5).toISOString().slice(0, 10);
      for (let i = 0; i < r.timestamp.length; i++) {
        if (r.timestamp[i] + 4.5 * 3600 > Date.now() / 1000) continue; // 今天還沒收盤的不算
        const iso = new Date(r.timestamp[i] * 1000 + 8 * 3600e3).toISOString();
        const b = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: (q.volume[i] || 0) / 1000, d: iso.slice(5, 10) };
        if (!(b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)) continue;
        full.push({ ...b, t: r.timestamp[i] * 1000 });
        if (iso.slice(0, 10) >= cut) out.push(b);
      }
      if (out.length) { out.full = full; return out; }
    } catch { /* 換下一個後綴 */ }
  }
  return null;
}

const WMAX = 320; // 回傳最近 320 根；前端預設畫最近 200 根（型態起點較早時往前多畫），成交量分布用全部 320 根算

const r2 = (x) => (x == null || !isFinite(x) ? x : +Number(x).toPrecision(6)); // 有效位數，低價幣也不失真
export function analyze(B, plain = false, full = null) { // plain＝沒有型態也回傳（單獨查詢一檔時用，給圖和成交量分布）
  const n = B.length;
  if (n < (plain ? 30 : 120)) return null;
  const pats = scanAll(B), cds = candleScan(B);
  const A20 = (end) => { let t = 0, k = 0; for (let i = Math.max(0, end - 20); i < end; i++) { t += B[i].v; k++; } return k ? t / k : 0; };
  // MACD 柱狀體波峰背離：最近 10 根內剛確認的（偏多＝底背離、偏空＝頂背離）；k≥2 為持續背離
  const div = {};
  for (const side of [1, -1]) {
    const ev = macdHumpEvents(B, side), x = ev[ev.length - 1];
    if (x && n - 1 - x.i <= 10) div[side > 0 ? 'bull' : 'bear'] = { ago: n - 1 - x.i, k: x.k };
  }
  if (!pats.length && !cds.length && !plain) return null;
  const W = Math.min(WMAX, n), off = n - W;
  const sh = (a) => (a == null ? a : a - off);
  const items = pats.map((p) => {
    const bi = p.state === 'formed' ? n - 1 - p.ago : null;
    const volX = bi != null && A20(bi) > 0 ? B[bi].v / A20(bi) : null; // 突破（跌破）那天的量 ÷ 前 20 日均量
    return { dir: p.dir, kind: p.kind, name: p.name, state: p.state, ago: p.ago, left: p.left, distPct: p.distPct == null ? null : r2(p.distPct), neck: p.neck == null ? null : r2(p.neck), stop: r2(p.stop), volX: volX == null ? null : r2(volX),
      pts: p.pts.map(([i, y]) => [sh(i), r2(y)]), neckLine: p.neckLine ? { i: sh(p.neckLine.i), v: r2(p.neckLine.v), s: p.neckLine.s } : null,
      lines: p.lines ? { t0: sh(p.lines.t0), u: p.lines.u.map((x) => +x.toFixed(4)), l: p.lines.l.map((x) => +x.toFixed(4)) } : null };
  });
  const v5 = B.slice(-5).reduce((a, b) => a + b.v, 0) / 5, a20 = A20(n);
  // MACD 背離參考（只供看圖，不計分；規格見 lib/macdRef.js）：只存預設要顯示的
  let ref = null;
  if (full && full.length >= 120) {
    const all = refAll(full), pick = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.show).map(([k, v]) => [k, { chain: v.chain, ratio: r2(v.ratio), conv: r2(v.conv), status: v.status, ago: v.ago, dist: r2(v.distAtr) }]));
    ref = { d: pick(all.d), w: pick(all.w) };
  }
  // 大單推升的頂背離標記（1／0／null）：用 5 年日 K 的收盤算，見 lib/pickDiv.js；由 scripts/patall.mjs 彙整成 pp_pkdiv.json
  const pkd = full ? topDivSimple(full.map((b) => b.c)) : null;
  return {
    close: B[n - 1].c, n, off, items, candles: cds.map((c) => ({ dir: c.dir, name: c.name, ago: c.ago, len: c.len, i: sh(c.i) })), div, ref, pkd, vol5x: a20 > 0 ? r2(v5 / a20) : null,
    bars: B.slice(-W).map((b) => [r2(b.o), r2(b.h), r2(b.l), r2(b.c), Math.round(b.v)]), d0: B[n - W].d, d1: B[n - 1].d, dates: B.slice(-W).map((b) => b.d),
  };
}

const FAPI = 'https://fapi.binance.com';
const TFS = { '4h': { limit: 700, ttl: 10 * 60e3 }, '12h': { limit: 500, ttl: 30 * 60e3 }, '1d': { limit: 500, ttl: 30 * 60e3 } };
const fmtD = (t, tf) => { const d = new Date(t + 8 * 3600e3).toISOString(); return tf === '1d' ? d.slice(5, 10) : d.slice(5, 10) + ' ' + d.slice(11, 13) + 'h'; };
async function cbars(sym, tf) {
  const k = await getJSON(`${FAPI}/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=${TFS[tf].limit}`, { timeout: 12000, retries: 1 });
  const out = [];
  for (const x of k) { if (x[6] > Date.now()) continue; out.push({ o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5], d: fmtD(x[0], tf) }); }
  return out;
}
const ccache = new Map(); // sym|tf → { t, out }
async function cryptoPat(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.query.list) { // 成交額前 N 的 USDT 永續（已排除下市／非永續）
    const [tk, ex] = await Promise.all([getJSON(`${FAPI}/fapi/v1/ticker/24hr`), getJSON(`${FAPI}/fapi/v1/exchangeInfo`)]);
    const ok = new Set((ex.symbols || []).filter((x) => x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT' && x.status === 'TRADING').map((x) => x.symbol));
    const top = Math.min(200, +req.query.top || 120);
    const symbols = tk.filter((t) => ok.has(t.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, top).map((t) => t.symbol);
    return res.status(200).json({ symbols });
  }
  const tf = String(req.query.tf || '4h');
  if (!TFS[tf]) return res.status(400).json({ error: '時區不支援' });
  const syms = String(req.query.symbols || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{1,20}USDT$/.test(x)).slice(0, 12);
  if (!syms.length) return res.status(400).json({ error: '沒有代號' });
  const plain = !!req.query.plain, results = {}, miss = [];
  await pool(syms, 6, async (sym) => {
    const key = sym + '|' + tf + (plain ? '|p' : ''), hit = ccache.get(key);
    if (hit && Date.now() - hit.t < TFS[tf].ttl) { if (hit.out) results[sym] = hit.out; return; }
    try {
      const B = await cbars(sym, tf);
      let out = B.length >= 120 ? analyze(B, plain) : null;
      // 回測通過的「底部早進場」（只有 12H、日線；見 lib/cryptoCore.js 說明）
      const EK = { '12h': ['eTri12', 'eDia12', 'eDbl12', 'eRect12'], '1d': ['eRect1d', 'eTri1d', 'eDbl1d'] }[tf];
      if (out && EK) { const es = earlySignals(B, EK); out.early = Object.entries(es).map(([key, x]) => ({ key, kind: x.kind, ago: x.ago, stop: r2(x.stop), neck: r2(x.neck), pts: x.pts.map(([i, y]) => [i - out.off, r2(y)]), neckLine: { i: x.neckLine[1] - out.off, v: r2(x.neckLine[0]), s: x.neckLine[2] } })); }
      ccache.set(key, { t: Date.now(), out });
      if (out) results[sym] = out;
    } catch { miss.push(sym); }
  });
  res.status(200).json({ results, miss, tf });
}

export async function twPat(req, res) {
  if (req.query.market === 'crypto') return cryptoPat(req, res);
  res.setHeader('Cache-Control', 'private, no-store');
  const codes = String(req.query.codes || '').split(',').map((s) => s.trim()).filter((s) => /^\d{4}$/.test(s)).slice(0, 20);
  if (!codes.length) return res.status(400).json({ error: '沒有代號' });
  const plain = !!req.query.plain, day = taipeiDay(), results = {}, miss = [];
  await pool(codes, 6, async (code) => {
    const ck = plain ? code + '|p' : code, hit = cache.get(ck);
    if (hit && hit.day === day) { if (hit.out) results[code] = hit.out; return; }
    const B = await bars(code);
    if (!B) { miss.push(code); return; }
    if (req.query.debug) { results[code] = { bars: B.slice(-260).map((b) => [b.o, b.h, b.l, b.c]) }; return; }
    const out = analyze(B, plain, B.full);
    cache.set(ck, { day, out });
    if (out) results[code] = out;
  });
  res.status(200).json({ results, miss, day });
}
