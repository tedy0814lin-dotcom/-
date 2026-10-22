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
