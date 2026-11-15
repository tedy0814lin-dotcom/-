// 每天收盤後算一次「全部台股」的 K 線＋型態（沒有型態也算），依代號前兩碼分成 pp_tw_NN.json，推到 snap2 分支。
// 網站搜尋框輸入掃描清單以外的股票時，讀對應的那一份（見 functions/snap/[key].js、static.js）。
// 獨立於主排程（alert.yml）：失敗不影響警報與快照。
process.env.SNAPSHOT ??= '1';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { get } from './_api.mjs';
import { crossSection } from '../lib/diagTw.js';

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
// ---- 持股診斷（lib/diagTw.js）：全部台股的弱勢／強勢旗標與趨勢分數，輸出 pp_diag.json（診斷頁讀這份；定義與 Python 回測 pk/wk3.py 逐檔對照過）----
{
  const names = Object.fromEntries((tw.rows || []).map((r) => [r.code, r.name]));
  const codesD = Object.keys(results).filter((c) => !/^00/.test(c) && results[c]?.dg && Number.isFinite(results[c].dg.c));
  const dayCount = {}; for (const c of codesD) dayCount[results[c].dg.day] = (dayCount[results[c].dg.day] || 0) + 1;
  const asofD = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  // 只用「最後一根 K 棒日期＝多數日期」的股票（停牌或資料落後的不混進當日橫斷面）
  const cur = codesD.filter((c) => results[c].dg.day === asofD);
  const cs = crossSection(cur.map((c) => ({ c: results[c].dg.c, v: results[c].dg.v, ma200: results[c].dg.ma200, hi250: results[c].dg.hi250, mom: results[c].dg.mom, near: results[c].dg.near, lvl: results[c].dg.lvl })));
  if (cs.nOk >= 300) {
    const q5 = (x) => (Number.isFinite(x) ? +Number(x).toPrecision(6) : null);
    const rows = {};
    cur.forEach((c, i) => {
      const g = cs.rows[i], d = results[c].dg;
      // [名稱, 原始收盤, 調整收盤, 200日線, 250日高, 動能, 距高點, 趨勢分數, 趨勢百分位, 旗標位元(A1 B2 C4 D8 強16), 20日均量(張), 是否在母體(ok)]
      rows[c] = [names[c] || '', q5(d.px), q5(d.c), q5(d.ma200), q5(d.hi250), q5(d.mom), q5(d.near), q5(g.tScore), q5(g.tPct), (g.A ? 1 : 0) | (g.B ? 2 : 0) | (g.C ? 4 : 0) | (g.D ? 8 : 0) | (g.S ? 16 : 0), Math.round(d.v20 || 0), g.ok ? 1 : 0];
    });
    fs.writeFileSync(path.join(OUT, 'pp_diag.json'), JSON.stringify({ asof: asofD, n: cur.length, nOk: cs.nOk, q: cs.q, cols: ['name', 'px', 'adj', 'ma200', 'hi250', 'mom', 'near', 'tScore', 'tPct', 'flags', 'v20', 'ok'], rows }));
    console.log(`持股診斷：${cur.length} 檔（母體內 ${cs.nOk}），收盤日 ${asofD}；弱A ${cs.rows.filter((g) => g.A).length}、弱B ${cs.rows.filter((g) => g.B).length}、強 ${cs.rows.filter((g) => g.S).length}`);
  } else console.log('持股診斷：母體內可算的太少（' + cs.nOk + '），這次不輸出');
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
