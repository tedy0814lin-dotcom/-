// GET /api/twstock?refresh=1
// 台股上市籌碼：三大法人買賣超（近 5 個交易日）＋ 融資融券 ＋ 收盤價
// 資料來源：臺灣證券交易所公開資料，每天收盤後約 15:00–16:30 更新。
import { requireUser, getJSON, sleep } from './_lib.js';

const TWSE = 'https://www.twse.com.tw/rwd/zh';
const TTL = 30 * 60 * 1000;
let cache = { at: 0, data: null };

const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const lots = (shares) => Math.round(num(shares) / 1000); // 股 → 張

// 台北時間的日期字串 YYYYMMDD，以及星期幾
function taipeiDay(back) {
  const d = new Date(Date.now() + 8 * 3600e3 - back * 864e5);
  return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), dow: d.getUTCDay() };
}

async function fetchT86(ymd) {
  const j = await getJSON(`${TWSE}/fund/T86?date=${ymd}&selectType=ALLBUT0999&response=json`);
  if (j.stat !== 'OK' || !Array.isArray(j.data) || !j.data.length) return null;
  const f = j.fields.map((x) => String(x).trim());
  const at = (pred) => f.findIndex(pred);
  const iCode = at((x) => x.includes('證券代號'));
  const iName = at((x) => x.includes('證券名稱'));
  const iFor = at((x) => x.startsWith('外陸資買賣超') || x.startsWith('外資買賣超'));
  const iTrust = at((x) => x === '投信買賣超股數');
  const iDealer = at((x) => x === '自營商買賣超股數');
  const iTotal = at((x) => x.includes('三大法人買賣超'));
  if ([iCode, iFor, iTrust, iTotal].some((i) => i < 0)) throw new Error('三大法人欄位格式改了');
  const map = new Map();
  for (const r of j.data) {
    const code = String(r[iCode]).trim();
    map.set(code, {
      name: String(r[iName] ?? '').trim(),
      foreign: lots(r[iFor]),
      trust: lots(r[iTrust]),
      dealer: iDealer >= 0 ? lots(r[iDealer]) : 0,
      total: lots(r[iTotal]),
    });
  }
  return map;
}

// 融資融券：單位已經是「張」
async function fetchMargin(ymd) {
  const j = await getJSON(`${TWSE}/marginTrading/MI_MARGN?date=${ymd}&selectType=ALL&response=json`);
  if (j.stat !== 'OK') return new Map();
  const tables = j.tables || [];
  const t = tables
    .filter((x) => Array.isArray(x.data) && x.data.length && (x.data[0] || []).length >= 13)
    .sort((a, b) => b.data.length - a.data.length)[0];
  const map = new Map();
  if (!t) return map;
  for (const r of t.data) {
    map.set(String(r[0]).trim(), {
      marginBal: num(r[6]),
      marginChg: num(r[6]) - num(r[5]),
      shortBal: num(r[12]),
      shortChg: num(r[12]) - num(r[11]),
    });
  }
  return map;
}

// 某一天全部上市股票的收盤價（用來算 5 日漲跌）
async function fetchCloses(ymd) {
  const j = await getJSON(`${TWSE}/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`);
  const map = new Map();
  if (j.stat !== 'OK') return map;
  const tables = j.tables || [];
  const t = tables.find((x) => Array.isArray(x.fields) && x.fields.some((f) => String(f).includes('證券代號')) && x.fields.some((f) => String(f).includes('收盤價')));
  if (!t) return map;
  const iCode = t.fields.findIndex((f) => String(f).includes('證券代號'));
  const iClose = t.fields.findIndex((f) => String(f).includes('收盤價'));
  for (const r of t.data || []) {
    const c = num(r[iClose]);
    if (c > 0) map.set(String(r[iCode]).trim(), c);
  }
  return map;
}

async function fetchPrices() {
  const arr = await getJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
  const map = new Map();
  for (const r of arr) {
    const close = num(r.ClosingPrice);
    const change = num(r.Change);
    const prev = close - change;
    map.set(String(r.Code).trim(), {
      close,
      chg: prev > 0 ? (change / prev) * 100 : 0,
      volume: lots(r.TradeVolume),
    });
  }
  return map;
}

// 從最新一天往回數，連續買（正數）或連續賣（負數）幾天
function streak(values) {
  if (!values.length || values[0] === 0) return 0;
  const sign = Math.sign(values[0]);
  let n = 0;
  for (const v of values) { if (Math.sign(v) === sign) n++; else break; }
  return n * sign;
}

export const TW_SIGNALS = {
  coilUp: '築底吸籌', coilDown: '高檔出貨', stealthBuy: '法人逆勢偷買', stealthSell: '法人逢高偷賣',
  trustBuy: '投信連買', foreignBuy: '外資連買', bothBuy: '土洋同買',
  concentrate: '籌碼集中', bigRatio: '法人買超佔量大',
  trustSell: '投信連賣', foreignSell: '外資連賣', shortUp: '融券大增',
};

