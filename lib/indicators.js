// 技術指標：EMA、MACD、背離偵測（加密貨幣與台股共用）

export function ema(values, n) {
  const k = 2 / (n + 1);
  const out = [];
  let prev;
  for (const v of values) {
    prev = prev === undefined ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// MACD(12,26,9)：dif = 快線 − 慢線，dea = dif 的 9 期 EMA，hist = 柱狀體
export function macd(closes, fast = 12, slow = 26, sig = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const dif = closes.map((_, i) => f[i] - s[i]);
  const dea = ema(dif, sig);
  return { dif, dea, hist: dif.map((v, i) => v - dea[i]) };
}

// 找轉折低點 / 高點：左右各 w 根 K 棒都比它高（低點）或低（高點）
function pivots(arr, w, isLow) {
  const idx = [];
  for (let i = w; i < arr.length - w; i++) {
    let ok = true;
    for (let j = i - w; j <= i + w && ok; j++) {
      if (j === i) continue;
      if (isLow ? arr[j] < arr[i] : arr[j] > arr[i]) ok = false;
    }
    if (ok) idx.push(i);
  }
  return idx;
}

// 背離偵測
// 底背離：價格低點一次比一次低，MACD 的 dif 低點卻一次比一次高 → 賣壓在衰竭
// 頂背離：價格高點一次比一次高，dif 高點卻一次比一次低 → 買盤在衰竭
// 回傳連續背離次數：1 = 背離，2 以上 = 持續背離。最新轉折點要在最近 recent 根之內才算數。
export function divergence(bars, { lookback = 80, w = 3, recent = 15 } = {}) {
  if (bars.length < 40) return { bull: 0, bear: 0 };
  const closes = bars.map((b) => b.c);
  const { dif } = macd(closes);
  const start = Math.max(0, bars.length - lookback);
  const lows = bars.map((b) => b.l).slice(start);
  const highs = bars.map((b) => b.h).slice(start);
  const d = dif.slice(start);
  const n = lows.length;

  function count(points, price, isLow) {
    if (points.length < 2 || n - 1 - points[points.length - 1] > recent) return 0;
    let c = 0;
    for (let k = points.length - 1; k > 0; k--) {
      const a = points[k - 1], b = points[k];
      const priceOk = isLow ? price[b] < price[a] : price[b] > price[a];
      const difOk = isLow ? d[b] > d[a] : d[b] < d[a];
      if (priceOk && difOk) c++;
      else break;
    }
    return c;
  }
  return {
    bull: count(pivots(lows, w, true), lows, true),
    bear: count(pivots(highs, w, false), highs, false),
  };
}

// 型態偵測（不畫結構，只量「漲了多少、離高點多遠、箱子多窄、有沒有帶量突破」）
// bars: [{h, l, c, v, d}]，d = 該根 K 棒主動買入 − 主動賣出（台股沒有就省略）
// box: 用最近幾根（不含最後 2 根）當整理箱；runWin: 往回找大漲 / 大跌的範圍
export function pattern(bars, { box = 42, runWin = 150, boxMax = 15 } = {}) {
  const n = bars.length;
  if (n < box + 5) return null;
  const last = bars[n - 1];
  const start = Math.max(0, n - runWin);

  // 大漲：區間最高點，以及它之前的最低點
  let hiIdx = start;
  for (let i = start; i < n; i++) if (bars[i].h >= bars[hiIdx].h) hiIdx = i;
  let loBefore = start;
  for (let i = start; i <= hiIdx; i++) if (bars[i].l <= bars[loBefore].l) loBefore = i;
  const rise = (bars[hiIdx].h / bars[loBefore].l - 1) * 100;
  const dd = (1 - last.c / bars[hiIdx].h) * 100; // 離高點跌了幾 %

  // 大跌：區間最低點，以及它之前的最高點
  let loIdx = start;
  for (let i = start; i < n; i++) if (bars[i].l <= bars[loIdx].l) loIdx = i;
  let hiBefore = start;
  for (let i = start; i <= loIdx; i++) if (bars[i].h >= bars[hiBefore].h) hiBefore = i;
  const drop = (1 - bars[loIdx].l / bars[hiBefore].h) * 100;
  const bounce = (last.c / bars[loIdx].l - 1) * 100; // 離低點彈了幾 %

  // 整理箱：最後 2 根之前的 box 根 K 棒
  const bx = bars.slice(n - 2 - box, n - 2);
  const boxHi = Math.max(...bx.map((b) => b.h));
  const boxLo = Math.min(...bx.map((b) => b.l));
  const avgV = bx.reduce((a, b) => a + (b.v || 0), 0) / bx.length;
  const lastV = Math.max(bars[n - 1].v || 0, bars[n - 2].v || 0);
  const range = (boxHi / boxLo - 1) * 100;

  // CVD 背離：最近 6 根創新高（低），CVD 卻沒有跟著創新高（低）
  let cvdBearDiv = false, cvdBullDiv = false, boxCvd = null;
  if (bars.every((b) => b.d != null)) {
    let cum = 0;
    const cvd = bars.map((b) => (cum += b.d));
    const recent = [n - 6, n], prior = [Math.max(0, n - 36), n - 6];
    const argBy = ([a, b], f, better) => { let k = a; for (let i = a; i < b; i++) if (better(f(i), f(k))) k = i; return k; };
    const rH = argBy(recent, (i) => bars[i].h, (x, y) => x >= y), pH = argBy(prior, (i) => bars[i].h, (x, y) => x >= y);
    const rL = argBy(recent, (i) => bars[i].l, (x, y) => x <= y), pL = argBy(prior, (i) => bars[i].l, (x, y) => x <= y);
    cvdBearDiv = bars[rH].h >= bars[pH].h && cvd[rH] < cvd[pH];
    cvdBullDiv = bars[rL].l <= bars[pL].l && cvd[rL] > cvd[pL];
    boxCvd = bx.reduce((a, b) => a + b.d, 0);
  }

  return {
    rise, dd, hiAgo: n - 1 - hiIdx,
    drop, bounce, loAgo: n - 1 - loIdx,
    boxRange: range, boxHi, boxLo,
    breakUp: range <= boxMax && last.c > boxHi,
    breakDown: range <= boxMax && last.c < boxLo,
    volRatio: avgV ? lastV / avgV : null,
    cvdBearDiv, cvdBullDiv, boxCvd,
  };
}

// 4H 箱體（區間交易用）：找出最近一段振幅 ≤ max% 的整理區，算現價在箱子的哪個位置
// 從 7 天（42 根）往下試到 2 天（12 根），取最長、還在 max% 以內的那段，箱子越久越可靠
// 不含最新一根（最新那根用來判斷現在的位置）
export function rangeBox(bars, { max = 7, minLen = 12, maxLen = 42, band = 0.2 } = {}) {
  const n = bars.length;
  if (n < minLen + 2) return null;
  const last = bars[n - 1];
  for (let len = Math.min(maxLen, n - 2); len >= minLen; len -= 6) {
    const bx = bars.slice(n - 1 - len, n - 1);
    const hi = Math.max(...bx.map((b) => b.h));
    const lo = Math.min(...bx.map((b) => b.l));
    const range = (hi / lo - 1) * 100;
    if (range > max) continue;
    const span = hi - lo;
    // 箱子要「有底有頂」：底部區和頂部區各被碰過至少 2 次
    const touchLo = bx.filter((b) => b.l <= lo + span * band).length;
    const touchHi = bx.filter((b) => b.h >= hi - span * band).length;
    if (touchLo < 2 || touchHi < 2) continue;
    return {
      len, hours: len * 4, hi, lo, range,
      pos: span ? (last.c - lo) / span : 0.5, // 0 = 箱底，1 = 箱頂
      broke: last.c < lo * 0.995 ? 'down' : last.c > hi * 1.005 ? 'up' : null,
      touchLo, touchHi,
    };
  }
  return null;
}
