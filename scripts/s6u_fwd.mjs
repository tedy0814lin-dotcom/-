// 三因子長期前瞻記錄：讀 snap3 的 s6_u.json（每日名單與月底記錄）與自己上次的 s6_fwd.json，更新後推到 fwd 分支（獨立於 snap3：s6u.mjs 每次都強制覆蓋 snap3）。
// 用法：node scripts/s6u_fwd.mjs [--src s6_u.json 路徑或網址] [--prev s6_fwd.json 路徑] ；有 GITHUB_REPOSITORY＋GITHUB_TOKEN 且未設 NOPUSH=1 才推送。
// 邏輯與測試見 lib/s6uFwd.js、scripts/s6uFwd.test.mjs。記錄只是「正式名單當時的前 15 名之後表現」，不影響網站與 s6u 排程。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { step, summarize } from '../lib/s6uFwd.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
const canPush = !!(repo && tok) && process.env.NOPUSH !== '1';
const OUT = process.env.OUT || 's6u-fwd-out', KEY = 's6_fwd.json';
async function load(src, { allow404 = false } = {}) {
  if (!/^https?:/.test(src)) return fs.existsSync(src) ? JSON.parse(fs.readFileSync(src, 'utf8')) : null;
  for (let t = 0; t < 4; t++) {
    try { const r = await fetch(src, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) }); if (r.status === 404 && allow404) return null; if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
  }
  throw new Error('讀不到 ' + src);
}
const srcDef = repo ? `https://raw.githubusercontent.com/${repo}/snap3/s6_u.json` : 's6_u.json';
const snap = await load(arg('--src', srcDef));
if (!snap?.list?.length || !snap.asof || !Array.isArray(snap.months)) { console.error('s6_u.json 格式不對或沒有名單，不更新'); process.exit(1); }
const prevSrc = arg('--prev', repo ? `https://raw.githubusercontent.com/${repo}/fwd/${KEY}` : KEY);
let prev = null;
try { prev = await load(prevSrc, { allow404: true }); } catch (e) { if (canPush) { console.error('讀不到舊的前瞻記錄，為了不弄丟記錄，這次不推送：' + e.message); process.exit(1); } }
// 上次的 asof 比這次還新（讀到舊快取）→ 不倒退
if (prev?.current?.asof && prev.current.asof > snap.asof) { console.log('名單資料比記錄舊，不更新'); process.exit(0); }
// 持股若掉出母體（成交值前 300）就不在 list 裡：用證交所當日全部上市證券收盤補價，且只在日期與 asof 相同時才用
const held = new Set((prev?.periods || []).filter((p) => !p.end).flatMap((p) => Object.values(p.holdings).flat().map((h) => h.code)));
for (const e of snap.months.filter((m) => m.official).slice(-1)) for (const k of ['top', 'topM']) for (const x of (e[k] || []).slice(0, 15)) held.add(x[0]);
const inList = new Set(snap.list.map((x) => x.code));
if ([...held].some((c) => !inList.has(c))) {
  try {
    const all = await load('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    const d = String(all.find((r) => r.Date)?.Date || ''), iso = d.length === 7 ? `${+d.slice(0, 3) + 1911}-${d.slice(3, 5)}-${d.slice(5, 7)}` : '';
    if (iso === snap.asof) { snap.extra = {}; for (const r of all) { const v = Number(String(r.ClosingPrice || '').replace(/,/g, '')); if (held.has(r.Code) && !inList.has(r.Code) && v > 0) snap.extra[r.Code] = v; } console.log('補價（母體外持股）：', JSON.stringify(snap.extra)); }
    else console.log(`證交所全部證券日期(${iso})與名單日期(${snap.asof})不同，不補價`);
  } catch (e) { console.log('補價失敗，缺價者不計入：' + e.message); }
}
const rec = step(prev, snap);
const S = summarize(rec);
const out = { ...rec, summary: S, updatedAt: Date.now() };
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, KEY), JSON.stringify(out));
const c = rec.current, pct = (x) => (x == null ? '—' : (x * 100).toFixed(2) + '%');
console.log(`前瞻記錄：已結算 ${S.months} 個月（補算 ${S.late}）；目前這期自 ${c?.since || '—'} 到 ${c?.asof || '—'}：保守 ${pct(c?.ret?.base)}、平衡 ${pct(c?.ret?.R)}、0050 ${pct(c?.bench)}（價格口徑，不含股息）`);
if (c && (c.miss.base.length || c.miss.R.length)) console.log('今日名單內缺收盤價：保守', c.miss.base.join(','), '平衡', c.miss.R.join(','));
if (!canPush) { console.log('不推送，輸出在', OUT); process.exit(0); }
const git = (...a) => execFileSync('git', a, { cwd: OUT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git('init', '-q', '-b', 'fwd'); git('remote', 'add', 'origin', `https://x-access-token:${tok}@github.com/${repo}.git`);
git('config', 'user.name', 'whale-radar-snap'); git('config', 'user.email', 'snap@users.noreply.github.com');
git('add', '-A'); git('commit', '-q', '-m', 's6u-fwd ' + new Date().toISOString());
git('push', '-q', '-f', 'origin', 'fwd:refs/heads/fwd');
console.log('已推到 fwd 分支');
