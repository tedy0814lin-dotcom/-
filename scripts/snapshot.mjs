// 快照：把網站每一頁要顯示的資料，在 GitHub 主機上算好、存成 JSON，推到 repo 的 snap 分支。
// 新網站（Netlify）不做任何運算，只經過一支小函式（驗證登入後）把這些 JSON 讀給瀏覽器。
//
//   node scripts/snapshot.mjs              加密貨幣這一組（約 3～5 分鐘）
//   TW=1 node scripts/snapshot.mjs         加上台股這一組（較慢；平日盤中／盤後才跑，見 .github/workflows/alert.yml）
//   ONLY=crypto,fp node scripts/snapshot.mjs   只跑指定的幾個（除錯用）
//   OUT=snapout                            輸出資料夾（預設 snapout）；沒設 GITHUB_TOKEN 就只寫檔、不推
//
// 輸出檔案名稱 ↔ 前端原本的 /api 請求，對照見 static.js。
// 每個項目獨立執行：某一項失敗只留下舊檔、不影響其他項目；失敗訊息寫進 _status.json。
process.env.SNAPSHOT = '1';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { get } from './_api.mjs';
import { normBase } from '../lib/exchanges.js';
import { twPick } from '../lib/twCore.js';

const OUT = process.env.OUT || 'snapout';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
const canPush = !!(repo && tok) && process.env.NOPUSH !== '1';
const url = canPush ? `https://x-access-token:${tok}@github.com/${repo}.git` : null;
// 先把 snap 分支現有的檔案拿下來：這輪沒更新到的項目（例如沒跑台股）保留原樣，失敗的項目也留著舊檔
if (canPush && !fs.existsSync(OUT)) { try { execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'snap', url, OUT], { stdio: 'ignore' }); } catch { console.log('還沒有 snap 分支，第一次建立'); } }
fs.mkdirSync(OUT, { recursive: true });

const status = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, '_status.json'), 'utf8')); } catch { return {}; } })();
// 台股這組比較慢，只在需要時跑：手動指定 TW=1、平日盤中／盤後的整點時段（每小時一次）、或快照超過 6 小時沒更新（含第一次）
const tpe = new Date(Date.now() + 8 * 3600e3), hr = tpe.getUTCHours(), dow = tpe.getUTCDay();
const twAge = Date.now() - (status.twstock?.at || 0);
const WITH_TW = process.env.TW === '1' || (ONLY && [...ONLY].some((k) => /^(tw|pat_tw|vegas_.*tw|ema_.*tw|avg)/.test(k)))
  || (!ONLY && ((dow >= 1 && dow <= 5 && [9, 10, 11, 12, 13, 14, 15, 16, 17, 21].includes(hr) && twAge > 50 * 60e3) || twAge > 6 * 3600e3));
const write = (key, data) => fs.writeFileSync(path.join(OUT, key + '.json'), JSON.stringify(data));
const read = (key) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, key + '.json'), 'utf8')); } catch { return null; } };
const pool = async (items, n, fn) => { let i = 0; const out = []; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };

// 一個項目：成功就寫檔、記時間；失敗留舊檔
async function job(key, fn) {
  if (ONLY && !ONLY.has(key)) return;
  const t0 = Date.now();
  try {
    const data = await fn();
    write(key, data);
    status[key] = { ok: true, at: Date.now(), sec: Math.round((Date.now() - t0) / 1000) };
    console.log(`✓ ${key} ${status[key].sec}s ${(JSON.stringify(data).length / 1024).toFixed(0)}KB`);
  } catch (e) {
    status[key] = { ok: false, at: Date.now(), err: String(e.message || e).slice(0, 200), last: status[key]?.last ?? status[key]?.at };
    if (status[key].ok === false && read(key)) status[key].keep = true;
    console.error(`✗ ${key}: ${e.message}`);
  }
}

// ───────── 加密貨幣這一組 ─────────
let cryptoRows = null;
await job('crypto', async () => { const d = await get('/api/crypto?n=120'); cryptoRows = d.rows; return d; });
cryptoRows ||= read('crypto')?.rows;

