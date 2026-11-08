// 圖表資料（瀏覽器用）：優先抓幣安合約（和 Coinglass 同來源），幣安連不上就改抓 OKX；爆倉只有 OKX。
// 每個序列都標來源；抓不到的序列留空並寫進 notes，不用別的資料假裝。
export const TF = {
  '5m':  { bin: '5m',  okx: '5m',  okxr: '5m', ms: 300000 },
  '15m': { bin: '15m', okx: '15m', okxr: '5m', ms: 900000 },
  '1h':  { bin: '1h',  okx: '1H',  okxr: '1H', ms: 3600000 },
  '4h':  { bin: '4h',  okx: '4H',  okxr: '1H', ms: 14400000 },
};
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
async function jget(url, ms = 9000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const okxOk = (j) => { if (!j || String(j.code) !== '0' || !Array.isArray(j.data)) throw new Error('OKX 回應異常'); return j.data; };

// ---------- 幣安 ----------
export function parseBinance(k, oi, top, glob, fund) {
  const candles = k.map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })).filter((c) => Number.isFinite(c.c));
  const cvd = k.map((r) => ({ t: +r[0], v: 2 * +r[9] - +r[5] })); // 主動買量 − 主動賣量（幣數）
  const ser = (a, f) => (a || []).map((x) => ({ t: +x.timestamp, v: num(f(x)) })).filter((x) => x.v != null);
  return {
    candles, cvd,
    oi: ser(oi, (x) => x.sumOpenInterest), top: ser(top, (x) => x.longShortRatio), glob: ser(glob, (x) => x.longShortRatio),
    fund: (fund || []).map((x) => ({ t: +x.fundingTime, v: num(x.fundingRate) * 100 })).filter((x) => x.v != null),
  };
}
async function fromBinance(sym, tf, n) {
  const B = 'https://fapi.binance.com', p = TF[tf].bin, q = `symbol=${sym}&period=${p}&limit=${n}`;
  const soft = (u) => jget(u).catch(() => null);
  const [k, oi, top, glob, fund] = await Promise.all([
    jget(`${B}/fapi/v1/klines?symbol=${sym}&interval=${p}&limit=${n}`),
    soft(`${B}/futures/data/openInterestHist?${q}`), soft(`${B}/futures/data/topLongShortPositionRatio?${q}`),
    soft(`${B}/futures/data/globalLongShortAccountRatio?${q}`), soft(`${B}/fapi/v1/fundingRate?symbol=${sym}&limit=100`),
  ]);
  if (!Array.isArray(k) || !k.length) throw new Error('幣安沒有 K 線');
  const d = parseBinance(k, oi, top, glob, fund), notes = [];
  if (!oi) notes.push('持倉：幣安沒回應'); if (!top) notes.push('大戶多空比：幣安沒回應'); if (!glob) notes.push('散戶多空比：幣安沒回應'); if (!fund) notes.push('資金費率：幣安沒回應');
  const s = { price: '幣安', oi: '幣安', top: '幣安', glob: '幣安', fund: '幣安', cvd: '幣安' };
  return { ...d, srcs: s, notes, src: '幣安合約' };
}

