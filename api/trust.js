// GET /api/trust?from=20261001&to=20261015
// 區間內每個交易日的「投信買賣超（張）」，上市（證交所）＋上櫃（櫃買中心）。
// 一次最多 12 個交易日，避免執行太久或被交易所擋。前端會分段呼叫並把舊資料存起來。
import { requireUser, getJSON, sleep } from './_lib.js';

const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const lots = (shares) => Math.round(num(shares) / 1000);

// 上市：證交所三大法人買賣超日報，取「投信買賣超股數」
async function twse(ymd) {
  const j = await getJSON(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd}&selectType=ALLBUT0999&response=json`);
  if (j.stat !== 'OK' || !Array.isArray(j.data) || !j.data.length) return null;
  const f = j.fields.map((x) => String(x).trim());
  const iCode = f.findIndex((x) => x.includes('證券代號'));
  const iName = f.findIndex((x) => x.includes('證券名稱'));
  const iTrust = f.findIndex((x) => x === '投信買賣超股數');
  if (iCode < 0 || iTrust < 0) throw new Error('證交所投信欄位格式改了');
  const out = {};
  for (const r of j.data) out[String(r[iCode]).trim()] = [String(r[iName] ?? '').trim(), lots(r[iTrust])];
  return out;
}

// 上櫃：櫃買中心三大法人買賣明細。新版網址優先，失敗再用舊版。
async function tpex(ymd) {
  const y = ymd.slice(0, 4), m = ymd.slice(4, 6), d = ymd.slice(6, 8);
  const parse = (fields, rows, fallbackIdx) => {
    let iT = fallbackIdx;
    if (fields) {
      const f = fields.map((x) => String(x).replace(/\s/g, ''));
      const k = f.findIndex((x) => x.includes('投信') && x.includes('買賣超'));
      if (k >= 0) iT = k;
    }
    const out = {};
    for (const r of rows || []) {
      const code = String(r[0]).trim();
      if (!/^\d{4}$/.test(code)) continue;
      out[code] = [String(r[1] ?? '').trim(), lots(r[iT])];
    }
    return Object.keys(out).length ? out : null;
  };
  try {
    const j = await getJSON(`https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=${y}/${m}/${d}&response=json`);
    const t = (j.tables || [])[0];
    const res = t && parse(t.fields, t.data, 13);
    if (res) return res;
  } catch {}
  try {
    const roc = `${Number(y) - 1911}/${m}/${d}`;
    const j = await getJSON(`https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${roc}`);
    return parse(null, j.aaData, 13);
  } catch {
    return null;
  }
}

function weekdays(from, to) {
  const out = [];
  const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)));
  const end = Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8));
  while (d.getTime() <= end && out.length < 20) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  const from = String(req.query.from || ''), to = String(req.query.to || '');
  if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) return res.status(400).json({ error: '日期格式要是 YYYYMMDD' });
  const days = [], names = {}, net = {};
  let tpexOk = 0;
  for (const ymd of weekdays(from, to).slice(0, 12)) {
    let a = null, b = null;
    try { a = await twse(ymd); } catch (e) { if (String(e.message).includes('格式')) return res.status(502).json({ error: e.message }); }
    await sleep(Number(process.env.WR_SLEEP ?? 300));
    if (!a) continue; // 證交所沒資料 = 休市
    b = await tpex(ymd);
    if (b) tpexOk++;
    await sleep(Number(process.env.WR_SLEEP ?? 300));
    const idx = days.length;
    days.push(ymd);
    for (const [mkt, src] of [['上市', a], ['上櫃', b || {}]]) {
      for (const [code, [name, v]] of Object.entries(src)) {
        if (!/^\d{4}$/.test(code)) continue;
        if (!net[code]) { net[code] = []; names[code] = [name, mkt]; }
        net[code][idx] = v;
      }
    }
  }
  // 補 0，讓每檔的陣列長度一致
  for (const k in net) for (let i = 0; i < days.length; i++) net[k][i] = net[k][i] || 0;
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({ from, to, days, names, net, tpexDays: tpexOk });
}
