// 排程警報（推播到 LINE）
// 強以上（強、非常強）：每次掃描（約每 5 分鐘）有新的就推；台北時間 0～9 點不推
// 防重複：同一檔、同方向 12 小時內只推一次；期間內「升級成非常強」或「預告變成已觸發」才再推一則「🔁 更新」
// 防延遲：推播寫出訊號是幾根 K 線前成立、目前價離進場價多遠；價格已經往目標走超過 0.7R（來不及）就不推
// 需要的環境變數：SITE、ALERT_KEY、LINE_TOKEN；手動執行可加 TW=1（強制掃台股）、TEST=1（測試訊息）
import fs from 'node:fs';

const SITE = process.env.SITE || 'https://whale-radar-three.vercel.app';
const KEY = process.env.ALERT_KEY, LINE = process.env.LINE_TOKEN;
const STATE = '.alert-state/state.json';
const COOL = 12 * 3600e3;   // 同一檔同方向的冷卻時間
const MISSED_R = 0.7;       // 已經往目標走超過幾 R 就算來不及
if (!KEY || !LINE) { console.log('還沒設定 ALERT_KEY / LINE_TOKEN，先跳過'); process.exit(0); }

async function get(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(SITE + path, { headers: { 'x-alert-key': KEY } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((ok) => setTimeout(ok, 5000));
    }
  }
}

async function push(text) {
  if (text.length > 4900) text = text.slice(0, 4880) + '\n…（其餘請看網站）';
  const r = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + LINE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ type: 'text', text }] }),
  });
  if (!r.ok) throw new Error('LINE 推播失敗 ' + r.status + ' ' + (await r.text()));
}

