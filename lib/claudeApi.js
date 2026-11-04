// GET /api/twhist?cs=1（併在 twhist 裡，免費方案最多 12 個函式）
// Claude 自創策略「大陽線突破新高＋大盤濾網＋寬追蹤停損」：掃幣安 USDT 永續日 K，列出今天新訊號、依規則推算仍持有的部位、最近出場。
import { getJSON, pool } from '../api/_lib.js';
import { csScan, CS_P } from './claudeStrat.js';

const FAPI = 'https://fapi.binance.com';
let cache = null; // { t, out }
const kl = async (s) => {
  const k = await getJSON(`${FAPI}/fapi/v1/klines?symbol=${s}&interval=1d&limit=499`, { timeout: 12000, retries: 1 });
  return k.filter((x) => x[6] <= Date.now()).map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], q: +x[7] }));
};
const day = (t) => new Date(t).toISOString().slice(0, 10);

export async function claudeScan(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (cache && Date.now() - cache.t < 10 * 60e3 && !req.query.force) return res.status(200).json({ ...cache.out, cached: true });
  const [tk, ex] = await Promise.all([getJSON(`${FAPI}/fapi/v1/ticker/24hr`), getJSON(`${FAPI}/fapi/v1/exchangeInfo`)]);
  const meta = new Map((ex.symbols || []).filter((x) => x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT' && x.status === 'TRADING').map((x) => [x.symbol, x.onboardDate]));
  // 先用 24 小時成交額 ≥1,000 萬美元粗篩（規則本身要求 20 日平均 ≥2,000 萬，這裡只是省請求）
  const syms = tk.filter((t) => meta.has(t.symbol) && +t.quoteVolume >= 10e6).map((t) => t.symbol);
  if (!syms.includes('BTCUSDT')) syms.unshift('BTCUSDT');
  const btc = await kl('BTCUSDT');
  const reg = new Map();
  for (let i = 0; i < btc.length; i++) {
    if (i < 49) { reg.set(btc[i].t, null); continue; }
    let s = 0; for (let k = i - 49; k <= i; k++) s += btc[k].c;
    reg.set(btc[i].t, btc[i].c > s / 50);
  }
  const btcNow = btc[btc.length - 1];
  const fresh = [], open = [], closed = [], miss = [];
  await pool(syms, 10, async (s) => {
    let B;
    try { B = await kl(s); } catch { miss.push(s); return; }
    if (B.length < 80) return;
    const ob = meta.get(s) || 0;
    const { trades } = csScan(B, (i) => reg.get(B[i].t) === true, (i) => (B[i].t - ob) / 864e5 + 1 >= CS_P.age);
    const n = B.length, last = B[n - 1];
    for (const t of trades) {
      const sigBar = B[t.t];
      let vs = 0; for (let k = t.t - 20; k < t.t; k++) vs += B[k].q;
      const base = { sym: s, sigDay: day(sigBar.t), volX: +(sigBar.q / (vs / 20)).toFixed(2), stop0: t.stop0 };
      if (t.pending) { fresh.push({ ...base, close: sigBar.c, riskPct: +((sigBar.c - t.stop0) / sigBar.c * 100).toFixed(2) }); continue; }
      const r = t.entry - t.stop0;
      if (t.exitI < 0) open.push({ ...base, entryDay: day(B[t.t + 1].t), entry: t.entry, stop: t.stop, close: last.c, R: +((last.c - t.entry) / r).toFixed(2), lockR: +((t.stop - t.entry) / r).toFixed(2), days: n - 1 - t.t, bars: B.slice(Math.max(0, t.t - 40)).map((b) => [b.o, b.h, b.l, b.c]), off: Math.max(0, t.t - 40) });
      else if (last.t - B[t.exitI].t <= 30 * 864e5) closed.push({ ...base, entryDay: day(B[t.t + 1].t), entry: t.entry, exitDay: day(B[t.exitI].t), exitPx: t.exitPx, R: +((t.exitPx - t.entry) / r).toFixed(2) });
    }
  });
  fresh.sort((a, b) => b.volX - a.volX); open.sort((a, b) => b.R - a.R); closed.sort((a, b) => (a.exitDay < b.exitDay ? 1 : -1));
  const out = { asOf: day(btcNow.t), btc: { close: btcNow.c, up: reg.get(btcNow.t) }, scanned: syms.length, miss: miss.length, fresh, open, closed, P: CS_P };
  cache = { t: Date.now(), out };
  res.status(200).json(out);
}