// ---------- OKX ----------
// OKX 統計類 API 限流（每 2 秒 5 次）：呼叫排隊、每次間隔 450ms，失敗等 1.2 秒重試一次
function throttled(proxy) {
  let chain = Promise.resolve();
  const call = (path) => new Promise((ok, no) => {
    chain = chain.then(async () => {
      let err = null;
      for (let i = 0; i < 4; i++) { // 失敗（多半是限流）等 1.2、2.4、3.6 秒再試
        try { ok(okxOk(await proxy(path))); err = null; break; } catch (e) { err = e; await new Promise((r) => setTimeout(r, 1200 * (i + 1))); }
      }
      if (err) no(err);
      await new Promise((r) => setTimeout(r, 600));
    });
  });
  return call;
}
async function paged(call, base, pages) { // rubik 類 API 每次最多 100 筆，用 end 往前翻頁；回傳由舊到新
  let end = null, rows = [];
  for (let i = 0; i < pages; i++) {
    const d = await call(base + (end ? `&end=${end}` : ''));
    if (!d.length) break;
    rows = rows.concat(d); end = d[d.length - 1][0];
    if (d.length < 100) break;
  }
  const seen = new Set();
  return rows.filter((r) => (seen.has(r[0]) ? false : seen.add(r[0]))).sort((a, b) => +a[0] - +b[0]);
}
async function fromOkx(inst, tf, n, proxy) {
  const X = 'https://www.okx.com/api/v5', t = TF[tf], ccy = inst.split('-')[0], notes = [];
  const c = okxOk(await jget(`${X}/market/candles?instId=${inst}&bar=${t.okx}&limit=${Math.min(n, 300)}`));
  const candles = c.slice().reverse().map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] }));
  const per = t.okxr, pages = per === '5m' ? 3 : 2, call = throttled(proxy);
  const soft = async (name, f) => { try { return await f(); } catch (e) { notes.push(`${name}：抓不到（${e.message}）`); return []; } };
  const [oi, top, glob, tk, fund] = await Promise.all([
    soft('持倉', async () => (await paged(call, `/api/v5/rubik/stat/contracts/open-interest-history?instId=${inst}&period=${per}&limit=100`, pages)).map((r) => ({ t: +r[0], v: num(r[2]) }))),
    soft('大戶多空比', async () => (await paged(call, `/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader?instId=${inst}&period=${per}&limit=100`, pages)).map((r) => ({ t: +r[0], v: num(r[1]) }))),
    soft('散戶多空比', async () => (await paged(call, `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=${per}&limit=100`, pages)).map((r) => ({ t: +r[0], v: num(r[1]) }))),
    soft('主動買賣量', async () => (await paged(call, `/api/v5/rubik/stat/taker-volume?ccy=${ccy}&instType=CONTRACTS&period=${per}&limit=100`, pages)).map((r) => ({ t: +r[0], v: num(r[2]) - num(r[1]) }))),
    soft('資金費率', async () => okxOk(await jget(`${X}/public/funding-rate-history?instId=${inst}&limit=100`)).map((r) => ({ t: +r[0] || +r.fundingTime, v: num(r.fundingRate) * 100 })).sort((a, b) => a.t - b.t)),
  ]);
  const clean = (a) => a.filter((x) => x.v != null && Number.isFinite(x.t));
  // 備援時持倉等歷史比 K 線短：只畫有資料的範圍，不留一大塊空白
  const oiC = clean(oi), start = oiC.length ? oiC[0].t - t.ms : 0, cv = candles.filter((c) => c.t >= start);
  const s = { price: 'OKX', oi: 'OKX', top: 'OKX 大戶', glob: 'OKX', fund: 'OKX', cvd: 'OKX（單位交易所未標示，只看正負與相對大小）' };
  return { candles: cv.length >= 20 ? cv : candles, oi: clean(oi), top: clean(top), glob: clean(glob), cvd: clean(tk), fund: clean(fund), srcs: s, notes, src: 'OKX（幣安連不上）' };
}

// ---------- 爆倉（OKX 最近 ≤100 筆）----------
export async function loadLiq(inst, ms) {
  const X = 'https://www.okx.com/api/v5';
  const [ins, liq] = await Promise.all([jget(`${X}/public/instruments?instType=SWAP&instId=${inst}`), jget(`${X}/public/liquidation-orders?instType=SWAP&state=filled&uly=${inst.replace('-SWAP', '')}`)]);
  const i0 = okxOk(ins)[0], ct = num(i0?.ctVal) * (num(i0?.ctMult) || 1);
  if (!(ct > 0)) throw new Error('查不到合約面值');
  const det = okxOk(liq).flatMap((x) => x.details || []), bins = new Map();
  let t0 = Infinity;
  for (const d of det) {
    const ts = +d.ts, usd = num(d.sz) * ct * num(d.bkPx); if (!(usd > 0)) continue;
    t0 = Math.min(t0, ts); const k = Math.floor(ts / ms) * ms, b = bins.get(k) || { t: k, long: 0, short: 0 };
    if (d.posSide === 'long') b.long += usd; else b.short += usd; bins.set(k, b);
  }
  return { bins: [...bins.values()].sort((a, b) => a.t - b.t), from: Number.isFinite(t0) ? t0 : null, n: det.length };
}

// ---------- 對外 ----------
export async function loadChart({ sym, inst, tf = '15m', proxy, n = 200 }) {
  let d = null, err = null;
  if (sym) { try { d = await fromBinance(sym, tf, n); } catch (e) { err = e; } }
  if (!d && inst) { try { d = await fromOkx(inst, tf, n, proxy); if (err) d.notes.unshift(`幣安連不上（${err.message}），改用 OKX`); } catch (e) { err = e; } }
  if (!d) throw new Error(err ? err.message : '沒有可用的資料來源');
  d.liq = null;
  if (inst) { try { d.liq = await loadLiq(inst, TF[tf].ms); } catch (e) { d.notes.push(`爆倉：抓不到（${e.message}）`); } }
  else d.notes.push('爆倉：OKX 沒有這個幣');
  d.tf = tf; d.ms = TF[tf].ms;
  return d;
}
