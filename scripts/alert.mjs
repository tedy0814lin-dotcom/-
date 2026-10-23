// 排程警報（推播到 LINE）
// 1) 非常強：每次掃描（每 15 分鐘）有新的就馬上推
// 2) 強／中：整理成摘要，加密每天 9、15、21 點各一則；台股平日 21 點一則（台北時間）
// 需要的環境變數：SITE、ALERT_KEY、LINE_TOKEN；手動執行可加 TW=1（強制掃台股）、TEST=1（測試訊息）、DIGEST=1（強制送摘要）
import fs from 'node:fs';

const SITE = process.env.SITE || 'https://whale-radar-three.vercel.app';
const KEY = process.env.ALERT_KEY, LINE = process.env.LINE_TOKEN;
const STATE = '.alert-state/state.json';
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
for (const k of Object.keys(state)) if (now - state[k] > 7 * 864e5) delete state[k];
const save = () => { fs.mkdirSync('.alert-state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };

// 這次要不要送摘要（每個時段只送一次）
const cryptoSlot = 'digest|crypto|' + day + '|' + hour;
const twSlot = 'digest|tw|' + day;
const force = process.env.DIGEST === '1';
const cryptoDigest = force || ([9, 15, 21].includes(hour) && !state[cryptoSlot]);
const twDigest = force || (weekday && hour === 21 && !state[twSlot]);
// 台股：平日 17 點（法人資料出來）、21 點（融資資料出來）掃
const doTw = process.env.TW === '1' || force || (weekday && [17, 21].includes(hour));

const crypto = [], tw = [];
let twOk = false;
try { crypto.push(...(await get('/api/alert?m=crypto' + (cryptoDigest ? '&min=1' : ''))).items); }
catch (e) { console.error('加密掃描失敗', e.message); }
if (doTw) {
  try {
    const { codes } = await get('/api/alert?m=tw&step=pick');
    twOk = true;
    for (let i = 0; i < codes.length; i += 8) {
      try { tw.push(...(await get('/api/alert?m=tw' + (twDigest ? '&min=1' : '') + '&codes=' + codes.slice(i, i + 8).join(','))).items); }
      catch (e) { console.error('台股掃描失敗', e.message); }
    }
  } catch (e) { console.error('台股清單失敗', e.message); }
}

const tag = (x) => (x.mkt === 'crypto' ? '加密' : '台股');
const price = (x) => (x.price != null ? '（' + x.price + '）' : '');

// ---- 1) 非常強：即時推 ----
const strong = [...crypto, ...tw].filter((x) => x.level === '非常強');
if (process.env.TEST === '1') strong.unshift({ id: 'test-' + now, mkt: 'crypto', name: '測試訊息', price: null, cat: 'LINE 警報接上了', level: '測試', why: ['目前真正的非常強：' + strong.length + ' 個'], choch: [] });
const fresh = strong.filter((x) => !state[x.id]);
console.log('非常強 ' + strong.length + ' 個，新的 ' + fresh.length + ' 個');
if (fresh.length) {
  const fmt = (x) => [
    '【' + tag(x) + '】' + x.name + price(x),
    x.cat + '・' + x.level,
    ...x.why.map((w) => '・' + w),
    ...(x.choch[3] ? [x.choch[3]] : []),
  ].join('\n');
  await push('🔥 籌碼雷達｜非常強 ' + fresh.length + ' 個\n\n' + fresh.map(fmt).join('\n\n') + '\n\n' + SITE);
  for (const x of fresh) state[x.id] = now;
  save();
}

// ---- 2) 強／中：摘要 ----
function digest(title, list) {
  const order = { 非常強: 0, 強: 1, 中: 2 };
  list = list.filter((x) => x.level !== '非常強').sort((a, b) => order[a.level] - order[b.level]);
  const line = (x) => (x.level === '強' ? '★ ' : '・') + x.name + price(x) + '｜' + x.cat + '・' + x.level + '\n   ' + x.why.slice(0, 2).join('、');
  const n強 = list.filter((x) => x.level === '強').length;
  return '📋 ' + title + '｜強 ' + n強 + '、中 ' + (list.length - n強) + '\n\n' + (list.length ? list.map(line).join('\n') : '目前沒有中以上的機會');
}
const parts = [];
if (cryptoDigest) parts.push(digest('加密摘要 ' + hour + ':00', crypto));
if (twDigest && twOk) parts.push(digest('台股摘要（' + day + '）', tw));
if (parts.length) {
  await push(parts.join('\n\n——————\n\n') + '\n\n' + SITE);
  if (cryptoDigest) state[cryptoSlot] = now;
  if (twDigest && twOk) state[twSlot] = now;
  console.log('已送摘要');
}

save();
