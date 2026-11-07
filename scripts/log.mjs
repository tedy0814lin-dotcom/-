// 數據記錄：把網站所有策略（含不計分的觀察策略，例如維加斯通道）成立的訊號存下來，
// 之後自動追蹤到停損／目標，算扣手續費後的實際 R，結果存在 repo 的 data 分支 signals.json（網站「數據記錄」分頁讀它）。
// 規則跟回測一致：加密來回手續費 0.1%、停損 > 25% 的不算、同一根 K 棒停損目標都碰到算停損（保守）、最多追 14 天（4H 40 天、12H 與日線 60 天）。
// 需要的環境變數：SITE、ALERT_KEY；要推回 GitHub 還要 GITHUB_TOKEN、GITHUB_REPOSITORY（Actions 會自動給）
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = process.env.SITE || 'https://whale-radar-three.vercel.app';
const KEY = process.env.ALERT_KEY;
const DIR = 'datalog', FILE = DIR + '/signals.json';
const FEE = 0.001, MAX_STOP = 0.25, WAIT_MS = 48 * 3600e3, HOLD_D = { '4H': 40, '12H': 60, '1D': 60 }, holdMs = (x) => (HOLD_D[x.tf] || 14) * 864e5, KEEP_MS = 1100 * 864e5;
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

import { get } from './_api.mjs'; // 直接在這台主機算（不再呼叫網站）

