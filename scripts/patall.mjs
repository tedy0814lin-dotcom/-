// 每天收盤後算一次「全部台股」的 K 線＋型態（沒有型態也算），依代號前兩碼分成 pp_tw_NN.json，推到 snap2 分支。
// 網站搜尋框輸入掃描清單以外的股票時，讀對應的那一份（見 functions/snap/[key].js、static.js）。
// 獨立於主排程（alert.yml）：失敗不影響警報與快照。
process.env.SNAPSHOT ??= '1';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { get } from './_api.mjs';

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
// ---- 大單推升的頂背離標記（lib/pickDiv.js）：全部台股，選股頁用它把「帶頂背離」的訊號移出優先名單；策略實盤記錄（slog.mjs）也讀這份 ----
{
  const dcount = {}; for (const r of Object.values(results)) if (r.d1) dcount[r.d1] = (dcount[r.d1] || 0) + 1;
  const asofMD = Object.entries(dcount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const yr = +day.slice(0, 4) - (asofMD > day.slice(5) ? 1 : 0), asof = asofMD ? `${yr}-${asofMD}` : day;
  const flags = {};
  for (const [code, r] of Object.entries(results)) if (r.pkd != null && r.d1 === asofMD) flags[code] = r.pkd;
  if (Object.keys(flags).length >= 300) {
    fs.writeFileSync(path.join(OUT, 'pp_pkdiv.json'), JSON.stringify({ asof, n: Object.keys(flags).length, flags }));
    console.log(`頂背離標記：${Object.keys(flags).length} 檔，其中有標記 ${Object.values(flags).filter(Boolean).length} 檔，收盤日 ${asof}`);
  } else console.log('頂背離標記：可算的太少（' + Object.keys(flags).length + '），這次不輸出');
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