await job('xchg', async () => {
  const bases = [...new Set((cryptoRows || []).map((r) => normBase(r.base)))];
  if (!bases.length) throw new Error('沒有加密列表');
  const parts = []; for (let i = 0; i < bases.length; i += 60) parts.push(bases.slice(i, i + 60));
  const res = []; for (const b of parts) res.push(await get('/api/xchg?bases=' + b.join(',') + '&refresh=1'));
  const x = { updatedAt: Date.now(), status: {}, byBase: {}, hist: {} };
  for (const p of res) {
    Object.assign(x.byBase, p.byBase); Object.assign(x.hist, p.hist);
    for (const [ex, st] of Object.entries(p.status || {})) {
      const a = +(String(x.status[ex] || '').match(/^ok:(\d+)/)?.[1] || 0), b = +(String(st).match(/^ok:(\d+)/)?.[1] || 0);
      x.status[ex] = a + b ? 'ok:' + (a + b) : st;
    }
  }
  return x;
});
await job('cs', () => get('/api/twhist?cs=1&force=1'));
await job('fp', () => get('/api/twhist?fp=1&force=1'));
await job('log', () => get('/api/log'));
await job('logstrat', () => get('/api/log?strat=1&force=1'));

// 型態頁（加密）：成交額前 120，4H／12H／日線
let patList = null;
await job('pat_crypto_list', async () => (patList = await get('/api/twhist?pat=1&market=crypto&list=1&top=120')));
patList ||= read('pat_crypto_list');
for (const tf of ['4h', '12h', '1d']) {
  await job('pat_crypto_' + tf, async () => {
    const syms = patList?.symbols || []; if (!syms.length) throw new Error('沒有清單');
    const results = {}; let miss = [];
    const parts = []; for (let i = 0; i < syms.length; i += 12) parts.push(syms.slice(i, i + 12));
    await pool(parts, 2, async (p) => { const j = await get(`/api/twhist?pat=1&market=crypto&tf=${tf}&symbols=${p.join(',')}`); Object.assign(results, j.results); miss.push(...(j.miss || [])); });
    return { results, miss, tf, at: Date.now() };
  });
}

// 維加斯（加密）：清單＋逐檔 15 分／1 小時／4 小時狀態
let vgc = null;
await job('vegas_list_crypto', async () => (vgc = await get('/api/vegas?list=crypto')));
vgc ||= read('vegas_list_crypto');
await job('vegas_scan_crypto', async () => {
  const out = {}; const L = (vgc || []).map((x) => x.s);
  const parts = []; for (let i = 0; i < L.length; i += 8) parts.push(L.slice(i, i + 8));
  await pool(parts, 2, async (p) => Object.assign(out, await get(`/api/vegas?m=crypto&s=${p.join(',')}`)));
  return out;
});
// 看圖：每檔三個週期，一檔一個檔案 vc_crypto_<代號>.json（點開某一檔才讀，不然一整包 4MB 太大）
async function charts(m, list, tfs) {
  const idx = {}; let ok = 0;
  await pool(list, 3, async (s) => {
    const o = {};
    for (const tf of tfs) { try { o[tf] = await get(`/api/vegas?chart=1&m=${m}&s=${s}&tf=${tf}`); } catch {} }
    if (Object.keys(o).length) { write(`vc_${m}_${s.replace(/\./g, '_')}`, o); ok++; }
  });
  if (!ok) throw new Error('一檔圖都沒抓到');
  return { n: ok, at: Date.now() };
}
await job('vegas_chart_crypto', () => charts('crypto', (vgc || []).map((x) => x.s), ['15m', '1h', '4h']));