prepare();
let db = { items: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const now = Date.now();
const rnd = (v) => +Number(v).toPrecision(6);
// 同一個訊號會連續好幾次掃到（例如 MACD 底背離會持續 15 根 K 棒、進場價是即時價格會一直變），不能重複記：
// 同一檔、同策略、同時區、同方向，停損價相同（差 < 0.2%），而且前一筆是 48 小時內記的、或還沒結算 → 算同一個
const sameSig = (a, b) => a.s === b.s && a.k === b.k && a.tf === b.tf && a.dir === b.dir && Math.abs(a.stop - b.stop) / b.stop < 0.002;
const isDup = (kept, x) => kept.some((e) => sameSig(e, x) && (Math.abs(x.t - e.t) < 48 * 3600e3 || e.st === 'open' || e.st === 'pending'));
{ // 清掉以前已經重複記的
  const kept = [];
  for (const x of [...db.items].sort((a, b) => a.t - b.t)) if (!isDup(kept, x)) kept.push(x);
  if (kept.length !== db.items.length) console.log(`清掉重複記錄 ${db.items.length - kept.length} 筆`);
  db.items = kept;
}
const have = new Set(db.items.map((x) => x.id));

// 1) 新訊號
try {
  const { items, btc24, btcUp } = await get('/api/alert?m=log');
  let added = 0;
  for (const x of items) {
    const id = [x.s, x.k, x.tf, rnd(x.entry), rnd(x.stop)].join('|');
    if (have.has(id)) continue;
    have.add(id);
    const cand = { s: x.s, k: x.k, tf: x.tf, dir: x.dir, stop: x.stop, t: now };
    if (isDup(db.items, cand)) continue;
    added++;
    const it = { id, s: x.s, k: x.k, tf: x.tf, dir: x.dir, entry: x.entry, stop: x.stop, target: x.target, wait: x.wait, t: now, st: x.wait ? 'pending' : 'open', b24: btc24 ?? null, bUp: btcUp ?? null, np: x.np ?? null, tl: x.tl ?? null, fu: x.fu ?? null, o24: x.o24 ?? null, t24: x.t24 ?? null };
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

// 2) 追蹤＋分析：結算後還繼續追到 14 天，才能回答「停損後有沒有又走到目標（停損太近？）」「停損／止盈放別的會怎樣（設定問題 vs 策略問題）」
// 每筆記錄：sp 停損距離（占進場價 %）、mfe 結算前最多賺到幾 R、eb 幾根 15 分 K 就出場、recov 停損後 14 天內是否又到原目標、
//          btc 進場到出場 BTC 漲跌 %、b24／bUp 進場時 BTC 24h 漲跌與是否在日線 EMA50 上、g 停損×止盈假設表（新風險為單位的扣費後 R）
const GS = [1, 1.5, 2], GT = [1, 2, 3, 4, 6];
const need = db.items.filter((x) => x.st === 'pending' || x.st === 'open' || (['win', 'loss', 'timeout'].includes(x.st) && !x.fin && x.tFill));
const bySym = {};
for (const x of need) (bySym[x.s] ||= []).push(x);
const feeR = (x, k) => FEE * x.fill / (k * Math.abs(x.fill - x.stop));

function scan(x, bars) {
  const d = x.dir, risk = Math.abs(x.fill - x.stop), cells = GS.flatMap((sm) => GT.map((T) => ({ sm, T, v: null })));
  let mfe = 0, n = 0, exit = null, recov = false, lastC = null, lastT = 0;
  for (const [t, h, l, c] of bars) {
    if (t < x.tFill) continue;
    n++; lastC = c; lastT = t;
    const fillBar = x.wait && t === x.tFill;           // 掛單成交的那根：不知道先後，只看不利方向
    const fav = fillBar ? 0 : (d > 0 ? (h - x.fill) : (x.fill - l)) / risk;
    const adv = (d > 0 ? (x.fill - l) : (h - x.fill)) / risk;
    for (const k of cells) {
      if (k.v != null) continue;
      if (adv >= k.sm) k.v = -1 - feeR(x, k.sm);
      else if (fav >= k.T * k.sm) k.v = k.T - feeR(x, k.sm);
    }
    if (!exit) {
      if (adv >= 1) exit = { st: 'loss', t, price: x.stop, n };
      else if (!fillBar && (d > 0 ? h >= x.target : l <= x.target)) exit = { st: 'win', t, price: x.target, n };
      else if (t - x.tFill > holdMs(x)) exit = { st: 'timeout', t, price: c, n };
      else mfe = Math.max(mfe, fav);
    } else if (exit.st === 'loss' && !recov && (d > 0 ? h >= x.target : l <= x.target)) recov = true;
  }
  const fin = lastT - x.tFill >= holdMs(x);
  if (fin) for (const k of cells) if (k.v == null) k.v = d * (lastC - x.fill) / (k.sm * risk) - feeR(x, k.sm);
  x.sp = +(risk / x.fill).toFixed(4); x.mfe = +mfe.toFixed(2); x.g = cells.map((k) => (k.v == null ? null : +k.v.toFixed(2)));
  if (fin) x.fin = true;
  if (exit) {
    x.st = exit.st; x.tEnd = exit.t; x.eb = exit.n;
    x.R = +(d * (exit.price - x.fill) / risk - FEE * x.fill / risk).toFixed(3);
    if (exit.st === 'loss') x.recov = fin || recov ? recov : null;
  }
}

let btcBars = null;
async function btcRet(x) {
  if (!btcBars) { try { btcBars = (await get(`/api/alert?m=klines&s=BTCUSDT&from=${Math.min(...need.filter((y) => y.tFill).map((y) => y.tFill)) - 36e5}`)).k; } catch { btcBars = []; } }
  const at = (t) => { let c = null; for (const b of btcBars) { if (b[0] <= t) c = b[3]; else break; } return c; };
  const a = at(x.tFill), z = at(x.tEnd);
  return a && z ? +((z / a - 1) * 100).toFixed(2) : null;
}

for (const [sym, list] of Object.entries(bySym)) {
  let bars;
  try {
    const from = Math.min(...list.map((x) => x.tFill || x.t));
    bars = (await get(`/api/alert?m=klines&s=${sym}&from=${from}`)).k;
  } catch (e) { console.error('K 線失敗', sym, e.message); continue; }
  for (const x of list) {
    if (x.st === 'pending') {
      for (const [t, h, l] of bars) {
        if (t < x.t) continue;
        const touch = x.dir > 0 ? l <= x.entry : h >= x.entry;
        if (!touch) { if (t - x.t > WAIT_MS) { x.st = 'expired'; x.tEnd = t; break; } continue; }
        x.fill = x.entry; x.tFill = t; x.st = 'open';
        if (Math.abs(x.fill - x.stop) / x.fill > MAX_STOP) x.st = 'invalid';
        break;
      }
      if (x.st === 'pending' && now - x.t > WAIT_MS) { x.st = 'expired'; x.tEnd = now; }
    }
    if (x.fill != null && ['open', 'win', 'loss', 'timeout'].includes(x.st)) {
      scan(x, bars);
      if (x.tEnd && x.btc === undefined && ['win', 'loss', 'timeout'].includes(x.st)) { const r = await btcRet(x); if (r != null) x.btc = r; }
    }
  }
}

// 記錄不設上限：結算超過 180 天的交易，把「筆數、賺的筆數、R 總和、R 平方和」依月份累加進 db.arch（永久保留、統計照算），
// 明細（價格、虧損原因等）只留近 180 天，這樣檔案不會越長越大、網站不會因為檔案太大讀不出來
const ARCH_MS = 180 * 864e5;
db.arch ||= {};
db.items = db.items.filter((x) => {
  const te = x.tEnd || x.t;
  if (['win', 'loss', 'timeout'].includes(x.st) && x.R != null && now - te >= ARCH_MS) {
    const b = ((db.arch[x.k + '|' + x.tf] ||= {})[new Date(te).toISOString().slice(0, 7)] ||= { n: 0, w: 0, s: 0, q: 0 });
    b.n++; if (x.R > 0) b.w++; b.s += x.R; b.q += x.R * x.R;
    return false;
  }
  return !(['expired', 'invalid'].includes(x.st) && now - x.t >= ARCH_MS); // 沒成交、無效的舊訊號不是交易，直接丟
});
db.updated = now;
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(db));
// data 分支的每次推送不要觸發 Vercel 部署（部署次數有每日上限，之前每 15 分鐘一次會把額度用光、擋住 main 的更新）
fs.writeFileSync(DIR + '/vercel.json', JSON.stringify({ git: { deploymentEnabled: false } }));
const cnt = {}; for (const x of db.items) cnt[x.st] = (cnt[x.st] || 0) + 1;
console.log('數據記錄現況', JSON.stringify(cnt));

if (fs.existsSync(DIR + '/.git')) {
  try {
    git('add', 'signals.json', 'vercel.json');
    if (git('status', '--porcelain').trim()) {
      git('commit', '-q', '-m', '數據記錄 ' + new Date(now).toISOString().slice(0, 16));
      try { git('push', '-q', 'origin', 'data'); } catch { git('pull', '--rebase', '-q', 'origin', 'data'); git('push', '-q', 'origin', 'data'); }
    }
  } catch (e) { console.error('推回 GitHub 失敗', String(e.stderr || e.message).slice(0, 300)); }
}
