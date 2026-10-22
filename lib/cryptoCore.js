// 加密貨幣籌碼計算（伺服器和瀏覽器共用同一份）
// 資料來源：幣安 USDⓈ-M 永續合約公開 API，不需要 API key。
import { divergence, pattern, rangeBox } from './indicators.js';

export const BINANCE = 'https://fapi.binance.com';

// 訊號代號 → 中文名稱與方向（給畫面用）
export const CRYPTO_SIGNALS = {
  boxLong:    { label: '箱底做多', dir: 1, alert: true },
  boxLongPlus:{ label: '箱底多重確認', dir: 1, alert: true },
  boxShort:   { label: '箱頂做空', dir: -1, alert: true },
  boxShortPlus:{ label: '箱頂多重確認', dir: -1, alert: true },
  baseBreak:  { label: '築底突破', dir: 1, alert: true },
  botTurn:    { label: '大跌後轉強啟動', dir: 1, alert: true },
  topTurn:    { label: '大漲後轉弱啟動', dir: -1, alert: true },
  topWarn:    { label: '大漲後高位警戒', dir: -1, alert: true },
  boxBreakDown: { label: '整理後跌破', dir: -1, alert: true },
  coilUp:     { label: '築底蓄力・可能急漲', dir: 1, alert: true },
  coilDown:   { label: '高位蓄力・可能急跌', dir: -1, alert: true },
  coil:       { label: '蓄力・方向未明', dir: 0, alert: true },
  stealthBuy: { label: '大戶偷偷買', dir: 1, alert: true },
  stealthSell:{ label: '大戶偷偷賣', dir: -1, alert: true },
  macdBull2:  { label: '4H MACD 持續底背離', dir: 1, alert: true },
  macdBear2:  { label: '4H MACD 持續頂背離', dir: -1, alert: true },
  macdBull:   { label: '4H MACD 底背離', dir: 1 },
  macdBear:   { label: '4H MACD 頂背離', dir: -1 },
  whaleLong:  { label: '大戶增倉做多', dir: 1 },
  whaleShort: { label: '大戶增倉做空', dir: -1 },
  divLong:    { label: '大戶多・散戶空', dir: 1 },
  divShort:   { label: '散戶多・大戶空', dir: -1 },
  takerBuy:   { label: '主動買盤強', dir: 1 },
  takerSell:  { label: '主動賣壓強', dir: -1 },
  crowdLong:  { label: '多方擁擠', dir: 0 },
  crowdShort: { label: '空方擁擠', dir: 0 },
  oiFlush:    { label: '大量平倉', dir: 0 },
};

const last = (a) => a[a.length - 1];
const pct = (now, before) => (before ? (now / before - 1) * 100 : null);

// 蓄力判斷：價格沒什麼動（24h 漲跌 ≤ 3%、振幅 ≤ 8%），持倉卻明顯增加（24h ≥ 8%）
// 代表有人在悄悄建倉，等一個方向突破。再用資金費率與多空比判斷偏向哪邊。
export function coilBias(r) {
  const flat = Math.abs(r.chg24) <= 3 && (r.range24 == null || r.range24 <= 8);
  if (!flat || !(r.oiChg24 >= 8)) return null;
  let bull = 0, bear = 0;
  const why = [];
  if (r.funding != null && r.funding < 0) { bull++; why.push('資金費率為負，空單在付錢'); }
  if (r.funding != null && r.funding >= 0.03) { bear++; why.push('資金費率偏高，多單擁擠'); }
  if (r.topLSChg > 0) { bull++; why.push('大戶多空比上升'); }
  if (r.topLSChg < 0) { bear++; why.push('大戶多空比下降'); }
  if (r.globalLSChg < 0) { bull++; why.push('散戶轉空'); }
  if (r.globalLSChg > 0) { bear++; why.push('散戶轉多'); }
  if (r.taker != null && r.taker >= 1.05) { bull++; why.push('主動買盤較多'); }
  if (r.taker != null && r.taker <= 0.95) { bear++; why.push('主動賣壓較多'); }
  const kind = bull >= 2 && bull > bear ? 'coilUp' : bear >= 2 && bear > bull ? 'coilDown' : 'coil';
  return { kind, bull, bear, why };
}