// 台北時間
const tpe = new Date(Date.now() + 8 * 3600e3);
const hour = tpe.getUTCHours(), dow = tpe.getUTCDay(), day = tpe.toISOString().slice(0, 10);
const weekday = dow >= 1 && dow <= 5;

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const now = Date.now();
const tOf = (v) => (typeof v === 'number' ? v : v?.t || 0);
for (const k of Object.keys(state)) if (now - tOf(state[k]) > 7 * 864e5) delete state[k];
const save = () => { fs.mkdirSync('.alert-state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };

// 台北時間 0:00～9:00 睡覺不推；這段時間出現、到 9 點還有效（而且還來得及）的，9 點後第一次掃描會推
const quiet = hour < 9;
// 台股：平日 9～13 點盤中每小時、17 點（法人資料出來）、21 點（融資資料出來）掃
const twSlot = 'twscan|' + day + '|' + hour; // 同一個小時只掃一次台股
const doTw = process.env.TW === '1' || (weekday && [9, 10, 11, 12, 13, 17, 21].includes(hour) && !state[twSlot]);
if (doTw) state[twSlot] = now;

const crypto = [], tw = [];
try { crypto.push(...(await get('/api/alert?m=crypto&min=2')).items); }
catch (e) { console.error('加密掃描失敗', e.message); }
if (doTw) {
  try {
    const { codes } = await get('/api/alert?m=tw&step=pick');
    for (let i = 0; i < codes.length; i += 8) {
      try { tw.push(...(await get('/api/alert?m=tw&min=2&codes=' + codes.slice(i, i + 8).join(','))).items); }
      catch (e) { console.error('台股掃描失敗', e.message); }
    }
  } catch (e) { console.error('台股清單失敗', e.message); }
}

const RANK = { 非常強: 3, 強: 2 };
const tag = (x) => (x.mkt === 'crypto' ? '加密' : '台股');
const priceTxt = (x) => (x.price != null ? '（' + x.price + '）' : '');
const pct = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

// 跟進場價比：還沒進場的算距離；已觸發的算已經走了幾 R
function timing(x) {
  const p = x.plan2, P = Number(x.price);
  if (!p || !(P > 0)) return { ok: true, lines: [] };
  const risk = Math.abs(p.entry - p.stop);
  const lines = [];
  const age = p.bars != null ? `${p.tf} ${p.bars} 根前${p.hours != null && p.tf !== '日線' ? `（約 ${p.hours} 小時）` : ''}` : null;
  if (p.wait) {
    const d = (P - p.entry) / P * 100 * x.dir; // 正的＝還沒到進場價（要等回來）
    lines.push(`⏱ ${p.src}：${age ? '訊號 ' + age + '成立，' : ''}掛單價 ${p.entry}，目前離進場價 ${Math.abs(d).toFixed(1)}%`);
    // 價格已經越過停損方向 → 計畫失效；離太遠（> 3 倍風險）不太會回來，先不推
    if ((P - p.stop) * x.dir <= 0) return { ok: false, why: '已破停損' };
    if (d > 0 && (P - p.entry) * x.dir > 3 * risk) return { ok: false, why: '離進場價太遠' };
    return { ok: true, lines };
  }
  const moved = ((P - p.entry) * x.dir) / risk; // 已經往目標走了幾 R
  lines.push(`⏱ ${p.src}：${age ? age + '觸發，' : ''}目前 ${moved >= 0 ? '已走 ' + moved.toFixed(1) + 'R' : '還在進場價下方 ' + (-moved).toFixed(1) + 'R'}（${pct((P - p.entry) / p.entry * 100 * x.dir)}）`);
  if (moved > MISSED_R) return { ok: false, why: `已走 ${moved.toFixed(1)}R，來不及` };
  if (moved < -0.8) return { ok: false, why: '快到停損' };
  return { ok: true, lines };
}

let strong = [...crypto, ...tw].filter((x) => RANK[x.level]);
if (process.env.TEST === '1') strong.unshift({ id: 'test-' + now, key: 'test-' + now, mkt: 'crypto', name: '測試訊息', price: null, cat: 'LINE 警報接上了', level: '強', why: ['目前強以上：' + strong.length + ' 個'], choch: [], plan: [] });

// 同一檔同方向只留一個（最強的）
const best = {};
for (const x of strong) { const k = x.key || x.id; if (!best[k] || RANK[x.level] > RANK[best[k].level]) best[k] = x; }

const out = [], skipped = [];
for (const x of Object.values(best)) {
  const k = 'k2|' + (x.key || x.id);
  const rec = state[k];
  const t = timing(x);
  const stage = x.plan2 ? (x.plan2.wait ? 'wait' : 'on') : '';
  let kind = null;
  if (!rec || now - rec.t > COOL) kind = 'new';
  else if (RANK[x.level] > RANK[rec.lvl] ) kind = 'up';
  else if (rec.stage === 'wait' && stage === 'on') kind = 'trig';
  if (!kind) continue;
  if (!t.ok) { skipped.push(x.name + '：' + t.why); continue; }
  out.push({ x, kind, k, stage, lines: t.lines });
}
out.sort((a, b) => RANK[b.x.level] - RANK[a.x.level]);
console.log(`強以上 ${strong.length} 個（${Object.keys(best).length} 檔），要推 ${out.length} 個` + (skipped.length ? `；不推：${skipped.join('、')}` : '') + (quiet && process.env.TEST !== '1' ? '（睡覺時間，先不推）' : ''));

if (out.length && (!quiet || process.env.TEST === '1')) {
  const head = { new: '', up: '🔁 更新（升級成非常強）', trig: '🔁 更新（預告已觸發，可以進場）' };
  const fmt = ({ x, kind, lines }) => [
    ...(head[kind] ? [head[kind]] : []),
    (x.level === '非常強' ? '🔥' : '⭐') + '【' + tag(x) + '】' + x.name + priceTxt(x) + (x.dir ? (x.dir > 0 ? '　做多' : '　做空') : ''),
    x.cat + '・' + x.level,
    ...lines,
    ...x.why.map((w) => '・' + w),
    ...(x.choch || []).filter((w) => w.startsWith('★')),
    ...(x.plan || []),
  ].join('\n');
  const nVS = out.filter((o) => o.x.level === '非常強').length;
  await push('📡 籌碼雷達｜' + (nVS ? '非常強 ' + nVS + '、' : '') + '強 ' + (out.length - nVS) + '\n\n' + out.map(fmt).join('\n\n') + '\n\n' + SITE);
  for (const o of out) state[o.k] = { t: o.kind === 'new' ? now : (state[o.k]?.t || now), lvl: o.x.level, stage: o.stage };
  // 舊格式的 id 也記一下，避免回滾時重推
  for (const o of out) state[o.x.id] = now;
}

save();