async function build() {
  // 1) 往回找最近 5 個有資料的交易日
  const days = [];
  for (let back = 0; back < 16 && days.length < 5; back++) {
    const { ymd, dow } = taipeiDay(back);
    if (dow === 0 || dow === 6) continue;
    try {
      const m = await fetchT86(ymd);
      if (m) days.push({ ymd, map: m });
    } catch (e) {
      if (String(e.message).includes('格式')) throw e;
    }
    await sleep(350); // 證交所會擋太快的請求
  }
  if (!days.length) throw new Error('證交所沒有回傳三大法人資料');
  const latest = days[0];
  const oldest = days[days.length - 1];
  const [margin, prices, oldCloses] = await Promise.all([
    fetchMargin(latest.ymd).catch(() => new Map()),
    fetchPrices().catch(() => new Map()),
    days.length > 1 ? fetchCloses(oldest.ymd).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);

  const rows = [];
  for (const [code, today] of latest.map) {
    if (!/^\d{4}$/.test(code)) continue; // 只留一般股票與 4 碼 ETF
    const hist = days.map((d) => d.map.get(code) || { foreign: 0, trust: 0, dealer: 0, total: 0 });
    const p = prices.get(code) || {};
    const m = margin.get(code) || {};
    const r = {
      code, name: today.name,
      close: p.close ?? null, chg: p.chg ?? null, volume: p.volume ?? null,
      foreign: today.foreign, trust: today.trust, dealer: today.dealer, total: today.total,
      foreign5: hist.reduce((a, h) => a + h.foreign, 0),
      trust5: hist.reduce((a, h) => a + h.trust, 0),
      total5: hist.reduce((a, h) => a + h.total, 0),
      foreignStreak: streak(hist.map((h) => h.foreign)),
      trustStreak: streak(hist.map((h) => h.trust)),
      marginChg: m.marginChg ?? null, marginBal: m.marginBal ?? null,
      shortChg: m.shortChg ?? null, shortBal: m.shortBal ?? null,
      trend: hist.map((h) => h.total).reverse(), // 舊 → 新
    };
    r.ratio = r.volume ? (r.total / r.volume) * 100 : null;
    const base = oldCloses.get(code);
    r.chg5 = base && r.close ? (r.close / base - 1) * 100 : null;
    r.ratio5 = r.volume ? (r.total5 / r.volume) * 100 : null; // 5 日法人買賣超 ÷ 今日成交量
    const s = [];
    // 築底吸籌：5 日股價幾乎沒動，法人卻累積買超、融資沒有增加
    const flat5 = r.chg5 != null && Math.abs(r.chg5) <= 3;
    const liquid = r.volume >= 1000;
    if (flat5 && liquid && r.ratio5 >= 30 && (r.trustStreak >= 2 || r.foreignStreak >= 2) && !(r.marginChg > 0)) s.push('coilUp');
    // 高檔出貨：5 日股價沒動，法人累積賣超、融資反而增加（散戶在接）
    // 逆勢偷買：股價 5 日跌超過 3%，法人卻連買、累積買超大 → 有人在低接
    if (liquid && r.chg5 != null && r.chg5 <= -3 && r.ratio5 >= 30 && (r.trustStreak >= 2 || r.foreignStreak >= 2)) s.push('stealthBuy');
    // 逢高偷賣：股價 5 日漲超過 3%，法人卻連賣 → 有人趁漲出貨
    if (liquid && r.chg5 != null && r.chg5 >= 3 && r.ratio5 <= -30 && (r.trustStreak <= -2 || r.foreignStreak <= -2)) s.push('stealthSell');
    if (flat5 && liquid && r.ratio5 <= -30 && (r.trustStreak <= -2 || r.foreignStreak <= -2) && r.marginChg > 0) s.push('coilDown');
    if (r.trustStreak >= 3) s.push('trustBuy');
    if (r.foreignStreak >= 3) s.push('foreignBuy');
    if (r.foreign > 0 && r.trust > 0) s.push('bothBuy');
    if (r.total > 0 && r.marginChg != null && r.marginChg < 0) s.push('concentrate');
    if (r.ratio != null && r.ratio >= 20 && r.volume >= 500) s.push('bigRatio');
    if (r.trustStreak <= -3) s.push('trustSell');
    if (r.foreignStreak <= -3) s.push('foreignSell');
    if (r.shortChg != null && r.shortBal > 0 && r.shortChg >= 500 && r.shortChg / r.shortBal >= 0.2) s.push('shortUp');
    r.signals = s;
    rows.push(r);
  }
  return {
    updatedAt: Date.now(),
    date: latest.ymd,
    days: days.map((d) => d.ymd),
    source: '臺灣證券交易所（上市）',
    rows,
  };
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  if (cache.data && Date.now() - cache.at < TTL && req.query.refresh !== '1') {
    return res.status(200).json({ ...cache.data, cached: true });
  }
  try {
    const data = await build();
    cache = { at: Date.now(), data };
    res.status(200).json(data);
  } catch (e) {
    if (cache.data) return res.status(200).json({ ...cache.data, stale: true, warning: e.message });
    res.status(502).json({ error: `抓不到證交所資料（${e.message}）` });
  }
}