// 均線突破（觀察用，不計分）：每檔 1H＋日線，多空狀態。圖拆成一檔一個檔案 ema_c_<市場>_<代號>.json，總表只留狀態
async function emaScan(m, L, per) {
  const out = {}, names = Object.fromEntries(L.map((x) => [x.s, x.name])); let ok = 0;
  const parts = []; for (let i = 0; i < L.length; i += per) parts.push(L.slice(i, i + per).map((x) => x.s));
  await pool(parts, 2, async (p) => {
    const j = await get(`/api/ema?m=${m}&s=${p.join(',')}`);
    for (const [s, v] of Object.entries(j)) {
      if (v.error) { out[s] = { error: v.error }; continue; }
      const slim = {}, full = {};
      for (const [k, r] of Object.entries(v)) { if (!r) continue; const { chart, ...rest } = r; slim[k] = rest; if (chart) full[k] = chart; }
      out[s] = slim; ok++;
      if (Object.keys(full).length) write(`ema_c_${m}_${s.replace(/[^A-Za-z0-9]/g, '_')}`, full);
    }
  });
  if (!ok) throw new Error('一檔都沒算出來');
  return { d: out, names, at: Date.now() };
}
await job('ema_scan_crypto', () => emaScan('crypto', vgc || [], 4));

// ───────── 台股這一組 ─────────
if (WITH_TW) {
  let tw = null;
  await job('twstock', async () => (tw = await get('/api/twstock?refresh=1')));
  tw ||= read('twstock');
  await job('twhist', async () => {
    const codes = twPick(tw?.rows || []); if (!codes.length) throw new Error('沒有台股清單');
    const out = {}; const parts = []; for (let i = 0; i < codes.length; i += 8) parts.push(codes.slice(i, i + 8));
    await pool(parts, 3, async (p) => { try { Object.assign(out, await get('/api/twhist?codes=' + p.join(','))); } catch (e) { for (const c of p) out[c] = { error: e.message }; } });
    return out;
  });
  await job('pat_tw', async () => {
    const rows = (tw?.rows || []).filter((r) => r.volume >= 1000 && r.close >= 10 && r.close <= 300 && /^\d{4}$/.test(r.code)).sort((a, b) => b.volume - a.volume).slice(0, 300);
    const codes = rows.map((r) => r.code), results = {}, miss = []; let day = '';
    const parts = []; for (let i = 0; i < codes.length; i += 15) parts.push(codes.slice(i, i + 15));
    await pool(parts, 2, async (p) => { const j = await get('/api/twhist?pat=1&codes=' + p.join(',')); Object.assign(results, j.results); miss.push(...(j.miss || [])); day = j.day || day; });
    return { results, miss, day, names: Object.fromEntries(rows.map((r) => [r.code, r.name])), at: Date.now() };
  });
  let vgt = null;
  await job('vegas_list_tw', async () => (vgt = await get('/api/vegas?list=tw')));
  vgt ||= read('vegas_list_tw');
  await job('vegas_list_twall', () => get('/api/vegas?list=twall'));
  await job('vegas_scan_tw', async () => {
    const out = {}; const L = (vgt || []).map((x) => x.s);
    const parts = []; for (let i = 0; i < L.length; i += 6) parts.push(L.slice(i, i + 6));
    await pool(parts, 2, async (p) => Object.assign(out, await get(`/api/vegas?m=tw&s=${p.join(',')}`)));
    return out;
  });
  await job('vegas_chart_tw', () => charts('tw', (vgt || []).map((x) => x.s), ['15m', '1h', '1d']));
  await job('ema_scan_tw', () => emaScan('tw', vgt || [], 6));
  // 台股選股（大單推升）：近 7 週每週的成交資料。pickTab 的週區間規則：週一～週日，往前 6 週
  await job('avgtrade', async () => {
    const tpe = new Date(Date.now() + 8 * 3600e3), mon = new Date(Date.UTC(tpe.getUTCFullYear(), tpe.getUTCMonth(), tpe.getUTCDate()));
    mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
    const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const out = {}, oldAll = read('avgtrade') || {}, t0 = Date.now(), BUDGET = 8 * 60e3; // 櫃買慢的時候最多花 8 分鐘，沒抓完的下一輪接著抓（已抓到的天不會丟）
    const today = ymd(tpe);
    // 這一天上市、上櫃是否都齊（上市約 1,000 檔、上櫃約 880 檔）
    const full = (c, d) => { const r = c?.rows?.[d]; if (!r) return false; let s = 0, o = 0; for (const code in r) { const m = c.names?.[code]?.[1]; if (m === '上市') s++; else if (m === '上櫃') o++; } return s >= 700 && o >= 600; };
    const cnt = (c, d) => Object.keys(c?.rows?.[d] || {}).length;
    for (let k = 6; k >= 0; k--) {
      const a = new Date(mon.getTime() - k * 7 * 864e5), b = new Date(a.getTime() + 6 * 864e5);
      const old = oldAll[ymd(a)];
      if (old && ymd(b) < today && !(old.miss || []).length) { out[ymd(a)] = old; continue; } // 已結束且沒缺資料的週不會變，沿用
      // 逐天處理：上市、上櫃都齊的天直接沿用，只重抓缺的天；重抓結果比舊的少就保留舊的（不讓快照退步）
      const cur = { from: ymd(a), to: ymd(b), days: [], rows: {}, names: { ...(old?.names || {}) }, miss: [] };
      for (let i = 0; i < 5; i++) {
        const d = ymd(new Date(a.getTime() + i * 864e5)); if (d > today) break;
        if (full(old, d)) { cur.days.push(d); cur.rows[d] = old.rows[d]; continue; }
        if (Date.now() - t0 > BUDGET) { if (old?.rows?.[d]) { cur.days.push(d); cur.rows[d] = old.rows[d]; } cur.miss.push(`${d} 這輪時間用完，下一輪再抓`); continue; }
        let c = null; try { c = await get(`/api/avgtrade?from=${d}&to=${d}`); } catch (e) { cur.miss.push(`${d}：${e.message}`); }
        const useNew = c?.days?.includes(d) && cnt(c, d) >= cnt(old, d);
        if (useNew) { cur.days.push(d); cur.rows[d] = c.rows[d]; Object.assign(cur.names, c.names); } else if (old?.rows?.[d]) { cur.days.push(d); cur.rows[d] = old.rows[d]; }
        if (c?.miss?.length) cur.miss.push(...c.miss);
      }
      // 缺資料（有 miss）但這天其實已經齊了就不要留警告
      cur.miss = cur.miss.filter((m) => { const d = String(m).slice(0, 8); return !full(cur, d); });
      out[ymd(a)] = cur;
    }
    return out;
  });
}

