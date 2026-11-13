// 長期核心策略（S6-U：價值＋低波動＋趨勢）的每日名單。收盤後算一次，結果推到 snap3 分支（檔名 s6_u.json），網站策略頁讀它。
// 資料：證交所 openapi（全部上市證券當日收盤、成交值、本益比、殖利率、淨值比）＋ Yahoo 日線還原收盤（母體內約 300 檔，取各月底）。
// 因子計算在 lib/s6u.js（跟 Python 回測逐檔對照過）。月底名單才是「正式名單」；月中的是預覽。
// 獨立於其他排程：失敗不影響警報與快照；成功率太低就不推送（保留舊的）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { s6uRank, universeMask } from '../lib/s6u.js';

const OUT = process.env.OUT || 's6u-out';
const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
const canPush = !!(repo && tok) && process.env.NOPUSH !== '1';
const KEY = 's6_u.json';
const UA = 'Mozilla/5.0 (whale-radar)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJ(url, { tries = 4, timeout = 25000 } = {}) {
  let err;
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
      if (r.ok) return await r.json();
      err = new Error('HTTP ' + r.status);
    } catch (e) { err = e; }
    await sleep(1500 * (t + 1));
  }
  throw err;
}
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };
const num = (s) => { const v = Number(String(s ?? '').replace(/,/g, '')); return String(s ?? '').trim() === '' || !Number.isFinite(v) ? null : v; };
const rocToISO = (d) => { d = String(d); return d.length === 7 ? `${+d.slice(0, 3) + 1911}-${d.slice(3, 5)}-${d.slice(5, 7)}` : d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ''; };
const tpDate = (sec) => new Date(sec * 1000 + 8 * 3600e3).toISOString().slice(0, 10);

