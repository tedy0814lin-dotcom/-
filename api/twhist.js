// GET /api/twhist?codes=2330,2317
// 抓個股近 4 個月日 K，算日線 MACD 背離與型態（大漲大跌、箱型突破）。一次最多 8 檔（證交所會擋太快的請求）。
import { requireUser, getJSON, sleep } from './_lib.js';
import { paiNow } from '../lib/pai.js';
import { cvdoCross } from '../lib/cvdo.js';
import { divergence, pattern } from '../lib/indicators.js';
import { structure, STRUCT_TW, chochOB } from '../lib/structure.js';
import { harmonicCD, harmonic } from '../lib/harmonic.js';
import { vegas } from '../lib/vegas.js';
import { tunnel } from '../lib/cryptoCore.js';

const TWSE = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const cache = new Map(); // code → { day, data }

const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(v) ? v : NaN;
};

function months(n) {
  const out = [];
  const d = new Date(Date.now() + 8 * 3600e3);
  for (let i = 0; i < n; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}${String(m.getUTCMonth() + 1).padStart(2, '0')}01`);
  }
  return out.reverse();
}

// 上櫃股票證交所查不到，改抓 Yahoo 財經日 K
async function yahooDaily(code) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.TWO?interval=1d&range=6mo`, { timeout: 12000 });
  const r = j.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!q) return [];
  const bars = [];
  for (let i = 0; i < (r.timestamp || []).length; i++) {
    if (r.timestamp[i] + 4.5 * 3600 > Date.now() / 1000) continue; // 今天還沒收盤的不算
    const b = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: (q.volume[i] || 0) / 1000 };
    if (b.h > 0 && b.l > 0 && b.c > 0) bars.push(b);
  }
  return bars;
}

async function history(code) {
  const bars = [];
  let first = true;
  for (const ym of months(5)) {
    if (!first && !bars.length) return yahooDaily(code);
    first = false;
    const j = await getJSON(`${TWSE}?date=${ym}&stockNo=${code}&response=json`);
    if (j.stat === 'OK' && Array.isArray(j.data)) {
      const f = j.fields.map(String);
      const iO = f.findIndex((x) => x.includes('開盤')), iH = f.findIndex((x) => x.includes('最高')), iL = f.findIndex((x) => x.includes('最低')), iC = f.findIndex((x) => x.includes('收盤'));
      const iV = f.findIndex((x) => x.includes('成交股數'));
      for (const r of j.data) {
        const b = { o: iO >= 0 ? num(r[iO]) : undefined, h: num(r[iH]), l: num(r[iL]), c: num(r[iC]), v: iV >= 0 ? num(r[iV]) / 1000 : 0 };
        if (b.h > 0 && b.l > 0 && b.c > 0) bars.push(b);
      }
    }
    await sleep(300);
  }
  return bars;
}

