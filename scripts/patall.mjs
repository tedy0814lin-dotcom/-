// 每天收盤後算一次「全部台股」的 K 線＋型態（沒有型態也算），依代號前兩碼分成 pp_tw_NN.json，推到 snap2 分支。
// 網站搜尋框輸入掃描清單以外的股票時，讀對應的那一份（見 functions/snap/[key].js、static.js）。
// 獨立於主排程（alert.yml）：失敗不影響警報與快照。
process.env.SNAPSHOT ??= '1';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { get } from './_api.mjs';
import { rankFactors } from '../lib/factorTw.js';

const OUT = process.env.OUT || 'patall-out';
const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
const canPush = !!(repo && tok) && process.env.NOPUSH !== '1';
const url = canPush ? `https://x-access-token:${tok}@github.com/${repo}.git` : null;
const LIMIT = +process.env.LIMIT || 0; // 本機測試用：只算前 N 檔
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };

fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const tw = await get('/api/twstock');
let codes = [...new Set((tw.rows || []).filter((r) => /^\d{4}$/.test(r.code) && r.close > 0).map((r) => r.code))].sort();
if (LIMIT) codes = codes.slice(0, LIMIT);
console.log('全部台股', codes.length, '檔');
const parts = []; for (let i = 0; i < codes.length; i += 12) parts.push(codes.slice(i, i + 12));
const results = {}, miss = []; let day = '', done = 0;
await pool(parts, 2, async (p) => {
  for (let t = 0; t < 2; t++) {
    try { const j = await get('/api/twhist?pat=1&plain=1&codes=' + p.join(',')); Object.assign(results, j.results); miss.push(...(j.miss || [])); day = j.day || day; break; }
    catch (e) { if (t) miss.push(...p); await new Promise((r) => setTimeout(r, 3000)); }
  }
  if (++done % 20 === 0) console.log(`進度 ${done}/${parts.length}`);
});
// ---- 台股四因子排名（觀察用）：每天收盤後把全部台股的因子原始值排名，前 20 名存起來並累積前瞻記錄 ----
// 前瞻記錄（log）＝每個收盤日的前 20 名與當天收盤價、0050 收盤價；snap2 每天重建，所以要先把舊的讀回來接著寫。
const FKEY = 'pp_factor_tw.json';
{
  const nameOf = Object.fromEntries((tw.rows || []).map((r) => [r.code, r.name]));
  const dcount = {}; for (const r of Object.values(results)) if (r.d1) dcount[r.d1] = (dcount[r.d1] || 0) + 1;
  const asofMD = Object.entries(dcount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';   // 最多股票的最後一根日 K 日期（MM-DD）
  // 只排名「最後一根日 K 就是這天」的股票（Yahoo 當天資料還沒更新的、或日期不同的，不混進來）
  const rows = Object.entries(results).map(([code, r]) => (r.fac && r.d1 === asofMD ? { code, ...r.fac } : null)).filter(Boolean);
  const yr = +day.slice(0, 4) - (asofMD > day.slice(5) ? 1 : 0), asof = asofMD ? `${yr}-${asofMD}` : day;
  const ranked = rankFactors(rows);
  if (ranked.length >= 300) {
    let prev = null;
    if (repo) for (let t = 0; t < 4 && prev === null; t++) {
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${repo}/snap2/${FKEY}`, { headers: { 'Cache-Control': 'no-cache' } });
        if (r.status === 404) { prev = { log: [] }; break; }
        if (r.ok) prev = await r.json(); else throw new Error('HTTP ' + r.status);
      } catch (e) { if (t === 3) { if (canPush) { console.error('讀不到舊的因子前瞻記錄，為了不弄丟記錄，這次不推送：' + e.message); process.exit(1); } prev = { log: [] }; } else await new Promise((r2) => setTimeout(r2, 4000)); }
    }
    const log = (prev?.log || []).filter((e) => e.day !== asof);
    const top20 = ranked.slice(0, 20);
    log.push({ day: asof, bm: results['0050']?.d1 === asofMD ? results['0050'].close : null, picks: top20.map((r) => [r.code, r.c]) });
    log.sort((a, b) => (a.day < b.day ? -1 : 1)); while (log.length > 80) log.shift();
    const need = new Set(log.flatMap((e) => e.picks.map((x) => x[0]))); const closes = {};
    for (const c of need) if (results[c]?.close != null) closes[c] = results[c].close;
    const bm0 = results['0050']?.d1 === asofMD ? results['0050'].close : null;
    const out = { asof, universe: ranked.length, bm: bm0, closes,
      top: ranked.slice(0, 50).map((r) => ({ code: r.code, name: nameOf[r.code] || '', c: r.c, score: +r.score.toFixed(4), rank: Object.fromEntries(Object.entries(r.rank).map(([k, v]) => [k, +v.toFixed(3)])), raw: { h250: r.h250, mom: r.mom, intra: r.intra, vol: r.vol } })), log };
    fs.writeFileSync(path.join(OUT, FKEY), JSON.stringify(out));
    console.log(`因子排名：母體 ${ranked.length} 檔，收盤日 ${asof}，前瞻記錄 ${log.length} 天`);
  } else console.log('因子排名：母體太少（' + ranked.length + '），這次不輸出');
}
const shards = {};
for (const [c, r] of Object.entries(results)) (shards[c.slice(0, 2)] ||= {})[c] = r;
for (const [k, v] of Object.entries(shards)) fs.writeFileSync(path.join(OUT, `pp_tw_${k}.json`), JSON.stringify({ day, results: v }));
fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify({ at: Date.now(), day, ok: Object.keys(results).length, miss: miss.length }));
console.log(`完成：${Object.keys(results).length} 檔、${miss.length} 檔沒抓到、${Object.keys(shards).length} 份`);
if (Object.keys(results).length < codes.length * 0.5 && !LIMIT) { console.error('成功率太低，不推送（保留舊的）'); process.exit(1); }
if (!canPush) { console.log('不推送，輸出在', OUT); process.exit(0); }
const git = (...a) => execFileSync('git', a, { cwd: OUT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git('init', '-q', '-b', 'snap2'); git('remote', 'add', 'origin', url);
git('config', 'user.name', 'whale-radar-snap'); git('config', 'user.email', 'snap@users.noreply.github.com');
git('add', '-A'); git('commit', '-q', '-m', 'patall ' + new Date().toISOString());
git('push', '-q', '-f', 'origin', 'snap2:refs/heads/snap2');
console.log('已推到 snap2 分支');
