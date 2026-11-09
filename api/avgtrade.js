// GET /api/avgtrade?from=20261026&to=20261101
// 區間內每個交易日、每檔股票的「收盤、成交股數、成交筆數」，上市（證交所）＋上櫃（櫃買中心）。
// 給「台股選股」頁算「每筆平均成交股數」用。一次最多 8 個平日。
import crypto from 'node:crypto';
import { requireUser, getJSON, sleep } from './_lib.js';

function keyOk(req) {
  const want = process.env.ALERT_KEY || '', got = String(req.headers['x-alert-key'] || '');
  return want.length >= 16 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(v) ? v : NaN;
};
const clean = (x) => String(x).replace(/<br>|\s/g, '');

// 依欄位名稱找欄位位置，交易所改欄位順序也不會抓錯
function cols(fields) {
  const f = fields.map(clean);
  const find = (...keys) => f.findIndex((x) => keys.some((k) => x.includes(k)));
  return { code: find('代號'), name: find('名稱'), close: find('收盤'), shares: find('成交股數'), trades: find('成交筆數') };
}

function parse(fields, data, mkt) {
  const c = cols(fields);
  if (Object.values(c).some((i) => i < 0)) throw new Error(`${mkt}欄位格式改了`);
  const out = {};
  for (const r of data || []) {
    const code = String(r[c.code]).trim();
    if (!/^\d{4}$/.test(code)) continue;
    const close = num(r[c.close]), shares = num(r[c.shares]), trades = num(r[c.trades]);
    if (!(close > 0) || !(shares > 0) || !(trades > 0)) continue;
    out[code] = [String(r[c.name] ?? '').trim(), close, shares, trades];
  }
  return Object.keys(out).length ? out : null;
}

async function twse(ymd) {
  const j = await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`);
  if (j.stat !== 'OK') return null;
  const t = (j.tables || []).find((x) => Array.isArray(x.fields) && x.fields.some((f) => clean(f).includes('成交筆數')) && x.fields.some((f) => clean(f).includes('收盤價')));
  if (!t) throw new Error('證交所每日收盤行情格式改了');
  return parse(t.fields, t.data, '證交所');
}

async function tpex(ymd) {
  const j = await getJSON(`https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=${ymd.slice(0, 4)}%2F${ymd.slice(4, 6)}%2F${ymd.slice(6, 8)}&type=EW&response=json`);
  if (j.stat && j.stat !== 'ok' && j.stat !== 'OK') return null;
  const t = (j.tables || [])[0];
  if (!t || !t.data || !t.data.length) return null;
  return parse(t.fields, t.data, '櫃買');
}

function weekdays(from, to) {
  const out = [];
  const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)));
  const end = Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8));
  while (d.getTime() <= end && out.length < 8) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export default async function handler(req, res) {
  if (!keyOk(req) && !requireUser(req, res)) return;
  const from = String(req.query.from || ''), to = String(req.query.to || '');
  if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) return res.status(400).json({ error: '日期格式要是 YYYYMMDD' });
  const days = [], rows = {}, names = {};
  const miss = [];
  for (const ymd of weekdays(from, to)) {
    let a = null, b = null;
    try { a = await twse(ymd); } catch (e) { miss.push(`${ymd} 上市：${e.message}`); }
    await sleep(Number(process.env.WR_SLEEP ?? 300));
    try { b = await tpex(ymd); } catch (e) { miss.push(`${ymd} 上櫃：${e.message}`); }
    await sleep(Number(process.env.WR_SLEEP ?? 300));
    if (!a && !b) continue; // 兩邊都沒資料 = 休市
    // 今天的資料公布得早晚不一：兩邊都要齊（上市約 1,000 檔、上櫃約 880 檔）才算，沒齊就當「還沒有」，下次再抓，不然會拿到半份資料算出錯的選股
    if (ymd === new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '') && (!a || !b || Object.keys(a).length < 700 || Object.keys(b).length < 600)) { miss.push(`${ymd} 今天的資料還沒齊`); continue; }
    const day = {};
    for (const [mkt, src] of [['上市', a], ['上櫃', b]]) {
      for (const [code, [name, close, shares, trades]] of Object.entries(src || {})) {
        day[code] = [close, shares, trades];
        names[code] = [name, mkt];
      }
    }
    days.push(ymd);
    rows[ymd] = day;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({ from, to, days, rows, names, miss });
}