// ---- 1) 證交所當日全部上市證券 ----
const [dayAll, bw] = await Promise.all([
  getJ('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
  getJ('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'),
]);
const asof = rocToISO(dayAll.find((r) => r.Date)?.Date);
const bwDay = rocToISO(bw.find((r) => r.Date)?.Date);
if (!asof || bwDay !== asof) { console.error(`成交資料日期(${asof})與本益比資料日期(${bwDay})不同，今天不更新`); process.exit(canPush ? 1 : 2); }
const bwBy = Object.fromEntries(bw.map((r) => [r.Code, r]));
const rows = dayAll.map((r) => {
  const b = bwBy[r.Code] || {};
  return { code: r.Code, name: r.Name, close: num(r.ClosingPrice) ?? NaN, amt: num(r.TradeValue) ?? NaN, pe: num(b.PEratio), pb: num(b.PBratio), dy: num(b.DividendYield), hist: null };
}).filter((r) => Number.isFinite(r.close) && r.close > 0 && Number.isFinite(r.amt))
  // 成交值排名的比較範圍＝回測用的面板：上市 4 碼股票＋8 檔舊式 ETF（0050 等），不含 00 開頭的新 ETF、債券 ETF、特別股、存託憑證
  .filter((r) => /^[1-9]\d{3}$/.test(r.code) || ['0050', '0051', '0052', '0053', '0055', '0056', '0057', '0061'].includes(r.code));
const mask = universeMask(rows);
const cand = rows.filter((_, i) => mask[i]);
console.log(`收盤日 ${asof}：全部證券 ${rows.length}、母體候選 ${cand.length}`);
if (cand.length < 250) { console.error('母體太少，不更新'); process.exit(1); }

// ---- 2) Yahoo 日線還原收盤 → 各月底 ----
async function yahoo(sym, range) {
  for (const h of ['query1', 'query2', 'query1', 'query2']) {
    try {
      const j = await getJ(`https://${h}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=${range}&events=div`, { tries: 1, timeout: 20000 });
      const r = j?.chart?.result?.[0]; if (!r?.timestamp) return null;
      const adj = r.indicators?.adjclose?.[0]?.adjclose || r.indicators.quote[0].close, cl = r.indicators.quote[0].close;
      const out = []; r.timestamp.forEach((t, i) => { if (adj[i] != null && cl[i] != null) out.push([tpDate(t), adj[i], cl[i]]); });
      return out;
    } catch (e) { await sleep(800); }
  }
  return null;
}
const b50 = await yahoo('0050.TW', '5y');
if (!b50 || b50.length < 200) { console.error('抓不到 0050 日線，不更新'); process.exit(1); }
// 月底日：0050 日線中，每個月最後一個交易日（asof 所在月用 asof）
const lastOfMonth = {};
for (const [d] of b50) lastOfMonth[d.slice(0, 7)] = d;
const ym = asof.slice(0, 7);
const months = [...new Set(Object.keys(lastOfMonth))].sort().filter((m) => m < ym).slice(-12);
const anchors = [...months.map((m) => lastOfMonth[m]), asof];
if (anchors.length !== 13) { console.error('月底日不足 13 個：' + anchors.length); process.exit(1); }
const gapOk = anchors.every((d, i) => i === 0 || (new Date(d) - new Date(anchors[i - 1])) / 864e5 <= 36);
if (!gapOk) { console.error('月底日間隔異常，不更新', anchors.join()); process.exit(1); }

let miss = 0, pxBad = [];
await pool(cand, 6, async (r, k) => {
  const s = await yahoo(`${r.code}.TW`, '15mo');
  if (!s) { miss++; r.hist = null; return; }
  const m = new Map(s.map(([d, a, c]) => [d, [a, c]]));
  r.hist = anchors.map((d) => m.get(d)?.[0] ?? null);
  const last = m.get(asof);
  if (last && Math.abs(last[1] / r.close - 1) > 0.015) pxBad.push(`${r.code}:${last[1]}/${r.close}`);
  if ((k + 1) % 60 === 0) console.log(`Yahoo 進度 ${k + 1}/${cand.length}`);
});
console.log(`Yahoo 沒抓到 ${miss} 檔；收盤價與證交所差 >1.5% 的 ${pxBad.length} 檔 ${pxBad.slice(0, 8).join(' ')}`);
if (miss > cand.length * 0.15) { console.error('Yahoo 失敗太多，不更新'); process.exit(1); }

// ---- 3) 排名 ----
const merged = rows.map((r) => (r.hist ? r : { ...r, hist: null }));
const { universe, ranked } = s6uRank(merged);
if (universe < 230) { console.error('合格股票太少（' + universe + '），不更新'); process.exit(1); }
const dow = new Date(asof + 'T00:00:00Z').getUTCDay(), nextWd = new Date(new Date(asof + 'T00:00:00Z').getTime() + (dow === 5 ? 3 : dow === 6 ? 2 : 1) * 864e5).toISOString().slice(0, 7);
const official = nextWd !== ym; // 隔一個營業日就換月 → 今天是月底最後一個營業日（碰到連假的月底會晚一天才標成正式，見 months）
const rd = (x, n = 4) => (Number.isFinite(x) ? +x.toFixed(n) : null);
const list = ranked.map((o) => ({ code: o.code, name: o.name, close: o.close, rank: o.rank, score: rd(o.score), value: rd(o.fam.value, 3), lowvol: rd(o.fam.lowvol, 3), trend: rd(o.fam.trend, 3), pe: o.raw.pe, pb: o.raw.pb, dy: o.raw.dy, mom: rd(o.raw.mom, 3), vol: rd(o.raw.vol, 3) }));

// ---- 4) 歷史月底記錄（先讀回舊的接著寫）----
let prev = null;
if (repo) for (let t = 0; t < 4 && prev === null; t++) {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/snap3/${KEY}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (r.status === 404) { prev = { months: [] }; break; }
    if (r.ok) prev = await r.json(); else throw new Error('HTTP ' + r.status);
  } catch (e) { if (t === 3) { if (canPush) { console.error('讀不到舊的名單記錄，為了不弄丟記錄，這次不推送：' + e.message); process.exit(1); } prev = { months: [] }; } else await sleep(4000); }
}
// 網站剛上線時 snap3 還沒有任何月底記錄：用 2026-10 月底的名單（Python 回測面板重算、與回測逐檔一致）當第一份正式名單
if (!(prev?.months || []).length) { try { prev = { ...(prev || {}), months: [JSON.parse(fs.readFileSync(new URL('./s6u_seed.json', import.meta.url)))] }; } catch (e) { console.log('沒有種子名單', e.message); } }
const monthsLog = (prev?.months || []).filter((e) => e.month !== ym);
monthsLog.push({ month: ym, day: asof, official, top: list.slice(0, 60).map((x) => [x.code, x.name, x.close, x.rank]) });
monthsLog.sort((a, b) => (a.month < b.month ? -1 : 1)); while (monthsLog.length > 48) monthsLog.shift();
// 正式名單＝最近一個「已確定」的月份：該月最後一次計算時是月底最後營業日，或已經有更晚的月份記錄
const finalIdx = (() => { for (let i = monthsLog.length - 1; i >= 0; i--) { const e = monthsLog[i]; if (e.official || i < monthsLog.length - 1) return i; } return -1; })();
const finalEntry = finalIdx >= 0 ? monthsLog[finalIdx] : null;
const bench = b50.filter(([d]) => d >= '2023-01-01').map(([d, , c]) => [d, +c.toFixed(2)]);
const out = { asof, official, month: ym, universe, updatedAt: Date.now(), nBought: 0, list, months: monthsLog, finalMonth: finalEntry?.month || null, bench,
  check: { cand: cand.length, yahooMiss: miss, pxBad: pxBad.length } };
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, KEY), JSON.stringify(out));
console.log(`完成：母體 ${universe} 檔，收盤日 ${asof}${official ? '（月底，正式名單）' : '（預覽）'}，前 10 名：${list.slice(0, 10).map((x) => x.code + x.name).join(' ')}，檔案 ${(fs.statSync(path.join(OUT, KEY)).size / 1024).toFixed(0)} KB`);
if (!canPush) { console.log('不推送，輸出在', OUT); process.exit(0); }
const git = (...a) => execFileSync('git', a, { cwd: OUT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git('init', '-q', '-b', 'snap3'); git('remote', 'add', 'origin', `https://x-access-token:${tok}@github.com/${repo}.git`);
git('config', 'user.name', 'whale-radar-snap'); git('config', 'user.email', 'snap@users.noreply.github.com');
git('add', '-A'); git('commit', '-q', '-m', 's6u ' + new Date().toISOString());
git('push', '-q', '-f', 'origin', 'snap3:refs/heads/snap3');
console.log('已推到 snap3 分支');
