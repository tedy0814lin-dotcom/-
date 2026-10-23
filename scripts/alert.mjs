// 排程警報：問網站有沒有「非常強」的機會，有新的就推播到 LINE
// 需要的環境變數：SITE、ALERT_KEY、LINE_TOKEN
import fs from 'node:fs';

const SITE = process.env.SITE || 'https://whale-radar-three.vercel.app';
const KEY = process.env.ALERT_KEY, LINE = process.env.LINE_TOKEN;
const STATE = '.alert-state/state.json';
if (!KEY || !LINE) { console.error('缺少 ALERT_KEY 或 LINE_TOKEN'); process.exit(1); }

async function get(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(SITE + path, { headers: { 'x-alert-key': KEY } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((ok) => setTimeout(ok, 5000));
    }
  }
}

// 台股：平日台北時間 17 點（法人資料出來）和 21 點（融資資料出來）各掃一輪；加 TW=1 可強制掃
const tpe = new Date(Date.now() + 8 * 3600e3);
const doTw = process.env.TW === '1' || ([17, 21].includes(tpe.getUTCHours()) && tpe.getUTCDay() >= 1 && tpe.getUTCDay() <= 5);

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const now = Date.now();
for (const k of Object.keys(state)) if (now - state[k] > 7 * 864e5) delete state[k];

const items = [];
try { items.push(...(await get('/api/alert?m=crypto')).items); } catch (e) { console.error('加密掃描失敗', e.message); }
if (doTw) {
  try {
    const { codes } = await get('/api/alert?m=tw&step=pick');
    for (let i = 0; i < codes.length; i += 8) {
      try { items.push(...(await get(`/api/alert?m=tw&codes=${codes.slice(i, i + 8).join(',')}`)).items); }
      catch (e) { console.error('台股掃描失敗', e.message); }
    }
  } catch (e) { console.error('台股清單失敗', e.message); }
}

// 手動執行時可勾「測試」：先送一則測試訊息，確認 LINE 有接上
if (process.env.TEST === '1') items.unshift({ id: 'test-' + Date.now(), mkt: 'crypto', name: '測試訊息', price: null, cat: 'LINE 警報接上了', level: '測試', why: [`目前真正的非常強：${items.length} 個`], choch: [] });
const fresh = items.filter((x) => !state[x.id]);
console.log(`找到 ${items.length} 個非常強，新的 ${fresh.length} 個`);
if (fresh.length) {
  const fmt = (x) => [
    `【${x.mkt === 'crypto' ? '加密' : '台股'}】${x.name}${x.price != null ? `（${x.price}）` : ''}`,
    `${x.cat}・${x.level}`,
    ...x.why.map((w) => `・${w}`),
    ...(x.choch[3] ? [x.choch[3]] : []),
  ].join('\n');
  let text = `籌碼雷達｜非常強 ${fresh.length} 個\n\n` + fresh.map(fmt).join('\n\n') + `\n\n${SITE}`;
  if (text.length > 4900) text = text.slice(0, 4880) + '\n…（其餘請看網站）';
  const r = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LINE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ type: 'text', text }] }),
  });
  if (!r.ok) { console.error('LINE 推播失敗', r.status, await r.text()); process.exit(1); }
  for (const x of fresh) state[x.id] = now;
}
fs.mkdirSync('.alert-state', { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(state));