// 型態訊號：用 4H K 線量「大漲 / 大跌 / 整理箱」，再用籌碼確認是不是剛啟動
// 只要價格條件 + 籌碼條件同時成立才算，理由寫進 r.patWhy 給畫面顯示
export function patternSignals(r) {
  const p = r.pat;
  const out = [];
  if (!p) return out;
  const why = [];
  const f = r.funding;

  // A. 大漲後：7 天內創高、從低點漲 30% 以上
  if (p.rise >= 30 && p.hiAgo <= 42) {
    let score = 0;
    const w = [];
    if (f != null && f >= 0.03) { score++; w.push('資金費率偏高'); }
    if (f != null && f >= 0.08) { score++; }
    if (p.cvdBearDiv) { score += 2; w.push('價格創高但 CVD 沒跟上'); }
    if (r.topLSChg < 0 && r.globalLSChg > 0) { score++; w.push('大戶減多、散戶追多'); }
    if (r.div && r.div.bear >= 1) { score++; w.push('4H MACD 頂背離'); }
    if (r.oiChg24 >= 5 && Math.abs(r.chg24) <= 2) { score++; w.push('持倉增加但價格漲不動'); }
    // 剛開始轉弱：離高點 3–15%，最近 4 小時主動賣出、持倉下降（多單在撤）
    if (p.dd >= 3 && p.dd <= 15 && r.cvd4 < 0 && r.oiChg4 < 0 && score >= 1) {
      out.push('topTurn'); why.push(`漲 ${p.rise.toFixed(0)}% 後回落 ${p.dd.toFixed(1)}%`, '4 小時主動賣出', '持倉下降', ...w);
    } else if (p.dd <= 4 && score >= 3) {
      out.push('topWarn'); why.push(`漲 ${p.rise.toFixed(0)}% 仍在高點`, ...w);
    }
  }

  // B. 大跌後：7 天內破底、從高點跌 30% 以上，開始反彈
  if (p.drop >= 30 && p.loAgo <= 42) {
    let score = 0;
    const w = [];
    if (f != null && f < 0) { score++; w.push('資金費率為負'); }
    if (f != null && f <= -0.03) { score++; }
    if (p.cvdBullDiv) { score += 2; w.push('價格破低但 CVD 沒破'); }
    if (r.topLSChg > 0 && r.globalLSChg < 0) { score++; w.push('大戶加多、散戶追空'); }
    if (r.div && r.div.bull >= 1) { score++; w.push('4H MACD 底背離'); }
    if (p.bounce >= 3 && p.bounce <= 15 && r.cvd4 > 0 && r.oiChg4 > 0 && score >= 2) {
      out.push('botTurn'); why.push(`跌 ${p.drop.toFixed(0)}% 後反彈 ${p.bounce.toFixed(1)}%`, '4 小時主動買入', '持倉增加', ...w);
    }
  }

  // C. 築底突破：前 7 天箱型振幅 ≤ 15%，最新 K 棒帶量突破箱頂，持倉與 CVD 同步增加，資金費率不過熱
  if (p.breakUp && p.volRatio >= 2 && r.oiChg4 > 0 && r.cvd4 > 0 && (f == null || f <= 0.03)) {
    out.push('baseBreak');
    why.push(`7 天箱型 ${p.boxRange.toFixed(1)}% 帶量突破`, `量 ${p.volRatio.toFixed(1)} 倍`, '持倉與 CVD 同步增加');
    if (r.oiBoxChg > 0) why.push(`整理期間持倉已增加 ${r.oiBoxChg.toFixed(1)}%`);
    if (p.boxCvd > 0) why.push('整理期間 CVD 為淨買入');
  }
  if (p.breakDown && p.volRatio >= 2 && r.oiChg4 > 0 && r.cvd4 < 0) {
    out.push('boxBreakDown');
    why.push(`7 天箱型 ${p.boxRange.toFixed(1)}% 帶量跌破`, '新空單進場');
  }
  r.patWhy = why;
  return out;
}

const px = (v) => (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));

