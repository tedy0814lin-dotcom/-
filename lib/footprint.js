// GET /api/twhist?fp=1（併在 twhist，免費方案最多 12 函式）
// 足跡圖訂單流策略「Delta 階梯」：掃 BingX USDT 永續 4H，連 2 根買盤(賣盤)Delta 強＋價格一階階創高(創低)＝多(空)訊號。
// Delta = 主動買 − 主動賣（BingX 版：用 OHLCV 近似，見 lib/bingx.js）；強度 dnorm = Delta ÷ 近 50 根平均|Delta|。進場＝下一根 4H 開盤、停損＝型態低(高)、4R 出場。
import { getJSON, pool } from '../api/_lib.js';

const FAPI = 'https://fapi.binance.com';
const K = 2, TH = 1.0, RT = 4; // 連 2 根、Delta≥1、4R（2026-11-05 由 3R 改 4R：事件期望做多 +0.20→+0.26R、做空 +0.11→+0.13R，投組全期與合併組合都較好）
let cache = null;
const above = (c) => { let e = c[0]; for (const v of c) e += (2 / 201) * (v - e); return c[c.length - 1] > e; }; // 收盤在 EMA200 上
// 每筆期望 R，索引 = BTC同向×2 + 幣同向：[都逆, 只幣同向, 只BTC同向, 都同向]（做多 n 2963/1591/1690/7971、做空 2413/2133/742/6213）
const SC = { L: [-0.03, -0.12, 0.39, 0.34], S: [-0.05, 0.22, 0.11, 0.14] };
const day = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const kl = async (s) => {
  const k = await getJSON(`${FAPI}/fapi/v1/klines?symbol=${s}&interval=4h&limit=400`, { timeout: 12000, retries: 1 });
  return k.filter((x) => x[6] <= Date.now()).map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], q: +x[7], tb: +x[10] }));
};

function features(B) {
  const n = B.length, delta = B.map((b) => 2 * b.tb - b.q);
  const adm = new Array(n).fill(0), dn = new Array(n).fill(0), atr = new Array(n).fill(0);
  for (let i = 51; i < n; i++) { let s = 0; for (let k = i - 50; k < i; k++) s += Math.abs(delta[k]); adm[i] = s / 50; dn[i] = adm[i] > 0 ? delta[i] / adm[i] : 0; }
  for (let i = 15; i < n; i++) { let s = 0; for (let k = i - 14; k < i; k++) s += Math.max(B[k].h - B[k].l, Math.abs(B[k].h - B[k - 1].c), Math.abs(B[k].l - B[k - 1].c)); atr[i] = s / 14; }
  return { delta, dn, atr };
}

// 回傳最後一根收盤 K 是否完成階梯訊號（多 / 空）
function signalAt(B, F, i) {
  if (!(F.atr[i] > 0) || i < K + 1) return null;
  let okL = true, okS = true;
  for (let k = 0; k < K; k++) {
    const b = B[i - k], pb = B[i - k - 1];
    if (!(F.dn[i - k] >= TH && b.h > pb.h && b.c > b.o)) okL = false;
    if (!(F.dn[i - k] <= -TH && b.l < pb.l && b.c < b.o)) okS = false;
  }
  let lo = B[i].l, hi = B[i].h; for (let k = 1; k < K; k++) { lo = Math.min(lo, B[i - k].l); hi = Math.max(hi, B[i - k].h); }
  const c = B[i].c, buf = 0.1 * F.atr[i];
  if (okL) { const stop = lo - buf; if (c > stop) return { dir: 1, entry: c, stop, target: c + RT * (c - stop), dn: +F.dn[i].toFixed(2) }; }
  if (okS) { const stop = hi + buf; if (c < stop) return { dir: -1, entry: c, stop, target: c - RT * (stop - c), dn: +F.dn[i].toFixed(2) }; }
  return null;
}

export async function footprintScan(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (cache && Date.now() - cache.t < 10 * 60e3 && !req.query.force) return res.status(200).json({ ...cache.out, cached: true });
  const [tk, ex] = await Promise.all([getJSON(`${FAPI}/fapi/v1/ticker/24hr`), getJSON(`${FAPI}/fapi/v1/exchangeInfo`)]);
  const ok = new Set((ex.symbols || []).filter((x) => x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT' && x.status === 'TRADING').map((x) => x.symbol));
  const syms = tk.filter((t) => ok.has(t.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 120).map((t) => t.symbol);
  // 分數（2026-11-26 回測 2018–2026、網站 Delta）：看 BTC 與該幣 4H 收盤是否在 EMA200 同向，給該組合的每筆期望 R。訊號全部照列。
  let btcUp = null;
  try {
    const k = await getJSON(`${FAPI}/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=1000`, { timeout: 12000, retries: 1 });
    btcUp = above(k.filter((x) => x[6] <= Date.now()).map((x) => +x[4]));
  } catch {}
  const long = [], short = [], miss = []; let asOf = 0;
  await pool(syms, 10, async (s) => {
    let B; try { B = await kl(s); } catch { miss.push(s); return; }
    if (B.length < 80) return;
    const F = features(B), n = B.length, i = n - 1;
    asOf = Math.max(asOf, B[i].t);
    const sig = signalAt(B, F, i);
    if (!sig) return;
    const r = Math.abs(sig.entry - sig.stop);
    const row = { sym: s, sigT: B[i].t, atr: +F.atr[i].toPrecision(6), close: sig.entry, stop: sig.stop, target: sig.target, dn: sig.dn, riskPct: +(r / sig.entry * 100).toFixed(2),
      bars: B.slice(Math.max(0, i - 49)).map((b) => [b.o, b.h, b.l, b.c, +(2 * b.tb - b.q).toFixed(0)]) };
    const up = sig.dir > 0, cOk = above(B.map((b) => b.c)) === up, bOk = btcUp === null ? null : btcUp === up;
    Object.assign(row, { bOk, cOk, score: bOk === null ? null : SC[up ? 'L' : 'S'][+bOk * 2 + +cOk] });
    (sig.dir > 0 ? long : short).push(row);
  });
  const by = (a, b) => (b.score ?? -9) - (a.score ?? -9) || Math.abs(b.dn) - Math.abs(a.dn);
  long.sort(by); short.sort(by);
  const out = { asOf: day(asOf), scanned: syms.length, miss: miss.length, long, short, btcUp, P: { K, TH, RT } };
  cache = { t: Date.now(), out };
  res.status(200).json(out);
}
