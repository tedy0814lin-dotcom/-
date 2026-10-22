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
  for (const b of bases) {
    const e = byBase[b];
    hist[b] = {};
    if (e.OKX) {
      tasks.push(['okx', async () => {
        const j = await getJSON(`https://www.okx.com/api/v5/public/funding-rate?instId=${e.OKX.sym}`);
        const f = n(j.data?.[0]?.fundingRate);
        if (f != null) e.OKX.funding = f * 100;
      }]);
      tasks.push(['okx', async () => {
        const j = await getJSON(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${e.OKX.sym}&period=1H&limit=25`);
        const rows = (j.data || []).map((r) => n(r[3] ?? r[1])); // 新 → 舊
        if (rows.length >= 5) hist[b].OKX = { chg24: (rows[0] / rows[rows.length - 1] - 1) * 100, chg4: (rows[0] / rows[4] - 1) * 100 };
      }]);
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
  }
  // OKX 限流比較嚴：OKX 的請求一個一個來，其他家可以同時跑
  const okx = tasks.filter((t) => t[0] === 'okx').map((t) => t[1]);
  const rest = tasks.filter((t) => t[0] !== 'okx').map((t) => t[1]);
  const safe = (f) => f().catch(() => {});
  await Promise.all([
    (async () => { for (const f of okx) { await safe(f); await sleep(220); } })(),
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
  if (!e) return r;
  if (r.oiBn === undefined) { r.oiBn = r.oi; r.oiChg24Bn = r.oiChg24; r.oiChg4Bn = r.oiChg4; r.fundingBn = r.funding; r.globalLSChgBn = r.globalLSChg; }
  const list = [{ ex: 'Binance', oiUsd: r.oiBn, funding: r.fundingBn }];
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
  const parts = [{ now: r.oiBn, chg24: r.oiChg24Bn, chg4: r.oiChg4Bn }];
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