fs.writeFileSync(path.join(OUT, '_status.json'), JSON.stringify(status));
fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify({ at: Date.now(), source: 'github-actions' }));

// ───────── 推到 snap 分支（只留一個 commit，不累積歷史，不然每 20 分鐘幾 MB 的更新會把 repo 撐爆）─────────
if (!canPush) { console.log('不推送（本機測試或沒有 token），輸出在', OUT); process.exit(0); }
const git = (...a) => execFileSync('git', a, { cwd: OUT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
if (!fs.existsSync(path.join(OUT, '.git'))) git('init', '-q', '-b', 'snap');
try { git('remote', 'add', 'origin', url); } catch { git('remote', 'set-url', 'origin', url); }
git('config', 'user.name', 'whale-radar-snap'); git('config', 'user.email', 'snap@users.noreply.github.com');
// 同一個 run 會連續跑好幾輪，分支名每次都要不一樣（固定叫 new 的話第二輪起 checkout 會失敗、快照就不更新了）
const tmpBranch = 'snap-' + Date.now();
git('checkout', '-q', '--orphan', tmpBranch); git('add', '-A'); git('commit', '-q', '-m', 'snapshot ' + new Date().toISOString());
git('push', '-q', '-f', 'origin', tmpBranch + ':refs/heads/snap');
try { git('checkout', '-q', '--detach'); git('branch', '-q', '-D', tmpBranch); } catch {}
console.log('已推到 snap 分支');
