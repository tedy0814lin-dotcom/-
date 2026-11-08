// 多交易所合約資料（伺服器與瀏覽器共用）
// 每家只用「一次拿全部幣」的公開 API，抓持倉量（換成美元）與資金費率（換成每 8 小時）。
// 另外對 Bybit、OKX 抓每幣的持倉歷史，跟幣安一起算「三大所持倉 24h 變化」；Bybit 再抓散戶多空比。
// 任何一家失敗都不影響其他家，status 會寫哪家成功、哪家失敗。

// 把各家代號統一成同一個幣名：1000PEPE → PEPE、XBT → BTC、kPEPE → PEPE
export function normBase(raw) {
  let b = String(raw || '').trim();
  if (/^k[A-Z]{2,}$/.test(b)) b = b.slice(1); // Hyperliquid 的 kPEPE = 1000 PEPE
  b = b.toUpperCase().replace(/^(1000000|100000|10000|1000|1M)(?=[A-Z]{2,})/, '');
  if (b === 'XBT') b = 'BTC';
  return b;
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// 每家：回傳 { BASE: { oiUsd, funding（每 8 小時 %）, sym（該所自己的代號） } }
const FETCHERS = {
  Bybit: async ({ getJSON }) => {
    const j = await getJSON('https://api.bybit.com/v5/market/tickers?category=linear');
    const out = {};
    for (const t of j.result?.list || []) {
      if (!t.symbol.endsWith('USDT')) continue;
      out[normBase(t.symbol.slice(0, -4))] = { oiUsd: n(t.openInterestValue), funding: n(t.fundingRate) * 100, sym: t.symbol };
    }
    return out;
  },
  OKX: async ({ getJSON }) => {
    const j = await getJSON('https://www.okx.com/api/v5/public/open-interest?instType=SWAP');
    const out = {};
    for (const t of j.data || []) {
      if (!t.instId.endsWith('-USDT-SWAP')) continue;
      out[normBase(t.instId.split('-')[0])] = { oiUsd: n(t.oiUsd), funding: null, sym: t.instId };
    }
    return out;
  },
  Bitget: async ({ getJSON }) => {
    const j = await getJSON('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
    const out = {};
    for (const t of j.data || []) {
      if (!t.symbol.endsWith('USDT')) continue;
      const px = n(t.lastPr ?? t.markPrice);
      out[normBase(t.symbol.slice(0, -4))] = { oiUsd: n(t.holdingAmount) * px, funding: n(t.fundingRate) * 100, sym: t.symbol };
    }
    return out;
  },
  Gate: async ({ getJSON }) => {
    const arr = await getJSON('https://api.gateio.ws/api/v4/futures/usdt/contracts');
    const out = {};
    for (const t of arr || []) {
      if (!String(t.name).endsWith('_USDT')) continue;
      const interval = n(t.funding_interval) || 28800;
      out[normBase(t.name.split('_')[0])] = {
        oiUsd: n(t.position_size) * n(t.quanto_multiplier) * n(t.mark_price),
        funding: n(t.funding_rate) * 100 * (28800 / interval),
        sym: t.name,
      };
    }
    return out;
  },
  MEXC: async ({ getJSON }) => {
    const [tk, dt] = await Promise.all([
      getJSON('https://contract.mexc.com/api/v1/contract/ticker'),
      getJSON('https://contract.mexc.com/api/v1/contract/detail'),
    ]);
    const size = new Map((dt.data || []).map((d) => [d.symbol, n(d.contractSize)]));
    const out = {};
    for (const t of tk.data || []) {
      if (!String(t.symbol).endsWith('_USDT')) continue;
      out[normBase(t.symbol.split('_')[0])] = {
        oiUsd: n(t.holdVol) * (size.get(t.symbol) || 0) * n(t.lastPrice),
        funding: n(t.fundingRate) * 100,
        sym: t.symbol,
      };
    }
    return out;
  },
  KuCoin: async ({ getJSON }) => {
    const j = await getJSON('https://api-futures.kucoin.com/api/v1/contracts/active');
    const out = {};
    for (const t of j.data || []) {
      if (t.quoteCurrency !== 'USDT' || !String(t.symbol).endsWith('USDTM')) continue;
      const gran = n(t.fundingRateGranularity) || 28800000;
      out[normBase(t.baseCurrency)] = {
        oiUsd: n(t.openInterest) * n(t.multiplier) * n(t.markPrice),
        funding: n(t.fundingFeeRate) * 100 * (28800000 / gran),
        sym: t.symbol,
      };
    }
    return out;
  },
  HTX: async ({ getJSON }) => {
    const [oi, fr] = await Promise.all([
      getJSON('https://api.hbdm.com/linear-swap-api/v1/swap_open_interest?business_type=swap'),
      getJSON('https://api.hbdm.com/linear-swap-api/v1/swap_batch_funding_rate').catch(() => ({ data: [] })),
    ]);
    const f = new Map((fr.data || []).map((d) => [d.contract_code, n(d.funding_rate) * 100]));
    const out = {};
    for (const t of oi.data || []) {
      if (!String(t.contract_code).endsWith('-USDT')) continue;
      out[normBase(t.contract_code.split('-')[0])] = { oiUsd: n(t.value), funding: f.get(t.contract_code) ?? null, sym: t.contract_code };
    }
    return out;
  },
  BingX: async ({ getJSON }) => {
    const j = await getJSON('https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex');
    const out = {};
    for (const t of j.data || []) {
      if (!String(t.symbol).endsWith('-USDT')) continue;
      out[normBase(t.symbol.split('-')[0])] = { oiUsd: null, funding: n(t.lastFundingRate) * 100, sym: t.symbol, px: n(t.markPrice) };
    }
    return out;
  },
  Hyperliquid: async ({ postJSON }) => {
    const [meta, ctxs] = await postJSON('https://api.hyperliquid.xyz/info', { type: 'metaAndAssetCtxs' });
    const out = {};
    (meta.universe || []).forEach((u, i) => {
      const c = ctxs[i];
      if (!c || u.isDelisted) return;
      out[normBase(u.name)] = { oiUsd: n(c.openInterest) * n(c.markPx), funding: n(c.funding) * 100 * 8, sym: u.name };
    });
    return out;
  },
};

export const EXCHANGES = ['Binance', ...Object.keys(FETCHERS)];


// ---------- 爆倉（OKX）與訂單簿（BingX，失敗改 OKX）----------
// 爆倉：OKX 公開的「最近已成交爆倉單」，一次最多 100 筆，時間窗隨幣種熱度不同（實測 6～19 小時）；數量換成美元 = 張數 × 面值 × 爆倉價
export function liqStats(details, ct, now = Date.now()) {
  const rows = (details || []).map((d) => ({ ts: n(d.ts), usd: n(d.sz) * ct * n(d.bkPx), long: d.posSide === 'long' })).filter((x) => x.ts && x.usd > 0);
  if (!rows.length) return { n: 0, hrs: null, longUsd: 0, shortUsd: 0, long1h: 0, short1h: 0, full: (details || []).length >= 100 };
  const t0 = Math.min(...rows.map((x) => x.ts)), sum = (f) => rows.filter(f).reduce((a, x) => a + x.usd, 0);
  return {
    n: rows.length, hrs: (now - t0) / 3600e3, full: (details || []).length >= 100, // full=true：已滿 100 筆，更早的被截掉，窗口代表「最近 hrs 小時」
    longUsd: sum((x) => x.long), shortUsd: sum((x) => !x.long),
    long1h: sum((x) => x.long && now - x.ts <= 3600e3), short1h: sum((x) => !x.long && now - x.ts <= 3600e3),
  };
}
// 訂單簿：bids/asks = [[價, 量(幣數)], ...]（買由高到低、賣由低到高）。算現價上下各 0.5/1/2/5% 內的掛單金額，以及單一價位最大掛單（牆）
export function depthStats(bids = [], asks = [], mult = 1) {
  const B = bids.map(([p, q]) => [n(p), n(q) * mult]).filter((x) => x[0] > 0 && x[1] >= 0), A = asks.map(([p, q]) => [n(p), n(q) * mult]).filter((x) => x[0] > 0 && x[1] >= 0);
  if (!B.length || !A.length) return null;
  const mid = (B[0][0] + A[0][0]) / 2;
  const cover = Math.min((mid - B[B.length - 1][0]) / mid, (A[A.length - 1][0] - mid) / mid) * 100; // 買賣兩邊都有資料的範圍（%）
  const bands = [0.5, 1, 2, 5].filter((b) => b <= cover + 1e-9).map((b) => {
    const bid = B.filter((x) => x[0] >= mid * (1 - b / 100)).reduce((a, x) => a + x[0] * x[1], 0);
    const ask = A.filter((x) => x[0] <= mid * (1 + b / 100)).reduce((a, x) => a + x[0] * x[1], 0);
    return { pct: b, bid, ask };
  });
  const lim = Math.max(bands.length ? bands[bands.length - 1].pct : 0.5, 0.5);
  // 牆：把價位按 0.1% 一格加總（逐檔太碎，做市商會拆單）；牆 = 範圍內最大的一格，x = 它是每格平均的幾倍
  const wall = (arr, sign) => {
    const m = new Map();
    for (const [p, q] of arr) { const d = ((p - mid) / mid) * 100; if (Math.abs(d) > lim) continue; const k = Math.floor(d / 0.1); m.set(k, (m.get(k) || 0) + p * q); }
    const v = [...m.entries()]; if (!v.length) return { usd: 0 };
    const med = v.reduce((a, x) => a + x[1], 0) / Math.max(1, Math.round(lim / 0.1)); // 每格平均（範圍內總掛單 ÷ 格數）
    const [k, usd] = v.reduce((bb, x) => (x[1] > bb[1] ? x : bb));
    return { usd, dist: (k + 0.5) * 0.1, x: med > 0 ? usd / med : null };
  };
  return { mid, cover, bands, bidWall: wall(B), askWall: wall(A) };
}

// bases：要的幣（已經 normBase 過），通常是幣安成交額前 50 名
export async function fetchExchanges(bases, { getJSON, postJSON, pool, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const want = new Set(bases);
  const status = {};
  const byBase = {};
  for (const b of bases) byBase[b] = {};

  await Promise.all(Object.entries(FETCHERS).map(async ([ex, fn]) => {
    try {
      const all = await fn({ getJSON, postJSON });
      let hit = 0;
      for (const [b, v] of Object.entries(all)) {
        if (!want.has(b)) continue;
        byBase[b][ex] = v; hit++;
      }
      status[ex] = hit ? `ok:${hit}` : '沒有對到任何幣';
    } catch (e) {
      status[ex] = `失敗：${e.message}`;
    }
  }));

  // 需要逐幣補的資料：OKX 資金費率、BingX 持倉、Bybit / OKX 持倉歷史、Bybit 多空比
  const hist = {};
  const tasks = [];
  // OKX 每張合約面值（換算爆倉單與訂單簿金額用）；抓不到就不抓爆倉／備援訂單簿
  const ctv = {};
  try { const j = await getJSON('https://www.okx.com/api/v5/public/instruments?instType=SWAP'); for (const t of j.data || []) { const v = n(t.ctVal) * (n(t.ctMult) || 1); if (v > 0 && t.ctValCcy && t.instId.endsWith('-USDT-SWAP')) ctv[t.instId] = v; } } catch (e) { status.OKX_面值 = `失敗：${e.message}`; }
  for (const b of bases) {
    const e = byBase[b];
    hist[b] = {};
    if (e.OKX) {
      tasks.push(['okx', async () => {
        const j = await getJSON(`https://www.okx.com/api/v5/public/funding-rate?instId=${e.OKX.sym}`);
        const f = n(j.data?.[0]?.fundingRate);
        if (f != null) e.OKX.funding = f * 100;
      }]);
      tasks.push(['okxr', async () => {
        const j = await getJSON(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${e.OKX.sym}&period=1H&limit=25`);
        const rows = (j.data || []).map((r) => n(r[3] ?? r[1])); // 新 → 舊
        if (rows.length >= 5) hist[b].OKX = { chg24: (rows[0] / rows[rows.length - 1] - 1) * 100, chg4: (rows[0] / rows[4] - 1) * 100 };
      }]);
      // 主動買賣量（taker volume）：OKX 每小時 [時間, 主動賣, 主動買]，新 → 舊。算 24h／4h 淨買比例（單位在分子分母抵銷）
      tasks.push(['okxr', async () => {
        const j = await getJSON(`https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=${e.OKX.sym.split('-')[0]}&instType=CONTRACTS&period=1H`);
        const rows = (j.data || []).slice(0, 24).map((r) => [n(r[1]), n(r[2])]).filter((x) => x[0] != null && x[1] != null);
        if (rows.length >= 20) {
          const ratio = (a) => { const s = a.reduce((t, x) => t + x[0], 0), b = a.reduce((t, x) => t + x[1], 0); return s + b > 0 ? ((b - s) / (b + s)) * 100 : null; };
          hist[b].okxCvd = { r24: ratio(rows), r4: ratio(rows.slice(0, 4)), hrs: rows.length };
        }
      }]);
      // 現貨主動買賣量（現貨 CVD）與大戶持倉多空比（OKX 的 top trader）
      tasks.push(['okxr', async () => {
        const j = await getJSON(`https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=${e.OKX.sym.split('-')[0]}&instType=SPOT&period=1H`);
        const rows = (j.data || []).slice(0, 4).map((r) => [n(r[1]), n(r[2])]).filter((x) => x[0] != null && x[1] != null);
        if (rows.length >= 4) { const sv = rows.reduce((t, x) => t + x[0], 0), bv = rows.reduce((t, x) => t + x[1], 0); if (sv + bv > 0) hist[b].okxSpot = { r4: ((bv - sv) / (bv + sv)) * 100 }; }
      }]);
      tasks.push(['okxr', async () => {
        const j = await getJSON(`https://www.okx.com/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader?instId=${e.OKX.sym}&period=1H&limit=25`);
        const rows = (j.data || []).map((r) => n(r[1])).filter((x) => x != null); // 新 → 舊
        if (rows.length >= 20) hist[b].okxTop = { now: rows[0], chg: rows[0] - rows[rows.length - 1] };
      }]);
      if (ctv[e.OKX.sym]) {
        tasks.push(['okx', async () => {
          const j = await getJSON(`https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&state=filled&uly=${e.OKX.sym.replace('-SWAP', '')}`);
          const det = (j.data || []).flatMap((x) => x.details || []);
          hist[b].liq = liqStats(det, ctv[e.OKX.sym]);
        }]);
      }
    }
    if (e.Bybit) {
      tasks.push(['bybit', async () => {
        const j = await getJSON(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${e.Bybit.sym}&intervalTime=1h&limit=25`);
        const rows = (j.result?.list || []).map((r) => n(r.openInterest)); // 新 → 舊
        if (rows.length >= 5) hist[b].Bybit = { chg24: (rows[0] / rows[rows.length - 1] - 1) * 100, chg4: (rows[0] / rows[4] - 1) * 100 };
      }]);
      tasks.push(['bybit', async () => {
        const j = await getJSON(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${e.Bybit.sym}&period=1h&limit=25`);
        const rows = (j.result?.list || []).map((r) => n(r.buyRatio) / n(r.sellRatio)); // 新 → 舊
        if (rows.length >= 2) hist[b].BybitLS = { now: rows[0], chg: rows[0] - rows[rows.length - 1] };
      }]);
    }
    if (e.BingX) {
      tasks.push(['bingx', async () => {
        const j = await getJSON(`https://open-api.bingx.com/openApi/swap/v2/quote/openInterest?symbol=${e.BingX.sym}`);
        const v = n(j.data?.openInterest);
        if (v != null) e.BingX.oiUsd = v;
      }]);
    }
    if (e.BingX || (e.OKX && ctv[e.OKX.sym])) {
      // 訂單簿：先 BingX（最多 1000 檔），失敗或空 → 改 OKX（400 檔）；都失敗就不寫，畫面顯示「抓不到」
      tasks.push(['bingx', async () => {
        let d = null, src = null;
        if (e.BingX) { try { const j = await getJSON(`https://open-api.bingx.com/openApi/swap/v2/quote/depth?symbol=${e.BingX.sym}&limit=1000`); d = depthStats(j.data?.bids || [], j.data?.asks || []); src = 'BingX'; } catch {} }
        if (!d && e.OKX && ctv[e.OKX.sym]) { try { const j = await getJSON(`https://www.okx.com/api/v5/market/books?instId=${e.OKX.sym}&sz=400`); const k = j.data?.[0]; d = k ? depthStats(k.bids || [], k.asks || [], ctv[e.OKX.sym]) : null; src = 'OKX'; } catch {} }
        if (d) hist[b].depth = { ...d, src };
      }]);
    }
  }
  // OKX 限流：rubik 統計類 API 每 2 秒 5 次 → 每 420ms 一個，失敗等 1.2 秒重試一次；其他 OKX API 每 150ms 一個；其他家可以同時跑
  const lane = (k) => tasks.filter((t) => t[0] === k).map((t) => t[1]);
  const rest = tasks.filter((t) => t[0] !== 'okx' && t[0] !== 'okxr').map((t) => t[1]);
  const safe = (f) => f().catch(() => {});
  const retry = async (f) => { try { await f(); } catch { await sleep(1200); await safe(f); } };
  await Promise.all([
    (async () => { for (const f of lane('okx')) { await safe(f); await sleep(150); } })(),
    (async () => { for (const f of lane('okxr')) { await retry(f); await sleep(420); } })(),
    pool(rest, 6, safe),
  ]);
  return { updatedAt: Date.now(), status, byBase, hist };
}

// 把多交易所資料合進一列幣安資料，重算「全市場持倉」「加權資金費率」「三大所持倉變化」
export function mergeExchanges(r, x) {
  if (!x) return r;
  const b = normBase(r.base);
  const e = x.byBase?.[b];
  const h = x.hist?.[b] || {};
  r.liq = h.liq || null; r.depth = h.depth || null; r.okxCvd = h.okxCvd || null; r.okxSpot = h.okxSpot || null; r.okxTop = h.okxTop || null;
  if (!e) return r;
  if (r.oiBn === undefined) { r.oiBn = r.oi; r.oiChg24Bn = r.oiChg24; r.oiChg4Bn = r.oiChg4; r.fundingBn = r.funding; r.globalLSChgBn = r.globalLSChg; }
  // 主資料來源是 BingX（沒有幣安籌碼）時，不放「Binance」這一列：BingX 的持倉與資金費率由 byBase.BingX 提供，避免重複計算、也避免標錯交易所
  const list = r.chipSrc === 'binance' ? [{ ex: 'Binance', oiUsd: r.oiBn, funding: r.fundingBn }] : [];
  for (const [ex, v] of Object.entries(e)) list.push({ ex, oiUsd: v.oiUsd, funding: v.funding });
  const withOi = list.filter((v) => v.oiUsd > 0);
  const total = withOi.reduce((a, v) => a + v.oiUsd, 0);
  r.exList = list
    .map((v) => ({ ...v, share: v.oiUsd > 0 && total ? (v.oiUsd / total) * 100 : null }))
    .sort((p, q) => (q.oiUsd || 0) - (p.oiUsd || 0));
  r.exCount = list.length;
  r.oiAll = total || r.oiBn;
  // 資金費率：用持倉加權平均
  const wf = list.filter((v) => v.funding != null && v.oiUsd > 0);
  const wsum = wf.reduce((a, v) => a + v.oiUsd, 0);
  r.fundingAll = wsum ? wf.reduce((a, v) => a + v.funding * v.oiUsd, 0) / wsum : r.fundingBn;
  const fs = list.filter((v) => v.funding != null);
  r.fundingMax = fs.reduce((m, v) => (!m || v.funding > m.funding ? v : m), null);
  r.fundingMin = fs.reduce((m, v) => (!m || v.funding < m.funding ? v : m), null);
  // 三大所（幣安＋Bybit＋OKX）持倉變化，用美元加權
  const parts = r.chipSrc === 'binance' ? [{ now: r.oiBn, chg24: r.oiChg24Bn, chg4: r.oiChg4Bn }] : [];
  if (h.Bybit && e.Bybit?.oiUsd) parts.push({ now: e.Bybit.oiUsd, ...h.Bybit });
  if (h.OKX && e.OKX?.oiUsd) parts.push({ now: e.OKX.oiUsd, ...h.OKX });
  const comb = (k) => {
    const ok = parts.filter((p) => p.now > 0 && p[k] != null);
    const now = ok.reduce((a, p) => a + p.now, 0);
    const before = ok.reduce((a, p) => a + p.now / (1 + p[k] / 100), 0);
    return before ? (now / before - 1) * 100 : null;
  };
  r.oiSources = parts.length;
  r.oiChg24 = comb('chg24') ?? r.oiChg24Bn;
  r.oiChg4 = comb('chg4') ?? r.oiChg4Bn;
  r.funding = r.fundingAll ?? r.fundingBn;
  if (h.BybitLS) { r.bybitLS = h.BybitLS.now; r.globalLSChg = (r.globalLSChgBn + h.BybitLS.chg) / 2; }
  return r;
}
