// 加密貨幣籌碼計算（伺服器和瀏覽器共用同一份）
// 資料來源：幣安 USDⓈ-M 永續合約公開 API，不需要 API key。
import { divergence, pattern } from './indicators.js';
import { structure, STRUCT_CRYPTO } from './structure.js';

export const BINANCE = 'https://fapi.binance.com';

// 訊號代號 → 中文名稱與方向（給畫面用）
export const CRYPTO_SIGNALS = {
  dBoxLong:   { label: '日線大箱底做多', dir: 1, alert: true },
  dBoxShort:  { label: '日線大箱頂做空', dir: -1, alert: true },
  boxLong:    { label: '4H 箱底做多', dir: 1, alert: true },
  boxShort:   { label: '4H 箱頂做空', dir: -1, alert: true },
  hiBoxBreak: { label: '高位小箱跌破', dir: -1, alert: true },
  loBoxBreak: { label: '低位小箱突破', dir: 1, alert: true },
  pullLong:   { label: '多頭回踩箱體反彈', dir: 1, alert: true },
  pullShort:  { label: '空頭反彈箱體遇壓', dir: -1, alert: true },
  retestLong: { label: '箱體突破回踩', dir: 1, alert: true },
  retestShort:{ label: '箱體跌破回抽', dir: -1, alert: true },
  revRetestLong: { label: '空頭小箱突破回踩・反轉', dir: 1, alert: true },
  revRetestShort:{ label: '多頭小箱跌破回抽・反轉', dir: -1, alert: true },
  boxLongPlus:{ label: '多重籌碼確認', dir: 1, alert: true },
  boxShortPlus:{ label: '多重籌碼確認', dir: -1, alert: true },
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

// 箱體結構訊號（多週期）：
//   A. 日線大箱來回：大箱底做多、大箱頂做空
//   B. 4H 小箱來回：只做順著日線的方向（日線空頭不在 4H 箱底接多，日線多頭不在 4H 箱頂放空）
//   C. 高位小箱跌破 → 可能開始下跌趨勢；低位小箱突破 → 可能開始上漲趨勢
//   D. 日線多頭結構沒壞，回檔剛好踩到前一個 4H 箱反彈 → 可能是新一段上漲（空頭反過來）
// 每個情境都要有資金流證據（真的有人在買 / 賣），4 項以上確認再加「多重籌碼確認」
export function confirmCrypto(r, dir) {
  const flow = [], ctx = [], f = r.funding;
  if (dir > 0) {
    if (r.cvd4 > 0) flow.push('主動買盤進場');
    if (r.pat?.cvdBullDiv) flow.push('價格破低 CVD 沒破');
    if (r.oiChg4 > 0 && r.cvd4 > 0) flow.push('新多單進場');
    if (f != null && f < 0) ctx.push('資金費率為負');
    if (r.topLSChg > 0) ctx.push('大戶加多');
    if (r.globalLSChg < 0) ctx.push('散戶轉空');
  } else {
    if (r.cvd4 < 0) flow.push('主動賣壓出現');
    if (r.pat?.cvdBearDiv) flow.push('價格創高 CVD 沒跟上');
    if (r.oiChg4 > 0 && r.cvd4 < 0) flow.push('新空單進場');
    if (f != null && f >= 0.02) ctx.push('多單擁擠');
    if (r.topLSChg < 0) ctx.push('大戶減多');
    if (r.globalLSChg > 0) ctx.push('散戶追多');
  }
  return { flow, ctx };
}

// 共用：把結構 + 籌碼確認變成訊號與理由（台股也用，傳入不同的確認函式與單位）
export function structSignals(r, st, confirm, U = { small: '4H 箱', big: '日線大箱', tr: '日線', lenUnit: 4, lenName: '小時', bigLenName: '天' }) {
  r.boxWhy = null;
  if (!st) return [];
  const out = [], why = [];
  let best = { 1: 0, [-1]: 0 };
  const ok = (dir, minTotal) => {
    const { flow, ctx } = confirm(r, dir);
    if (flow.length < 1 || flow.length + ctx.length < minTotal) return null;
    best[dir] = Math.max(best[dir], flow.length + ctx.length);
    return [...flow, ...ctx];
  };
  // 風報比：目標距離 ÷ 停損距離，小於 1（賺的比賠的少）就不給訊號
  const P0 = st.price;
  const plan = (dir, stop, target) => {
    const risk = dir > 0 ? P0 - stop : stop - P0, reward = dir > 0 ? target - P0 : P0 - target;
    if (!(risk > 0) || !(reward > 0)) return null;
    const rr = reward / risk;
    return rr >= 1 ? [`停損：${dir > 0 ? '跌破' : '突破'} ${px(stop)}（${(risk / P0 * 100).toFixed(1)}%）`, `目標：${px(target)}（${(reward / P0 * 100).toFixed(1)}%）`, `風報比 1 : ${rr.toFixed(1)}`] : null;
  };
  const pctTxt = (b, atr) => `${b.range.toFixed(1)}%，約 ${(b.range / atr).toFixed(1)} 倍平均波動`;
  const atrB = st.atrBig, atrS = st.atrSmall;

  // A. 日線大箱
  const B = st.bigBox;
  if (B && !B.broke) {
    const head = `${U.big} ${px(B.lo)}–${px(B.hi)}（${pctTxt(B, atrB)}，整理 ${B.len} ${U.bigLenName}）`;
    if (B.pos <= 0.2) {
      const c = ok(1, 2);
      const pl = c && plan(1, B.lo * (1 - atrB / 200), B.hi);
      if (pl) { out.push('dBoxLong'); why.push(`${head}，現價在箱底 ${Math.round(B.pos * 100)}%`, ...c, ...pl); }
    } else if (B.pos >= 0.8) {
      const c = ok(-1, 2);
      const pl = c && plan(-1, B.hi * (1 + atrB / 200), B.lo);
      if (pl) { out.push('dBoxShort'); why.push(`${head}，現價在箱頂 ${Math.round(B.pos * 100)}%`, ...c, ...pl); }
    }
  }

  // B. 小箱來回（順日線方向）
  const S = st.smallBox, t = st.tr?.trend;
  if (S && !S.broke) {
    const head = `${U.small} ${px(S.lo)}–${px(S.hi)}（${pctTxt(S, atrS)}，整理 ${S.len * U.lenUnit} ${U.lenName}）`;
    if (S.pos <= 0.2 && t !== 'down') {
      const c = ok(1, 2);
      const pl = c && plan(1, S.lo * (1 - atrS / 200), S.hi);
      if (pl) { out.push('boxLong'); why.push(`${head}，現價在箱底 ${Math.round(S.pos * 100)}%`, ...c, ...pl); }
    } else if (S.pos >= 0.8 && t !== 'up') {
      const c = ok(-1, 2);
      const pl = c && plan(-1, S.hi * (1 + atrS / 200), S.lo);
      if (pl) { out.push('boxShort'); why.push(`${head}，現價在箱頂 ${Math.round(S.pos * 100)}%`, ...c, ...pl); }
    }
  }

  // C. 高位小箱跌破 / 低位小箱突破
  const K = st.smallBreak;
  if (K) {
    const span = K.hi - K.lo;
    const where = `${U.tr}區間 ${Math.round(st.posBig * 100)}% 位置`;
    if (K.dir < 0 && st.posBig >= 0.6) {
      const c = ok(-1, 1);
      // 停損放在箱子下緣往上 1/3：站回箱內下 1/3 以上 = 跌破失敗
      const pl = c && plan(-1, K.lo + span / 3, K.lo - span);
      if (pl) { out.push('hiBoxBreak'); why.push(`高位（${where}）${U.small} ${px(K.lo)}–${px(K.hi)}（${pctTxt(K, atrS)}）收盤跌破`, ...c, ...pl.map((x, i) => (i === 0 ? x.replace('突破', '站回箱內') : i === 1 ? x.replace('目標：', '目標（等幅）：') : x))); }
    } else if (K.dir > 0 && st.posBig <= 0.4) {
      const c = ok(1, 1);
      const pl = c && plan(1, K.hi - span / 3, K.hi + span);
      if (pl) { out.push('loBoxBreak'); why.push(`低位（${where}）${U.small} ${px(K.lo)}–${px(K.hi)}（${pctTxt(K, atrS)}）收盤突破`, ...c, ...pl.map((x, i) => (i === 0 ? x.replace('跌破', '跌回箱內') : i === 1 ? x.replace('目標：', '目標（等幅）：') : x))); }
    }
  }

  // D. 順勢回踩箱體
  const Pb = st.pullback;
  if (Pb?.ok) {
    const b = Pb.box;
    if (Pb.dir > 0) {
      const c = ok(1, 1);
      const pl = c && plan(1, Math.max(...[b.lo * (1 - atrS / 200), st.tr.keyLow].filter((v) => v < P0)), Pb.extP);
      if (pl) { out.push('pullLong'); why.push(`${U.tr}多頭結構沒破（關鍵低點 ${px(st.tr.keyLow)}），回檔 ${Pb.pullPct.toFixed(1)}% 踩到前一個 ${U.small} ${px(b.lo)}–${px(b.hi)} 反彈`, ...c, ...pl.map((x, i) => (i === 1 ? x.replace('目標：', '目標（前高）：') : x))); }
    } else {
      const c = ok(-1, 1);
      const pl = c && plan(-1, Math.min(...[b.hi * (1 + atrS / 200), st.tr.keyHigh].filter((v) => v > P0)), Pb.extP);
      if (pl) { out.push('pullShort'); why.push(`${U.tr}空頭結構沒破（關鍵高點 ${px(st.tr.keyHigh)}），反彈 ${Pb.pullPct.toFixed(1)}% 碰到前一個 ${U.small} ${px(b.lo)}–${px(b.hi)} 遇壓`, ...c, ...pl.map((x, i) => (i === 1 ? x.replace('目標：', '目標（前低）：') : x))); }
    }
  }
  // E. 突破回踩 / 跌破回抽（舉一反三：逆著日線方向的就是反轉訊號）
  const Rt = st.retest;
  if (Rt) {
    const b = Rt.box, span = b.hi - b.lo;
    const rev = (Rt.dir > 0 && t === 'down') || (Rt.dir < 0 && t === 'up');
    const ctxTxt = Rt.dir > 0 ? (t === 'down' ? `${U.tr}空頭中` : t === 'up' ? `${U.tr}多頭中` : '') : (t === 'up' ? `${U.tr}多頭中` : t === 'down' ? `${U.tr}空頭中` : '');
    if (Rt.dir > 0 && !out.includes('pullLong')) {
      const c = ok(1, 1);
      const pl = c && plan(1, (b.hi + b.lo) / 2, Math.max(Rt.extP, b.hi + span));
      if (pl) { out.push(rev ? 'revRetestLong' : 'retestLong'); why.push(`${ctxTxt ? ctxTxt + ' ' : ''}${U.small} ${px(b.lo)}–${px(b.hi)} 整理後往上突破，回踩箱頂站穩反彈${rev ? '（可能反轉向上）' : ''}`, ...c, ...pl.map((x, i) => (i === 0 ? x.replace('跌破', '跌回箱子一半') : x))); }
    } else if (Rt.dir < 0 && !out.includes('pullShort')) {
      const c = ok(-1, 1);
      const pl = c && plan(-1, (b.hi + b.lo) / 2, Math.min(Rt.extP, b.lo - span));
      if (pl) { out.push(rev ? 'revRetestShort' : 'retestShort'); why.push(`${ctxTxt ? ctxTxt + ' ' : ''}${U.small} ${px(b.lo)}–${px(b.hi)} 整理後往下跌破，回抽箱底被壓回${rev ? '（可能反轉向下）' : ''}`, ...c, ...pl.map((x, i) => (i === 0 ? x.replace('突破', '站回箱子一半') : x))); }
    }
  }
  if (best[1] >= 4 && out.some((k) => ['dBoxLong', 'boxLong', 'loBoxBreak', 'pullLong', 'retestLong', 'revRetestLong'].includes(k))) out.push('boxLongPlus');
  if (best[-1] >= 4 && out.some((k) => ['dBoxShort', 'boxShort', 'hiBoxBreak', 'pullShort', 'retestShort', 'revRetestShort'].includes(k))) out.push('boxShortPlus');
  r.boxWhy = why.length ? why : null;
  return out;
}

export function boxSignals(r) {
  return structSignals(r, r.st, confirmCrypto);
}

export function cryptoSignals(r) {
  const bx = boxSignals(r);
  let pt = patternSignals(r);
  // 同一件事不重複算：新的小箱突破 / 跌破已經涵蓋舊的 7 天箱型
  if (bx.includes('loBoxBreak')) pt = pt.filter((k) => k !== 'baseBreak');
  if (bx.includes('hiBoxBreak')) pt = pt.filter((k) => k !== 'boxBreakDown');
  const s = [...bx, ...pt];
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
  const [oi, top, glob, taker, kl, k4, oi4, kd] = await Promise.all([
    getJSON(`${BINANCE}/futures/data/openInterestHist?${q}`),
    getJSON(`${BINANCE}/futures/data/topLongShortPositionRatio?${q}`),
    getJSON(`${BINANCE}/futures/data/globalLongShortAccountRatio?${q}`),
    getJSON(`${BINANCE}/futures/data/takerlongshortRatio?symbol=${s}&period=1h&limit=4`),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=1h&limit=24`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=4h&limit=150`).catch(() => []),
    getJSON(`${BINANCE}/futures/data/openInterestHist?symbol=${s}&period=4h&limit=44`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=1d&limit=120`).catch(() => []),
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
  // 只用已經收盤的 K 棒（最後一根還在跑，會讓訊號忽隱忽現）
  const barsD = kd.slice(0, -1).map((k) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
  const bars4h = k4.slice(0, -1).map((k) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], d: 2 * +k[10] - +k[7] }));
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
    st: structure(barsD, bars4h, STRUCT_CRYPTO),
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
