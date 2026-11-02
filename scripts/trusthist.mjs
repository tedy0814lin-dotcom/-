// 投信買賣超歷史：從 2021-01 起，每個交易日的投信買賣超（張，上市＋上櫃），存在 data 分支 trust_hist.json。
// 證交所會擋我的開發環境，所以經過網站的 /api/trust（Vercel 日本主機抓得到）；可以中斷後接著抓、每天補最新。
// 環境變數：ALERT_KEY（必要）、SITE、GITHUB_TOKEN、GITHUB_REPOSITORY
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = process.env.SITE || 'https://whale-radar-three.vercel.app';
const KEY = process.env.ALERT_KEY;
const DIR = 'trusthist', FILE = DIR + '/trust_hist.json';
const START = '20210104';
if (!KEY) { console.log('沒有 ALERT_KEY'); process.exit(0); }

const git = (...a) => execFileSync('git', a, { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
const url = `https://x-access-token:${tok}@github.com/${repo}.git`;
execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'data', url, DIR]);
git('config', 'user.name', 'whale-radar-log'); git('config', 'user.email', 'log@users.noreply.github.com');

let db = { days: [], d: {}, names: {}, tpexMiss: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}

const ymdOf = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const parse = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
const last = db.days[db.days.length - 1];
const today = ymdOf(new Date(Date.now() + 8 * 3600e3));
let cur = last ? parse(last) : parse(START);
if (last) cur.setUTCDate(cur.getUTCDate() + 1);
console.log('從', ymdOf(cur), '抓到', today, '已有', db.days.length, '天');

function save(msg) {
  db.days.sort(); fs.writeFileSync(FILE, JSON.stringify(db));
  fs.writeFileSync(DIR + '/vercel.json', JSON.stringify({ git: { deploymentEnabled: false } }));
  git('add', 'trust_hist.json', 'vercel.json');
  if (!git('status', '--porcelain').trim()) return;
  git('commit', '-q', '-m', msg);
  try { git('push', '-q', 'origin', 'data'); } catch { git('pull', '--rebase', '-q', 'origin', 'data'); git('push', '-q', 'origin', 'data'); }
}

async function chunk(from, to) {
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(`${SITE}/api/trust?from=${from}&to=${to}`, { headers: { 'x-alert-key': KEY } });
      if (r.ok) return await r.json();
      console.log('HTTP', r.status, from, to);
    } catch (e) { console.log('錯誤', e.message); }
    await new Promise((r) => setTimeout(r, 5000 * (k + 1)));
  }
  return null;
}

let n = 0, fail = 0;
const t0 = Date.now();
while (ymdOf(cur) <= today && Date.now() - t0 < 100 * 60e3) {
  const from = ymdOf(cur); const end = new Date(cur); end.setUTCDate(end.getUTCDate() + 15);
  const to = ymdOf(end) > today ? today : ymdOf(end);
  const j = await chunk(from, to);
  if (!j) { if (++fail >= 3) break; continue; }
  fail = 0;
  j.days.forEach((ymd, i) => {
    const o = {};
    for (const [code, arr] of Object.entries(j.net)) if (arr[i]) o[code] = arr[i];
    db.d[ymd] = o; if (!db.days.includes(ymd)) db.days.push(ymd);
  });
  Object.assign(db.names, j.names); db.tpexMiss.push(...(j.tpexMiss || []));
  console.log(from, to, '交易日', j.days.length, '上櫃缺', (j.tpexMiss || []).length);
  cur = new Date(end); cur.setUTCDate(cur.getUTCDate() + 1);
  if (++n % 10 === 0) save(`投信歷史 ${from}`);
}
save(`投信歷史 至 ${db.days[db.days.length - 1]}`);
console.log('完成，共', db.days.length, '天');
