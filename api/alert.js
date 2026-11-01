// 給排程用的警報掃描（不用登入，要帶正確的 x-alert-key）
// GET /api/alert?m=crypto                → 加密前 120 檔裡「非常強」的機會
// GET /api/alert?m=tw&step=pick          → 台股要抓日 K 的股票清單
// GET /api/alert?m=tw&codes=2330,2317    → 這幾檔（最多 8 檔）裡「非常強」的機會
import crypto from 'node:crypto';
import { getJSON, pool } from './_lib.js';
import { buildCrypto, CRYPTO_SIGNALS, cryptoSignals } from '../lib/cryptoCore.js';
import { CATS, classify, STRATS } from '../lib/categories.js';
import { TW_SIGNALS, twPick, applyTwHist, twInRange } from '../lib/twCore.js';
import { twData } from './twstock.js';
import { histData } from './twhist.js';

function authed(req) {
  const want = process.env.ALERT_KEY || '';
  const got = String(req.headers['x-alert-key'] || '');
  if (want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// 只留夠強的（預設只要「非常強」；min=1 連「強」「中」也要，給每日摘要用）
// 整理成要推播的內容；id 用來避免同一個訊號重複通知
const RANK = { 非常強: 3, 強: 2, 中: 1 };
const CAP_R = 4; // 目標最多 4R（太遠的目標拿不到）

// 找出這個訊號實際用的進場計畫（數字），給推播判斷「還來不來得及」
function mainPlan(r, mkt, dir) {
  // 加密：用得分最高的那個策略的計畫（2026-10-29 打分機制）
  const sp = r.plans?.[r.mainKey];
  if (sp) {
    const names = { harmUpVegas: '諧波＋維加斯 4H', harmUp: '諧波 D 點 4H', paiRevD: 'PAI 反轉 日線', paiRev12: 'PAI 反轉 12H', cvdoUp12: 'CVD 震盪 12H', cvdoUp4: 'CVD 震盪 4H', cvdoUp4V: 'CVD 放量上穿 4H', cvdFlip12: 'CVD 轉正爆量 12H', cvdFlip4: 'CVD 轉正爆量 4H', macdTopDiv4C: 'MACD 連續頂背離 4H', macdTopDiv4: 'MACD 頂背離 4H', macdTopDiv12: 'MACD 頂背離 12H', macdTopDiv1D: 'MACD 頂背離 日線', pocBreakD: 'POC 突破 日線', bigBullD: '日線大陽線', pocEngD: '日線 POC 吞噬做空', harmCDLong: '諧波 CD 4H', harmCDShort: '諧波 CD 4H', dBoxLong: '日線大箱', crtLong: 'CRT 30 分', crtShort: 'CRT 30 分',
      twCDVegas: '日線諧波 CD＋維加斯', twHarmDayVegas: '日線諧波＋維加斯', twHarmDay: '日線諧波 D 點', twPai80: '日線 PAI 進入超買', twCvdoUp: '日線 CVD 震盪', twCvdFlip: '日線 CVD 轉正爆量' };
    const hPer = sp.tf === '30m' ? 0.5 : sp.tf === '12H' ? 12 : sp.tf === '1D' ? null : 4;
    return { src: names[r.mainKey] || r.mainKey, tf: sp.tf === '1D' ? '日線' : sp.tf, wait: sp.wait, bars: sp.bars, hours: sp.bars != null && hPer ? Math.round(sp.bars * hPer * 10) / 10 : null, entry: sp.entry, stop: sp.stop, target: sp.target };
  }
  const ob = mkt === 'crypto'
    ? [[r.chochOB1h, 1, '1H'], [r.chochOB, 4, '4H']]
    : [[r.div?.h1?.chochOB, 1, '1H'], [r.div?.chochOB, 24, '日線']];
  const hm = mkt === 'crypto'
    ? [[r.harmCD1h, 1, '1H'], [r.harmCD, 4, '4H']]
    : [[r.div?.h1?.harmCD, 1, '1H'], [r.div?.harmCD, 24, '日線']];
  const cap = (entry, stop, target) => {
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) return null;
    const far = Math.min(Math.abs(target - entry), CAP_R * risk);
    return { entry, stop, target: entry + dir * far, tp1: entry + dir * Math.min(2 * risk, far) };
  };
  for (const [o, h, tf] of ob) {
    if (!o || o.dir !== dir) continue;
    const wait = o.state === 'wait';
    return { src: tf + ' CHoCH 訂單塊', tf, wait, bars: wait ? o.ago : o.fillAgo, hours: (wait ? o.ago : o.fillAgo) * h, ...cap(o.entry, o.stop, o.target) };
  }
  for (const [list, h, tf] of hm) {
    for (const x of list || []) {
      if (x.dir !== dir || !(x.state === 'wait' || x.ago <= 3)) continue;
      const wait = x.state === 'wait';
      return { src: tf + ' 諧波 CD 段', tf, wait, bars: wait ? null : x.ago, hours: wait ? null : x.ago * h, ...cap(x.entry, x.stop, x.target) };
    }
  }
  return null;
}

function pick(rows, dict, mkt, min = 3) {
  const out = [];
  for (const r of rows) {
    classify(r, dict);
    if (mkt === 'tw' && !twInRange(r)) continue; // 台股只推 10～200 元
    if (!(RANK[r.catLevel] >= min)) continue;
    const name = mkt === 'crypto' ? r.base || r.symbol : `${r.code} ${r.name}`;
    const dir = CATS[r.cat].dir;
    out.push({
      id: [mkt, r.symbol || r.code, r.cat, r.chochId || '', r.harmId || ''].join('|'),
      // 防重複用：同一檔、同方向
      key: [mkt, r.symbol || r.code, dir > 0 ? 'L' : 'S'].join('|'),
      dir, plan2: mainPlan(r, mkt, dir),
      mkt, name, cat: CATS[r.cat].label + '・' + r.catScore + ' 分', level: r.catLevel, score: r.catScore,
      price: r.price ?? r.close ?? null,
      why: [...r.catWhy.slice(0, 4), ...(r.chipWhy || []).slice(0, 3).map((x) => '籌碼' + x)],
      choch: (r.chochWhy || []).slice(0, 4),
      // 進場／停損／目標：優先用 CHoCH 的計畫，沒有就用諧波或箱體的
      plan: r.stratWhy?.length ? r.stratWhy.slice(0, 2) : [...(r.chochWhy || []), ...(r.harmWhy || []), ...(r.boxWhy || [])].filter((x) => /^(進場|停損|目標|風報比)/.test(x)).slice(0, 4),
    });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authed(req)) return res.status(401).json({ error: '金鑰不對' });
  const min = req.query.min === '1' ? 1 : req.query.min === '2' ? 2 : 3;
  try {
    // 數據記錄用：所有策略（含不計分的觀察策略）目前成立的進出場計畫
    if (req.query.m === 'log') {
      const d = await buildCrypto(120, { getJSON, pool });
      const items = [];
      for (const r of d.rows) {
        r.signals = cryptoSignals(r);
        const dirOf = (p) => (p.target > p.entry ? 1 : -1);
        const scored = Object.entries(r.plans || {}).filter(([kk, p]) => STRATS.crypto[kk] && Number.isFinite(p.target) && Number.isFinite(p.entry)).map(([kk, p]) => [kk, dirOf(p)]);
        const num = (v) => (Number.isFinite(+v) && v != null ? +(+v).toFixed(4) : null);
        for (const [k, p] of Object.entries(r.plans || {})) {
          if (![p.entry, p.stop, p.target].every(Number.isFinite) || p.entry === p.stop) continue;
          const dir = dirOf(p), np = scored.filter(([kk, dd]) => kk !== k && dd === dir).length; // 同時成立的其他計分策略（同方向）
          items.push({ s: r.symbol, k, tf: p.tf, dir, entry: p.entry, stop: p.stop, target: p.target, wait: !!p.wait, bars: p.bars ?? null, px: r.price, np, tl: num(r.topLS), fu: num(r.funding), o24: num(r.oiChg24), t24: num(r.topLSChg) });
        }
      }
      return res.status(200).json({ at: Date.now(), n: d.rows.length, btc24: d.rows[0]?.btc24 ?? null, btcUp: d.rows[0]?.btcUp ?? null, items });
    }
    // 數據記錄用：這檔從某個時間起的 15 分 K（[時間, 高, 低, 收]），GitHub 主機連不到幣安，所以經過這裡
    if (req.query.m === 'klines') {
      const sym = String(req.query.s || '');
      if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) return res.status(400).json({ error: '代號不對' });
      const from = Math.max(0, Number(req.query.from) || 0);
      const k = await getJSON(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=15m&startTime=${from}&limit=1500`, { timeout: 12000 });
      return res.status(200).json({ k: k.map((x) => [x[0], +x[2], +x[3], +x[4]]).slice(0, -1) }); // 去掉還沒收的最後一根
    }
    if (req.query.m === 'crypto') {
      const d = await buildCrypto(120, { getJSON, pool });
      for (const r of d.rows) r.signals = cryptoSignals(r);
      return res.status(200).json({ items: pick(d.rows, CRYPTO_SIGNALS, 'crypto', min) });
    }
    const d = await twData();
    if (req.query.step === 'pick') return res.status(200).json({ date: d.date, codes: twPick(d.rows) });
    const codes = String(req.query.codes || '').split(',').filter((c) => /^\d{4}$/.test(c)).slice(0, 8);
    const rows = [];
    await Promise.all(codes.map(async (code) => {
      const base = d.rows.find((x) => x.code === code);
      if (!base) return;
      const r = { ...base, signals: [...base.signals] };
      try { applyTwHist(r, await histData(code)); rows.push(r); } catch {}
    }));
    res.status(200).json({ date: d.date, items: pick(rows, TW_SIGNALS, 'tw', min) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
