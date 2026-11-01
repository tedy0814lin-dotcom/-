// 數據記錄：把網站所有策略（含不計分的觀察策略，例如維加斯通道）成立的訊號存下來，
// 之後自動追蹤到停損／目標，算扣手續費後的實際 R，結果存在 repo 的 data 分支 signals.json（網站「數據記錄」分頁讀它）。
// 規則跟回測一致：加密來回手續費 0.1%、停損 > 25% 的不算、同一根 K 棒停損目標都碰到算停損（保守）、最多追 14 天。
// 需要的環境變數：SITE、ALERT_KEY；要推回 GitHub 還要 GITHUB_TOKEN、GITHUB_REPOSITORY（Actions 會自動給）
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = process.env.SITE || 'https://whale-radar-three.vercel.app';
const KEY = process.env.ALERT_KEY;
const DIR = 'datalog', FILE = DIR + '/signals.json';
const FEE = 0.001, MAX_STOP = 0.25, WAIT_MS = 48 * 3600e3, HOLD_MS = 14 * 864e5, KEEP_MS = 120 * 864e5;
if (!KEY) { console.log('沒有 ALERT_KEY，略過數據記錄'); process.exit(0); }

const git = (...a) => execFileSync('git', a, { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
function prepare() {
  const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
  if (fs.existsSync(DIR + '/.git')) { try { git('pull', '--rebase', '-q'); } catch {} return; }
  if (!repo || !tok) { fs.mkdirSync(DIR, { recursive: true }); return; } // 本機測試：只寫檔
  const url = `https://x-access-token:${tok}@github.com/${repo}.git`;
  try { execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'data', url, DIR]); }
  catch { // 還沒有 data 分支：建一個空的
    fs.mkdirSync(DIR, { recursive: true });
    git('init', '-q', '-b', 'data'); git('remote', 'add', 'origin', url);
  }
  git('config', 'user.name', 'whale-radar-log'); git('config', 'user.email', 'log@users.noreply.github.com');
}

async function get(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(SITE + path, { headers: { 'x-alert-key': KEY } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    } catch (e) { if (i === 2) throw e; await new Promise((ok) => setTimeout(ok, 4000)); }
  }
}

prepare();
let db = { items: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const now = Date.now();
const have = new Set(db.items.map((x) => x.id));
const rnd = (v) => +Number(v).toPrecision(6);

// 1) 新訊號
try {
  const { items } = await get('/api/alert?m=log');
  let added = 0;
  for (const x of items) {
    const id = [x.s, x.k, x.tf, rnd(x.entry), rnd(x.stop)].join('|');
    if (have.has(id)) continue;
    have.add(id); added++;
    const it = { id, s: x.s, k: x.k, tf: x.tf, dir: x.dir, entry: x.entry, stop: x.stop, target: x.target, wait: x.wait, t: now, st: x.wait ? 'pending' : 'open' };
    if (!x.wait) {
      // 市價單：用掃到這一刻的價格當成交價；價格已經越過停損或目標就不算
      const f = x.px, bad = !(f > 0) || (f - x.stop) * x.dir <= 0 || (x.target - f) * x.dir <= 0;
      it.fill = f; it.tFill = now;
      if (bad) it.st = 'invalid';
    }
    const fill = it.fill ?? x.entry;
    if (Math.abs(fill - x.stop) / fill > MAX_STOP) it.st = 'invalid';
    db.items.push(it);
  }
  console.log(`數據記錄：掃到 ${items.length} 個計畫，新增 ${added}`);
} catch (e) { console.error('數據記錄取訊號失敗', e.message); }

// 2) 追蹤沒結束的
const live = db.items.filter((x) => x.st === 'pending' || x.st === 'open');
const bySym = {};
for (const x of live) (bySym[x.s] ||= []).push(x);
const net = (x, exit) => {
  const risk = Math.abs(x.fill - x.stop);
  return x.dir * (exit - x.fill) / risk - FEE * x.fill / risk;
};
for (const [sym, list] of Object.entries(bySym)) {
  let bars;
  try {
    const from = Math.min(...list.map((x) => x.tFill || x.t));
    bars = (await get(`/api/alert?m=klines&s=${sym}&from=${from}`)).k;
  } catch (e) { console.error('K 線失敗', sym, e.message); continue; }
  for (const x of list) {
    for (const [t, h, l, c] of bars) {
      if (t < (x.tFill || x.t)) continue;
      let filledNow = false;
      if (x.st === 'pending') {
        const touch = x.dir > 0 ? l <= x.entry : h >= x.entry;
        if (!touch) { if (t - x.t > WAIT_MS) { x.st = 'expired'; x.tEnd = t; break; } continue; }
        x.fill = x.entry; x.tFill = t; x.st = 'open'; filledNow = true;
        if (Math.abs(x.fill - x.stop) / x.fill > MAX_STOP) { x.st = 'invalid'; break; }
      }
      const hitS = x.dir > 0 ? l <= x.stop : h >= x.stop;
      // 掛單成交的那根 K 棒不知道是先成交還是先到目標，保守起見只看停損
      const hitT = !filledNow && (x.dir > 0 ? h >= x.target : l <= x.target);
      if (hitS) { x.st = 'loss'; x.tEnd = t; x.R = +net(x, x.stop).toFixed(3); break; }
      if (hitT) { x.st = 'win'; x.tEnd = t; x.R = +net(x, x.target).toFixed(3); break; }
      if (t - x.tFill > HOLD_MS) { x.st = 'timeout'; x.tEnd = t; x.R = +net(x, c).toFixed(3); break; }
    }
    if (x.st === 'pending' && now - x.t > WAIT_MS) { x.st = 'expired'; x.tEnd = now; }
  }
}

db.items = db.items.filter((x) => now - x.t < KEEP_MS);
db.updated = now;
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(db));
const cnt = {}; for (const x of db.items) cnt[x.st] = (cnt[x.st] || 0) + 1;
console.log('數據記錄現況', JSON.stringify(cnt));

if (fs.existsSync(DIR + '/.git')) {
  try {
    git('add', 'signals.json');
    if (git('status', '--porcelain').trim()) {
      git('commit', '-q', '-m', '數據記錄 ' + new Date(now).toISOString().slice(0, 16));
      try { git('push', '-q', 'origin', 'data'); } catch { git('pull', '--rebase', '-q', 'origin', 'data'); git('push', '-q', 'origin', 'data'); }
    }
  } catch (e) { console.error('推回 GitHub 失敗', String(e.stderr || e.message).slice(0, 300)); }
}
