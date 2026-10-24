// 排程警報（推播到 LINE）
// 強以上（強、非常強）：每次掃描（每 15 分鐘）有新的就推；台北時間 0～9 點不推
// 需要的環境變數：SITE、ALERT_KEY、LINE_TOKEN；手動執行可加 TW=1（強制掃台股）、TEST=1（測試訊息）
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

// 台北時間 0:00～9:00 睡覺不推；這段時間出現、到 9 點還有效的，9 點後第一次掃描會一起推
const quiet = hour < 9;
// 台股：平日 9～13 點盤中每小時、17 點（法人資料出來）、21 點（融資資料出來）掃
const doTw = process.env.TW === '1' || (weekday && ([9, 10, 11, 12, 13, 17, 21].includes(hour) && tpe.getUTCMinutes() < 15));

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

const tag = (x) => (x.mkt === 'crypto' ? '加密' : '台股');
const price = (x) => (x.price != null ? '（' + x.price + '）' : '');

// 強以上：有新的就推（同一個訊號只推一次）
const strong = [...crypto, ...tw].filter((x) => x.level === '非常強' || x.level === '強');
if (process.env.TEST === '1') strong.unshift({ id: 'test-' + now, mkt: 'crypto', name: '測試訊息', price: null, cat: 'LINE 警報接上了', level: '測試', why: ['目前強以上：' + strong.length + ' 個'], choch: [] });
const fresh = strong.filter((x) => !state[x.id]).sort((a, b) => (a.level === '非常強' ? -1 : 0) - (b.level === '非常強' ? -1 : 0));
console.log('強以上 ' + strong.length + ' 個，新的 ' + fresh.length + ' 個' + (quiet && process.env.TEST !== '1' ? '（睡覺時間，先不推）' : ''));
if (fresh.length && (!quiet || process.env.TEST === '1')) {
  const fmt = (x) => [
    (x.level === '非常強' ? '🔥' : '⭐') + '【' + tag(x) + '】' + x.name + price(x),
    x.cat + '・' + x.level,
    ...x.why.map((w) => '・' + w),
    ...x.choch.filter((w) => w.startsWith('★')),
    ...(x.plan || []),
  ].join('\n');
  const nVS = fresh.filter((x) => x.level === '非常強').length;
  await push('📡 籌碼雷達｜' + (nVS ? '非常強 ' + nVS + '、' : '') + '強 ' + (fresh.length - nVS) + '\n\n' + fresh.map(fmt).join('\n\n') + '\n\n' + SITE);
  for (const x of fresh) state[x.id] = now;
}

save();
