// BingX 永續合約資料，包成「幣安 fapi 的格式」給舊程式直接用（2026-11-08 搬遷：GitHub 主機連不到幣安）
//
// 做法：api/_lib.js 的 getJSON 看到 https://fapi.binance.com/... 的網址，就改問 BingX，回傳跟幣安一樣的欄位。
// 這樣 cryptoCore、footprint、claudeApi、twPatApi、stratlog、vegas 都不用改抓資料的寫法，代號也維持 BTCUSDT 這種格式。
//
// 跟幣安不一樣、要知道的地方：
//   1. K 線沒有「主動買入量」。k[10]（takerBuyQuote）改用 OHLCV 近似：
//        delta = 成交額 × 2 × (收 − 開) ÷ (高 − 低)，takerBuy = (成交額 + delta) ÷ 2
//      這就是 2026-11-07 回測 Delta 階梯「近似版」用的公式（BingX 近似 +0.13～0.15R，約真 Delta 的 55～65%）。
//      CVD 類策略在 BingX 資料上回測不過（後半段轉負），已停用，不要依賴 k[10] 當真實買賣量。
//   2. 成交額 k[7] = 成交量(幣) × 收盤價（BingX 沒給成交額；回測時也是這樣算）。
//   3. 沒有大戶多空比、全市場多空比、主動買賣比、持倉量歷史 → 這些端點直接丟錯，由呼叫端當作「沒有」。
//   4. 只有 USDT 本位永續；BingX 上的外匯、黃金、美股代幣（NC 開頭）不算加密貨幣，排除。
const BX = 'https://open-api.bingx.com';
const MS = { '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '12h': 432e5, '1d': 864e5 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const isBinanceUrl = (u) => /^https:\/\/fapi\.binance\.com\//.test(u);
const toBx = (s) => String(s).replace(/USDT$/, '') + '-USDT';
const fromBx = (s) => s.replace(/-USDT$/, 'USDT');
const isCrypto = (s) => /^[A-Z0-9]+-USDT$/.test(s) && !/^NC(FX|CO|SK|SI|ST|IN)/.test(s);

// 限速：BingX 行情端點大約每 10 秒 100 次，這裡保持每 90 毫秒最多開始一次
let gate = 0;
async function bxGet(path, { timeout = 12000, retries = 3 } = {}) {
  let err;
  for (let i = 0; i <= retries; i++) {
    const now = Date.now();
    const wait = Math.max(0, gate - now);
    gate = Math.max(now, gate) + 90;
    if (wait) await sleep(wait);
    try {
      const res = await fetch(BX + path, { headers: { 'User-Agent': 'Mozilla/5.0 (whale-radar)' }, signal: AbortSignal.timeout(timeout) });
      if (res.ok) {
        const j = await res.json();
        if (j.code === 0) return j.data;
        err = new Error(`BingX ${j.code} ${j.msg || ''}：${path.split('?')[0]}`);
        if (j.code !== 100410 && j.code !== 100500) throw err; // 只有限流／暫時性錯誤才重試
      } else {
        err = new Error(`HTTP ${res.status}：${path.split('?')[0]}`);
        if (res.status !== 429 && res.status < 500) throw err;
      }
    } catch (e) {
      err = e;
      if (/^(BingX|HTTP 4)/.test(e.message) && !/HTTP 429/.test(e.message) && !/10(0410|0500)/.test(e.message)) throw e;
    }
    if (i < retries) await sleep(1200 * (i + 1));
  }
  throw err;
}

// 一個 BingX K 線 → 幣安格式 [開盤時間, 開, 高, 低, 收, 量(幣), 收盤時間, 成交額, 筆數, 主動買量(幣), 主動買額, 0]
function kRow(x, step) {
  const o = +x.open, h = +x.high, l = +x.low, c = +x.close, v = +x.volume, t = +x.time;
  const q = v * c;
  const delta = h > l ? q * 2 * (c - o) / (h - l) : 0; // 近似 Delta
  const tbq = (q + delta) / 2;
  return [t, x.open, x.high, x.low, x.close, x.volume, t + step - 1, String(q), 0, String(c > 0 ? tbq / c : 0), String(tbq), '0'];
}

export async function bxKlines(symbol, interval, { limit = 500, startTime } = {}) {
  const step = MS[interval];
  if (!step) throw new Error('不支援的週期 ' + interval);
  const byT = new Map();
  let end = null;
  // 一次最多 1000 根；要更多就往前接
  while (byT.size < limit) {
    const n = Math.min(1000, limit - byT.size + (end ? 0 : 0));
    let q = `/openApi/swap/v3/quote/klines?symbol=${toBx(symbol)}&interval=${interval}&limit=${n}`;
    if (startTime && !end) q += `&startTime=${startTime}`;
    if (end) q += `&endTime=${end}`;
    const d = await bxGet(q);
    if (!Array.isArray(d) || !d.length) break;
    const before = byT.size;
    for (const x of d) byT.set(+x.time, x);
    if (startTime || d.length < n || byT.size === before) break;
    end = Math.min(...d.map((x) => +x.time)) - 1;
  }
  const rows = [...byT.values()].sort((a, b) => +a.time - +b.time).map((x) => kRow(x, step));
  return startTime ? rows.slice(0, limit) : rows.slice(-limit);
}

export async function bxContracts() {
  return (await bxGet('/openApi/swap/v2/quote/contracts')).filter((x) => x.status === 1 && isCrypto(x.symbol));
}

// 幣安 /fapi/v1/ticker/24hr 的格式
export async function bxTickers() {
  const ok = new Set((await bxContracts()).map((x) => x.symbol));
  return (await bxGet('/openApi/swap/v2/quote/ticker', { timeout: 20000 }))
    .filter((t) => ok.has(t.symbol))
    .map((t) => ({ symbol: fromBx(t.symbol), lastPrice: t.lastPrice, priceChangePercent: t.priceChangePercent, quoteVolume: t.quoteVolume, volume: t.volume, highPrice: t.highPrice, lowPrice: t.lowPrice }));
}

// 幣安 /fapi/v1/exchangeInfo 的格式
export async function bxInfo() {
  return { symbols: (await bxContracts()).map((x) => ({ symbol: fromBx(x.symbol), contractType: 'PERPETUAL', quoteAsset: 'USDT', status: 'TRADING', onboardDate: +x.launchTime || 0 })) };
}

// 幣安 /fapi/v1/premiumIndex 的格式（資金費率）
export async function bxPremium() {
  const ok = new Set((await bxContracts()).map((x) => x.symbol));
  return (await bxGet('/openApi/swap/v2/quote/premiumIndex', { timeout: 20000 })).filter((p) => ok.has(p.symbol)).map((p) => ({ symbol: fromBx(p.symbol), lastFundingRate: p.lastFundingRate, markPrice: p.markPrice }));
}

// getJSON 呼叫：把幣安網址轉成 BingX 回應。回傳 undefined 表示這個網址不歸這裡管。
export async function emulateBinance(url) {
  const u = new URL(url);
  const p = u.pathname, q = u.searchParams;
  if (p === '/fapi/v1/klines') return bxKlines(q.get('symbol'), q.get('interval'), { limit: +q.get('limit') || 500, startTime: q.get('startTime') ? +q.get('startTime') : undefined });
  if (p === '/fapi/v1/ticker/24hr') return bxTickers();
  if (p === '/fapi/v1/exchangeInfo') return bxInfo();
  if (p === '/fapi/v1/premiumIndex') return bxPremium();
  throw new Error('BingX 沒有這個資料：' + p); // 大戶多空比、持倉歷史、主動買賣比等
}
