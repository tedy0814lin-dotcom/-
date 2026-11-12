// 策略實盤記錄：把「大陽線突破／Delta 階梯／大單推升」每次新成立的訊號存起來（只存訊號，結果由網站用實際 K 線依回測規則重播）。
// 存在 data 分支：strat.json（訊號）、twavg.json（台股上櫃近 25 個交易日的收盤／成交股數／成交筆數，用來算大單推升）。
// 需要的環境變數同 log.mjs。必須在 log.mjs 之後執行（共用 datalog 這個 data 分支工作目錄）。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = process.env.SITE || 'https://whale-radar-three.vercel.app';
const KEY = process.env.ALERT_KEY;
const DIR = 'datalog';
if (!KEY) { console.log('沒有 ALERT_KEY，略過策略記錄'); process.exit(0); }
const git = (...a) => execFileSync('git', a, { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
if (fs.existsSync(DIR + '/.git')) { try { git('pull', '--rebase', '-q'); } catch {} } else fs.mkdirSync(DIR, { recursive: true });

import { get } from './_api.mjs'; // 直接在這台主機算（不再呼叫網站）
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')); } catch { return d; } };
const now = Date.now();
const db = rd('strat.json', { items: [] });
const have = new Set(db.items.map((x) => x.id));
let added = 0;
const add = (x) => { const id = [x.k, x.s, x.sigT ?? x.sigD].join('|'); if (have.has(id)) return; have.add(id); db.items.push({ id, ...x, seen: now }); added++; };

// 1) 加密：大陽線突破＋Delta 階梯
try { const { items } = await get('/api/alert?m=slog'); for (const x of items) add(x); console.log(`策略記錄：加密掃到 ${items.length}`); }
catch (e) { console.error('策略記錄取加密訊號失敗', e.message); }

// 2) 台股大單推升（上櫃）：補齊缺的交易日 → 用最新一天算
const REL_MIN = 1.5, CHG_MIN = 0.04, LIQ_MIN = 500, TOP_N = 3, KEEP = 26;
try {
  const tp = new Date(now + 8 * 3600e3), ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const av = rd('twavg.json', { days: [], rows: {}, names: {}, tried: [] });
  const todayOk = tp.getUTCHours() >= 14; // 收盤後資料公布時間不一定：api/avgtrade 會自己檢查今天的資料齊不齊（沒齊就不算、下次再抓）
  const want = [];
  for (let i = 0; i < 45; i++) { // 近 45 個日曆天的平日
    const d = new Date(tp.getTime() - i * 864e5), w = d.getUTCDay(), y = ymd(d);
    if (w === 0 || w === 6) continue;
    if (i === 0 && !todayOk) continue;
    if (!av.days.includes(y) && !av.tried.includes(y)) want.push(y);
  }
  want.sort();
  let fetched = 0;
  for (let k = 0; k < want.length && fetched < 3; ) { // 每次執行最多補 3 段（每段最多 8 個平日），證交所會擋太快的請求
    const from = want[k], to = want[Math.min(want.length - 1, k + 7)];
    const c = await get(`/api/avgtrade?from=${from}&to=${to}`);
    for (const y of c.days) { av.days.push(y); av.rows[y] = {}; for (const [code, v] of Object.entries(c.rows[y])) if ((c.names[code] || [])[1] === '上櫃') av.rows[y][code] = v; }
    for (const [code, nm] of Object.entries(c.names)) if (nm[1] === '上櫃') av.names[code] = nm;
    // 這段沒抓失敗的日子（休市日也算「試過」）不再重抓；有 miss 的日子下次再試
    const missed = new Set((c.miss || []).map((m) => String(m).slice(0, 8)));
    for (const y of want.slice(k, k + 8)) if (!missed.has(y)) av.tried.push(y);
    k += 8; fetched++;
  }
  av.days = [...new Set(av.days)].sort(); av.tried = [...new Set(av.tried)].sort().slice(-80);
  if (av.days.length > KEEP) { for (const y of av.days.slice(0, av.days.length - KEEP)) delete av.rows[y]; av.days = av.days.slice(-KEEP); }
  fs.writeFileSync(DIR + '/twavg.json', JSON.stringify(av));
  const D = av.days, n = D.length;
  if (n >= 21) {
    const last = D[n - 1], out = [];
    // 最新一天要是 21 天連續交易日（中間不能缺抓的日子）：缺的日子會讓 seq 有空值而被排除，不會算錯
    for (const code of Object.keys(av.rows[last] || {})) {
      const seq = []; for (let k = n - 21; k < n; k++) seq.push(av.rows[D[k]][code] || null);
      if (seq.some((x) => !x)) continue;
      const close = seq.map((x) => x[0]), avg = seq.map((x) => x[1] / x[2]);
      const c0 = close[20], chg = c0 / close[19] - 1, base = avg.slice(0, 20).reduce((a, b) => a + b, 0) / 20, rel = avg[20] / base;
      const ma20 = close.slice(1).reduce((a, b) => a + b, 0) / 20, vol5 = seq.slice(16).reduce((a, x) => a + x[1], 0) / 5 / 1000;
      if (rel >= REL_MIN && chg > CHG_MIN && c0 > ma20 && vol5 >= LIQ_MIN) out.push({ code, close: c0, rel, chg });
    }
    out.sort((a, b) => b.rel - a.rel);
    // 排除帶 MACD 頂背離的訊號（lib/pickDiv.js；patall 每天收盤後算好放 snap2）。標記日期對不上最新交易日就不排除並記一筆警告，這筆訊號加 nodiv:1 讓日後看得出來
    let pd = null;
    try {
      const rb = process.env.SNAP2_BASE || 'https://raw.githubusercontent.com/tedy0814lin-dotcom/-/snap2';
      const j = await (await fetch(rb + '/pp_pkdiv.json', { headers: { 'Cache-Control': 'no-cache' } })).json();
      if (j && j.flags && String(j.asof).replace(/-/g, '') === last) pd = j.flags;
    } catch {}
    // 頂背離標記要等 patall 收盤後（台北 13:30、14:00 各算一次）算好；還沒好就先不記（記了就不能補排除，id 已存在），之後每 30 分鐘的記錄輪次再試；到台北 22:00 還沒有才放棄排除、照記並標 nodiv
    if (!pd && tp.getUTCHours() < 22) { console.log(`策略記錄：${last} 的頂背離標記還沒算好，這輪不記大單推升（符合 ${out.length} 檔，下一輪再試）`); throw new Error('wait-pkdiv'); }
    const kept = pd ? out.filter((r) => pd[r.code] !== 1) : out;
    if (pd) console.log(`策略記錄：頂背離排除 ${out.length - kept.length} 檔`); else console.log('策略記錄：頂背離標記不是最新一天，這次沒排除（訊號標 nodiv）');
    for (const r of kept.slice(0, TOP_N)) add({ k: 'pk', s: r.code + '.TWO', sigD: last, close: r.close, rel: +r.rel.toFixed(2), chg: +r.chg.toFixed(4), ...(pd ? {} : { nodiv: 1 }) });
    console.log(`策略記錄：台股 ${last} 符合 ${out.length} 檔，排除後 ${kept.length}，取前 ${Math.min(TOP_N, kept.length)}（已有 ${n} 個交易日資料）`);
  } else console.log(`策略記錄：台股資料 ${n}/21 天，還在累積`);
} catch (e) { if (e.message === 'wait-pkdiv') console.log('策略記錄：等待頂背離標記'); else console.error('策略記錄台股失敗', e.message); }

db.updated = now;
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(DIR + '/strat.json', JSON.stringify(db));
console.log(`策略記錄：共 ${db.items.length} 筆，新增 ${added}`);
if (fs.existsSync(DIR + '/.git')) {
  try {
    git('add', 'strat.json', 'twavg.json');
    if (git('status', '--porcelain').trim()) {
      git('commit', '-q', '-m', '策略記錄 ' + new Date(now).toISOString().slice(0, 16));
      try { git('push', '-q', 'origin', 'data'); } catch { git('pull', '--rebase', '-q', 'origin', 'data'); git('push', '-q', 'origin', 'data'); }
    }
  } catch (e) { console.error('推回 GitHub 失敗', String(e.stderr || e.message).slice(0, 300)); }
}