// 箱體交易：4H 箱子振幅 ≤ 7%，價格回到箱底才做多、漲到箱頂才做空，再用籌碼確認
// 確認 2 項 → 箱底做多（中），4 項以上 → 再加「多重確認」（強）
export function boxSignals(r) {
  const b = r.box;
  r.boxWhy = null;
  if (!b || b.broke) return [];
  const f = r.funding;
  const head = `4H 箱體 ${px(b.lo)}–${px(b.hi)}（${b.range.toFixed(1)}%，整理 ${b.hours} 小時）`;
  if (b.pos <= 0.2) {
    const ok = [];
    if (r.cvd4 > 0) ok.push('箱底有主動買盤');
    if (r.pat?.cvdBullDiv) ok.push('價格破低 CVD 沒破');
    if (f != null && f <= 0.005) ok.push(f < 0 ? '資金費率為負' : '多單不擁擠');
    if (r.topLSChg > 0) ok.push('大戶加多');
    if (r.globalLSChg < 0) ok.push('散戶轉空');
    if (r.oiChg4 > 0 && r.cvd4 > 0) ok.push('新多單進場');
    if (ok.length < 2) return [];
    r.boxWhy = [`${head}，現價在箱底 ${Math.round(b.pos * 100)}% 位置`, ...ok, `停損：跌破 ${px(b.lo * 0.99)}`, `目標：箱頂 ${px(b.hi)}`];
    return ok.length >= 4 ? ['boxLong', 'boxLongPlus'] : ['boxLong'];
  }
  if (b.pos >= 0.8) {
    const ok = [];
    if (r.cvd4 < 0) ok.push('箱頂有主動賣壓');
    if (r.pat?.cvdBearDiv) ok.push('價格創高 CVD 沒跟上');
    if (f != null && f >= 0.02) ok.push('多單擁擠');
    if (r.topLSChg < 0) ok.push('大戶減多');
    if (r.globalLSChg > 0) ok.push('散戶追多');
    if (r.oiChg4 > 0 && r.cvd4 < 0) ok.push('新空單進場');
    if (ok.length < 2) return [];
    r.boxWhy = [`${head}，現價在箱頂 ${Math.round(b.pos * 100)}% 位置`, ...ok, `停損：突破 ${px(b.hi * 1.01)}`, `目標：箱底 ${px(b.lo)}`];
    return ok.length >= 4 ? ['boxShort', 'boxShortPlus'] : ['boxShort'];
  }
  return [];
}

export function cryptoSignals(r) {
  const s = [...boxSignals(r), ...patternSignals(r)];
  const c = coilBias(r);
  if (c) { s.push(c.kind); r.coilWhy = c.why; }
  // 偷偷買：價格沒漲（甚至在跌），CVD 卻明顯是買方淨流入，而且大戶加多或持倉增加
  // 偷偷賣：價格沒跌（甚至在漲），CVD 卻是賣方淨流出，而且大戶減多或持倉增加
  if (r.cvdRatio != null) {
    const whaleIn = r.topLSChg > 0 || r.oiChg24 >= 3;
    const whaleOut = r.topLSChg < 0 || r.oiChg24 >= 3;
    if (r.chg24 <= 2 && r.cvdRatio >= 3 && whaleIn) s.push('stealthBuy');
    if (r.chg24 >= -2 && r.cvdRatio <= -3 && whaleOut) s.push('stealthSell');
  }
  if (r.div) {
    if (r.div.bull >= 2) s.push('macdBull2'); else if (r.div.bull === 1) s.push('macdBull');
    if (r.div.bear >= 2) s.push('macdBear2'); else if (r.div.bear === 1) s.push('macdBear');
  }
  if (r.oiChg24 >= 5 && r.chg24 > 0 && r.topLSChg > 0) s.push('whaleLong');
  if (r.oiChg24 >= 5 && r.chg24 < 0 && r.topLSChg < 0) s.push('whaleShort');
  if (r.globalLS > 0 && r.topLS / r.globalLS >= 1.3) s.push('divLong');
  if (r.topLS > 0 && r.globalLS / r.topLS >= 1.3) s.push('divShort');
  if (r.taker >= 1.2) s.push('takerBuy');
  if (r.taker <= 0.83) s.push('takerSell');
  if (r.funding != null && r.funding >= 0.05) s.push('crowdLong');
  if (r.funding != null && r.funding <= -0.03) s.push('crowdShort');
  if (r.oiChg24 <= -8) s.push('oiFlush');
  return s;
}

// 大戶動能分數 0–100：持倉變化、大戶多空比變化、主動買賣力道加權
export function cryptoScore(r) {
  const cap = (v, m) => Math.min(Math.abs(v || 0), m) / m;
  return Math.round(
    cap(r.oiChg24, 30) * 40 + cap(r.topLSChg, 0.5) * 25 + cap((r.taker || 1) - 1, 0.4) * 20 + cap(r.oiChg4, 10) * 15
  );
}