// 1 小時 K（Yahoo，要帶瀏覽器 UA，不然常被擋）：抓近一年，順便合成較長的日 K 給 CHoCH 用
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const hcache = new Map(); // code → { at, data }
async function yahooHour(code) {
  const now = Date.now() / 1000;
  for (const sfx of ['TW', 'TWO']) {
    let j;
    try { j = await getJSON(`https://query2.finance.yahoo.com/v8/finance/chart/${code}.${sfx}?interval=60m&range=1y`, { timeout: 12000, retries: 1, headers: { 'User-Agent': UA } }); } catch { continue; }
    const r = j.chart?.result?.[0], q = r?.indicators?.quote?.[0];
    if (!q || !r.timestamp?.length) continue;
    const bars = [];
    r.timestamp.forEach((t, i) => {
      const b = { t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] };
      if (b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && t + 3600 <= now) bars.push(b); // 還沒走完的那根不算
    });
    if (bars.length) return bars;
  }
  return [];
}
// 日 K 三年（Yahoo）：給日線諧波、維加斯通道用（EMA338 需要 400 根以上）
async function yahooDaily3y(code) {
  const now = Date.now() / 1000;
  for (const sfx of ['TW', 'TWO']) {
    let j;
    try { j = await getJSON(`https://query2.finance.yahoo.com/v8/finance/chart/${code}.${sfx}?interval=1d&range=3y`, { timeout: 12000, retries: 1, headers: { 'User-Agent': UA } }); } catch { continue; }
    const r = j.chart?.result?.[0], q = r?.indicators?.quote?.[0];
    if (!q || !r.timestamp?.length) continue;
    const bars = [];
    r.timestamp.forEach((t, i) => {
      const b = { t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: (q.volume?.[i] || 0) / 1000 };
      if (b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && t + 5.5 * 3600 <= now) bars.push(b); // 今天還沒收盤的不算
    });
    if (bars.length) return bars;
  }
  return [];
}
export async function hourData(code) {
  const hit = hcache.get(code);
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.data;
  const [h, dly] = await Promise.all([yahooHour(code), yahooDaily3y(code).catch(() => [])]);
  let data = null;
  if (h.length >= 120) {
    const days = new Map();
    for (const b of h) {
      const k = Math.floor((b.t + 28800) / 86400), d = days.get(k);
      if (!d) days.set(k, { o: b.o, h: b.h, l: b.l, c: b.c });
      else { d.h = Math.max(d.h, b.h); d.l = Math.min(d.l, b.l); d.c = b.c; }
    }
    const tpe = new Date(Date.now() + 8 * 3600e3), today = Math.floor((Date.now() / 1000 + 28800) / 86400);
    const daily = [...days.entries()].filter(([k]) => k < today || tpe.getUTCHours() >= 14).map(([, d]) => d);
    const b1 = h.slice(-300);
    data = {
      chochOB: chochOB(b1, { RR: 5, longOnly: true }), // 台股只做多，目標 5R（回測最好）
      harmCD: harmonicCD(b1).filter((x) => x.dir === 1),
      dailyOB: daily.length >= 120 ? chochOB(daily.slice(-300), { RR: 5, longOnly: true }) : undefined,
    };
    // 2026-10-29 台股回測（100 檔、日線 10 年、60 分 2 年、扣手續費＋證交稅）後保留的策略用的資料
    const h4 = []; // 台股 4H＝連續 4 根 60 分 K（從最新往回切）
    for (let i = h.length - 4; i >= 0; i -= 4) { const g = h.slice(i, i + 4); h4.unshift({ o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[3].c }); }
    data.harm4 = h4.length >= 60 ? harmonic(h4.slice(-300)) : null;
    data.cd4 = h4.length >= 60 ? harmonicCD(h4.slice(-300)).filter((x) => x.dir === 1) : [];
  }
  if (dly.length >= 120) {
    data = data || {};
    data.harmD = harmonic(dly.slice(-300));
    data.cdD = harmonicCD(dly.slice(-300)).filter((x) => x.dir === 1);
    data.vgD = vegas(dly);
    data.tunD = tunnel(dly);
    data.pai = paiNow(dly.slice(-200));
    data.cvdo = cvdoCross(dly);
    data.dly110 = dly.slice(-110).map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  }
  hcache.set(code, { at: Date.now(), data });
  return data;
}

// 一檔股票的日線分析（警報排程也會用）
export async function histData(code, day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)) {
  let h1 = null;
  try { h1 = await hourData(code); } catch {}
  const withH1 = (d) => ({ ...d, h1, chochOB: h1 && h1.dailyOB !== undefined ? h1.dailyOB : d.chochOB });
  const hit = cache.get(code);
  if (hit && hit.day === day) return withH1(hit.data);
  // 有 Yahoo 日 K 就直接用（快很多）；沒有才去證交所一個月一個月抓
  const bars = h1?.dly110?.length >= 60 ? h1.dly110 : await history(code);
  if (h1) delete h1.dly110;
  // 日線：20 日箱型、往回 60 日找大漲大跌
  const data = {
    ...divergence(bars, { lookback: 70, w: 3, recent: 12 }),
    pat: pattern(bars, { box: 20, runWin: 60, boxMax: 15 }),
    st: structure(bars, bars, STRUCT_TW), // 日線大箱 / 短箱 / 趨勢回踩
    chochOB: chochOB(bars, { RR: 5, longOnly: true }), // 日線 CHoCH 訂單塊（只做多）；有 Yahoo 一年資料時改用較長的那份
    // 諧波 CD 段（反著用：B 進場、C 停損、D 止盈）。台股回測只有做多有效（做空 -0.15R），所以只留做多
    harmCD: harmonicCD(bars).filter((x) => x.dir === 1),
    bars: bars.length,
  };
  cache.set(code, { day, data });
  return withH1(data);
}

export default async function handler(req, res) {
  if (!requireUser(req, res)) return;
  const codes = String(req.query.codes || '').split(',').map((c) => c.trim()).filter((c) => /^\d{4}$/.test(c)).slice(0, 8);
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const out = {};
  // 同時抓（全部掃描時一次 8 檔，逐檔抓會逾時）
  await Promise.all(codes.map(async (code) => {
    try { out[code] = await histData(code, day); } catch (e) { out[code] = { error: e.message }; }
  }));
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json(out);
}