async function one(t, p, getJSON) {
  const s = t.symbol;
  const q = `symbol=${s}&period=1h&limit=25`;
  const [oi, top, glob, taker, kl, k4, oi4] = await Promise.all([
    getJSON(`${BINANCE}/futures/data/openInterestHist?${q}`),
    getJSON(`${BINANCE}/futures/data/topLongShortPositionRatio?${q}`),
    getJSON(`${BINANCE}/futures/data/globalLongShortAccountRatio?${q}`),
    getJSON(`${BINANCE}/futures/data/takerlongshortRatio?symbol=${s}&period=1h&limit=4`),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=1h&limit=24`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=4h&limit=150`).catch(() => []),
    getJSON(`${BINANCE}/futures/data/openInterestHist?symbol=${s}&period=4h&limit=44`).catch(() => []),
  ]);
  // CVD（累積成交量差）：每根 K 棒「主動買入額 − 主動賣出額」一路加總，看真金白銀往哪邊流
  let cum = 0, buyMinusSell4 = 0, quoteSum = 0;
  const cvdSpark = kl.map((k, i) => {
    const q = +k[7], buy = +k[10];
    const delta = buy - (q - buy);
    cum += delta; quoteSum += q;
    if (i >= kl.length - 4) buyMinusSell4 += delta;
    return cum;
  });
  const bars4h = k4.map((k) => ({ h: +k[2], l: +k[3], c: +k[4], v: +k[7], d: 2 * +k[10] - +k[7] }));
  // 整理期間（突破前 7 天）持倉變化
  const oiBoxChg = oi4.length >= 4 ? pct(+oi4[oi4.length - 3].sumOpenInterestValue, +oi4[0].sumOpenInterestValue) : null;
  const hi = kl.length ? Math.max(...kl.map((k) => +k[2])) : null;
  const lo = kl.length ? Math.min(...kl.map((k) => +k[3])) : null;
  if (!oi.length || !top.length || !glob.length) return null;
  const oiNow = +last(oi).sumOpenInterestValue;
  const r = {
    symbol: s,
    base: s.replace(/USDT$/, ''),
    price: +t.lastPrice,
    chg24: +t.priceChangePercent,
    vol24: +t.quoteVolume,
    range24: hi && lo ? ((hi - lo) / lo) * 100 : null,
    funding: p ? +p.lastFundingRate * 100 : null,
    oi: oiNow,
    oiChg24: pct(oiNow, +oi[0].sumOpenInterestValue),
    oiChg4: pct(oiNow, +oi[Math.max(0, oi.length - 5)].sumOpenInterestValue),
    topLS: +last(top).longShortRatio,
    topLSChg: +last(top).longShortRatio - +top[0].longShortRatio,
    topLong: +last(top).longAccount * 100,
    globalLS: +last(glob).longShortRatio,
    globalLSChg: +last(glob).longShortRatio - +glob[0].longShortRatio,
    taker: taker.length ? taker.reduce((a, x) => a + +x.buySellRatio, 0) / taker.length : null,
    spark: oi.map((x) => +x.sumOpenInterestValue),
    cvd24: kl.length ? cum : null,
    cvd4: kl.length ? buyMinusSell4 : null,
    cvdRatio: quoteSum ? (cum / quoteSum) * 100 : null, // CVD 佔 24h 成交額 %
    cvdSpark,
    div: bars4h.length >= 40 ? divergence(bars4h) : null,
    pat: bars4h.length >= 60 ? pattern(bars4h, { box: 42, runWin: 150, boxMax: 15 }) : null,
    box: bars4h.length >= 20 ? rangeBox(bars4h, { max: 7 }) : null,
    oiBoxChg,
  };
  r.signals = cryptoSignals(r);
  r.score = cryptoScore(r);
  return r;
}

// n = 取成交額前幾名的合約
export async function buildCrypto(n, { getJSON, pool }) {
  const [tickers, prem, info] = await Promise.all([
    getJSON(`${BINANCE}/fapi/v1/ticker/24hr`),
    getJSON(`${BINANCE}/fapi/v1/premiumIndex`),
    getJSON(`${BINANCE}/fapi/v1/exchangeInfo`),
  ]);
  const perp = new Set(
    info.symbols
      .filter((x) => x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT' && x.status === 'TRADING')
      .map((x) => x.symbol)
  );
  const fund = new Map(prem.map((p) => [p.symbol, p]));
  const top = tickers
    .filter((t) => perp.has(t.symbol))
    .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, n);
  const rows = (
    await pool(top, 8, async (t) => {
      try { return await one(t, fund.get(t.symbol), getJSON); } catch { return null; }
    })
  ).filter(Boolean);
  if (!rows.length) throw new Error('幣安沒有回傳任何合約資料');
  return { updatedAt: Date.now(), source: '幣安 USDⓈ-M 永續合約', rows };
}
