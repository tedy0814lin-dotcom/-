// 加密貨幣籌碼計算（伺服器和瀏覽器共用同一份）
// 資料來源：幣安 USDⓈ-M 永續合約公開 API，不需要 API key。
import { divergence, pattern, ema } from './indicators.js';
import { crtSignal } from './shortTf.js';
import { paiNow, paiLine, paiRevA } from './pai.js';
import { structure, STRUCT_CRYPTO, choch, chochOB, harmonic } from './structure.js';
import { harmonicCD } from './harmonic.js';
import { vegas } from './vegas.js';

export const BINANCE = 'https://fapi.binance.com';

// 訊號代號 → 中文名稱與方向（給畫面用）
export const CRYPTO_SIGNALS = {
  vegasLong:  { label: '維加斯通道 4H 做多確認', dir: 1, alert: true },
  chochDown:  { label: '4H 上漲後首次 CHoCH 轉弱', dir: -1, alert: true },
  chochDownClean: { label: '上漲中無深回調', dir: -1, alert: true },
  chochUp:    { label: '4H 下跌後首次 CHoCH 轉強', dir: 1, alert: true },
  chochUpClean: { label: '下跌中無深反彈', dir: 1, alert: true },
  harmCDLong:  { label: '諧波 CD 段做多', dir: 1, alert: true },
  harmCDShort: { label: '諧波 CD 段做空', dir: -1, alert: true },
  harmCDLongPlus:  { label: '諧波 CD 段＋籌碼確認', dir: 1, alert: true },
  harmCDShortPlus: { label: '諧波 CD 段＋籌碼確認', dir: -1, alert: true },
  harmUp:      { label: '諧波看漲完成', dir: 1, alert: true },
  harmDown:    { label: '諧波看跌完成', dir: -1, alert: true },
  harmWeakUp:  { label: '諧波看漲（低勝率型態）', dir: 1 },
  harmWeakDown:{ label: '諧波看跌（低勝率型態）', dir: -1 },
  harmCPreLong:  { label: '諧波 C 點成形（預告做多）', dir: 1, alert: true },
  harmCPreShort: { label: '諧波 C 點成形（預告做空）', dir: -1, alert: true },
  harmCPreLongPlus:  { label: '諧波 C 點＋籌碼確認', dir: 1, alert: true },
  harmCPreShortPlus: { label: '諧波 C 點＋籌碼確認', dir: -1, alert: true },
  choch1hUp:   { label: '1H 下跌後首次 CHoCH 轉強', dir: 1, alert: true },
  choch1hDown: { label: '1H 上漲後首次 CHoCH 轉弱', dir: -1, alert: true },
  chochHarmUp:   { label: 'CHoCH 訂單塊＋同向諧波', dir: 1, alert: true },
  chochHarmDown: { label: 'CHoCH 訂單塊＋同向諧波', dir: -1, alert: true },
  chochBosUp:   { label: 'CHoCH 後第二次突破（趨勢延續）', dir: 1, alert: true },
  chochBosDown: { label: 'CHoCH 後第二次跌破（趨勢延續）', dir: -1, alert: true },
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
    if (rr < 1) return null;
    const r2 = Math.min(rr, CAP_R), t = P0 + dir * r2 * risk; // 目標最多 4R
    return [`停損：${dir > 0 ? '跌破' : '突破'} ${px(stop)}（${(risk / P0 * 100).toFixed(1)}%）`, `目標：${px(t)}（${(r2 * risk / P0 * 100).toFixed(1)}%）`, `風報比 1 : ${r2.toFixed(1)}`, ...(r2 > 2 ? ['出場：2R 先出一半，剩下抱到目標'] : [])];
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

// 趨勢中第一次 CHoCH 的理由文字（加密 4H、台股日線共用）
export const chochKeys = (c) => (c.dir > 0 ? ['chochUp', 'chochUpClean'] : ['chochDown', 'chochDownClean']).concat(c.stage === 'bos' ? [c.dir > 0 ? 'chochBosUp' : 'chochBosDown'] : []);

// 進場／停損／目標（兩個目標由近到遠），風報比用近的目標算
// 目標上限：最多 4R（更遠的目標回測上很少拿到，帳面報酬會灌水）；2R 先出一半
export const CAP_R = 4;
export function capTarget(entry, stop, target, dir) {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return target;
  return entry + dir * Math.min(Math.abs(target - entry), CAP_R * risk);
}
export function planLines(p, dir, entryNote) {
  if (!p) return [];
  const risk = Math.abs(p.entry - p.stop), pctOf = (v) => (Math.abs(v - p.entry) / p.entry * 100).toFixed(1) + '%';
  const [t1, t2] = [p.t1, p.t2].map((t) => capTarget(p.entry, p.stop, t, dir)).sort((a, b) => (dir > 0 ? a - b : b - a));
  const r1 = Math.abs(t1 - p.entry) / risk, r2 = Math.abs(t2 - p.entry) / risk;
  const one = Math.abs(t2 - t1) / risk < 0.05; // 兩個目標都被上限截到一樣
  return [
    `進場：${px(p.entry)}${entryNote ? `（${entryNote}）` : ''}`,
    `停損：${dir > 0 ? '跌破' : '突破'} ${px(p.stop)}（${pctOf(p.stop)}）`,
    one ? `目標：${px(t2)}（${pctOf(t2)}，${r2.toFixed(1)}R）`
      : `目標：${px(t1)}（${pctOf(t1)}，${r1.toFixed(1)}R）／ ${px(t2)}（${pctOf(t2)}，${r2.toFixed(1)}R）`,
    `風報比 1 : ${r1.toFixed(1)}`,
    ...(r2 > 2 ? ['出場：2R 先出一半，剩下抱到目標（目標最多 4R）'] : []),
  ];
}

export function harmWhy(h, tf) {
  const up = h.dir > 0;
  const f = (v) => v.toFixed(3);
  return [
    `${tf}[${h.level}級別] 諧波 ${h.name} ${up ? '看漲' : '看跌'}型態完成，D 點 ${px(h.D)}${h.ago ? `（${h.ago} 根前）` : ''}已有反應`,
    h.name === 'Cypher' ? `比例：AB/XA ${f(h.b)}、XC/XA ${f(h.xc)}、CD/XC ${f(h.dx)}` : `比例：AB/XA ${f(h.b)}、BC/AB ${f(h.c)}、AD/XA ${f(h.xd)}、CD/BC ${f(h.d)}`,
    `X ${px(h.X)} → A ${px(h.A)} → B ${px(h.B)} → C ${px(h.C)} → D ${px(h.D)}`,
    ...planLines(h.plan, h.dir, '目前價'),
    '出場：到目標 1 先出一半，剩下的停損移到進場價',
    ...(h.weak ? ['⚠ 這個型態回測勝率偏低，只當參考'] : []),
  ];
}

// 未成形諧波：挑最接近的兩個（已進入入場區的優先），離太遠（> 15%）的不顯示
export function pickPending(list, done) {
  // 同一組 XABC 已經完成的，就不再重複顯示未成形
  return (list || []).filter((p) => !p.weak && p.dist < 15 && !(done && p.name === done.name && p.dir === done.dir && p.w === done.w))
    .sort((a, b) => (a.state === 'in' ? -1 : 0) - (b.state === 'in' ? -1 : 0) || a.dist - b.dist).slice(0, 2);
}
export function harmPendWhy(list, tf) {
  if (!list?.length) return [];
  return list.map((p) => `⏳ ${tf}[${p.level}級別] ${p.name} ${p.dir > 0 ? '看漲' : '看跌'}${p.state === 'in' ? '：⚡ 已進入入場區' : `：等待 D 點（還差 ${Math.max(0, p.dist).toFixed(1)}%）`}，入場區 ${px(p.bot)}～${px(p.top)}，停損 ${px(p.stop)}，止盈 ${px(p.t1)}／${px(p.t2)}`)
    .concat('（未成形只是預告：回測直接掛單平均只有 +0.04R，等 D 點有反應、變成「型態完成」再進場比較好）');
}

// 諧波 CD 段：剛觸發（最近 3 根內突破／跌破 B）＝主要訊號；還在等 B＝預告
export function cdSignals(list, tf, confirm) {
  const keys = [], why = [], ids = [];
  for (const x of list || []) {
    const L = x.dir > 0, act = L ? '突破' : '跌破';
    const head = `${tf}[${x.level}級別] 諧波 ${x.name} CD 段${L ? '做多' : '做空'}`;
    if (x.state === 'on' && x.ago <= 3) {
      keys.push(L ? 'harmCDLong' : 'harmCDShort');
      // 籌碼同方向確認（資金流至少 1 項、總共至少 2 項）→ 加一個「＋籌碼確認」，強度升到強
      const c = confirm ? confirm(x.dir) : null;
      const cw = c ? [...c.flow, ...c.ctx] : [];
      if (c && c.flow.length >= 1 && cw.length >= 2) { keys.push(L ? 'harmCDLongPlus' : 'harmCDShortPlus'); why.push(`籌碼確認：${cw.join('、')}`); }
      else if (cw.length) why.push(`籌碼（還不夠強）：${cw.join('、')}`);
      why.push(`${head}：已${act} B ${px(x.entry)}${x.ago ? `（${x.ago} 根前）` : ''}，往 D 點走`,
        `X ${px(x.X)} → A ${px(x.A)} → B ${px(x.B)} → C ${px(x.C)} → D 預估 ${px(x.target)}`,
        ...planLines({ entry: x.entry, stop: x.stop, t1: x.target, t2: x.zoneBot }, x.dir, `${act} B 的價位`));
    } else if (x.state === 'on') {
      why.push(`${head}：${act} B 已 ${x.ago} 根，進行中（停損 C ${px(x.stop)}、止盈 ${px(capTarget(x.entry, x.stop, x.target, x.dir))}）`);
    } else {
      // C 點剛成形、還在等突破／跌破 B：預告訊號（單獨＝中；有籌碼確認或其他同向訊號＝強）
      keys.push(L ? 'harmCPreLong' : 'harmCPreShort');
      const c = confirm ? confirm(x.dir) : null;
      const cw = c ? [...c.flow, ...c.ctx] : [];
      if (c && c.flow.length >= 1 && cw.length >= 2) { keys.push(L ? 'harmCPreLongPlus' : 'harmCPreShortPlus'); why.push(`籌碼確認：${cw.join('、')}`); }
      why.push(`⏳ ${head}：C 點已成形，等待${act} B ${px(x.entry)}（還差 ${Math.abs(x.dist).toFixed(1)}%），停損 C ${px(x.stop)}，止盈 ${px(capTarget(x.entry, x.stop, x.target, x.dir))}，風報比 1 : ${Math.min(x.rr, CAP_R).toFixed(1)}`);
    }
    if (x.state === 'wait' || x.ago <= 3) ids.push(`${tf.trim()}${x.state === 'wait' ? 'C' : 'B'}${L ? '+' : '-'}${px(x.B)}/${px(x.C)}`);
  }
  return { keys: [...new Set(keys)], why, ids };
}

// CHoCH 之後的訂單塊交易計畫（0.618 回撤進場、停損訂單塊、目標 RR 倍）
export function obWhy(o, tf, combo) {
  const up = o.dir > 0, pct = (v) => (Math.abs(v - o.entry) / o.entry * 100).toFixed(1) + '%';
  return [
    ...(combo ? [`★ ${tf}CHoCH 訂單塊＋同方向反向諧波 → 非常強`] : []),
    `${tf}${up ? '下跌' : '上漲'}趨勢第一次 CHoCH：收盤${up ? '站上關鍵高點' : '跌破關鍵低點'} ${px(o.key)}${o.ago ? `（${o.ago} 根前）` : '（剛發生）'}`,
    `訂單塊 ${px(o.obLo)}～${px(o.obHi)}`,
    o.state === 'wait'
      ? `⏳ 等回撤到 0.618 掛單${up ? '做多' : '做空'}（如果先再創${up ? '新高' : '新低'}，掛單價會跟著調整）`
      : `已在 ${o.fillAgo} 根前進場，持倉中`,
    `進場：${px(o.entry)}（0.618 回撤）`,
    `停損：${up ? '跌破' : '突破'} ${px(o.stop)}（訂單塊${up ? '低' : '高'}點，${pct(o.stop)}）`,
    `目標：${px(capTarget(o.entry, o.stop, o.target, o.dir))}（${pct(capTarget(o.entry, o.stop, o.target, o.dir))}，${Math.min(o.rr, CAP_R)}R）`,
    `風報比 1 : ${Math.min(o.rr, CAP_R)}`,
    ...(Math.min(o.rr, CAP_R) > 2 ? ['出場：2R 先出一半，剩下抱到目標'] : []),
  ];
}

// 把 CHoCH 訂單塊轉成訊號：list = [[計畫, 週期文字, 同週期諧波清單, 訊號代號（不含 Up/Down）], ...]
export function obSignals(r, list) {
  const keys = [], why = [], ids = [];
  for (const [o, tf, harm, k] of list) {
    if (!o) continue;
    // 同方向反向諧波＝非常強；但已經進場一段時間（超過 3 根）就不再當新機會
    const up = o.dir > 0, combo = (o.state === 'wait' || o.fillAgo <= 3) && (harm || []).some((x) => x.dir === o.dir);
    keys.push(k + (up ? 'Up' : 'Down'));
    if (combo) keys.push(up ? 'chochHarmUp' : 'chochHarmDown');
    why.push(...obWhy(o, tf, combo));
    ids.push(tf.trim() + (up ? '+' : '-') + px(o.obLo));
  }
  r.chochWhy = why.length ? why : null;
  r.chochId = ids.join(',');
  return [...new Set(keys)];
}

export function chochWhy(c, tf) {
  const up = c.dir > 0;
  return [
    `${tf}${up ? '下跌' : '上漲'}趨勢（${up ? '跌' : '漲'} ${c.movePct.toFixed(1)}%，最大回調只有 ${c.maxRetr.toFixed(0)}%），第一次收盤${up ? '站上關鍵高點' : '跌破關鍵低點'} ${px(c.key)}${c.ago ? `（${c.ago} 根前）` : ''}`,
    `${up ? '原本的下跌結構被打破，可能開始反轉向上' : '原本的上漲結構被打破，可能開始反轉向下'}`,
    `失效參考：${up ? '跌破前低' : '突破前高'} ${px(c.peak)}`,
  ].concat(c.stage === 'bos' ? [`★ CHoCH（${c.chochAgo} 根前）之後${up ? '回踩出更高的低點，又收盤突破' : '反彈出更低的高點，又收盤跌破'} ${px(c.low1)}${c.ago ? `（${c.ago} 根前）` : ''}，第二次結構確認 → 新趨勢延續，非常強`] : [])
    .concat(planLines(c.plan, c.dir, c.stage === 'bos' ? '回測剛被突破／跌破的轉折價' : '回測被突破／跌破的關鍵價'));
}

export function boxSignals(r) {
  return structSignals(r, r.st, confirmCrypto);
}

// 維加斯通道現況（4H）：up＝小通道整條在大通道上方；lo／hi＝四條線外擴 0.5 倍 ATR 的範圍（判斷「在通道附近」）
export function tunnel(B) {
  if (!B || B.length < 340) return null;
  const c = B.map((b) => b.c), L = B.length - 1;
  const [a, b, x, y] = [144, 169, 288, 338].map((n) => ema(c, n)[L]);
  let s = 0; for (let i = L - 13; i <= L; i++) s += Math.max(B[i].h, B[i - 1].c) - Math.min(B[i].l, B[i - 1].c);
  const atr = s / 14;
  return { up: Math.min(a, b) > Math.max(x, y), dn: Math.max(a, b) < Math.min(x, y), lo: Math.min(a, b, x, y) - 0.5 * atr, hi: Math.max(a, b, x, y) + 0.5 * atr };
}

// MACD 持續背離是幾根 4H 前出現的（0 = 最新一根）；沒有就 null
export function macdAge(bars) {
  if (!bars || bars.length < 60) return null;
  const now = divergence(bars), out = { bull: null, bear: null };
  for (const side of ['bull', 'bear']) {
    if (now[side] < 2) continue;
    let k = 1;
    while (k <= 16 && divergence(bars.slice(0, bars.length - k))[side] >= 2) k++;
    out[side] = k - 1; // 連續幾根之前就已經成立
  }
  return out;
}

// ---------- 籌碼情境（大戶在做什麼）----------
// 用 4 小時與 24 小時的價格、持倉、大戶多空比、CVD、資金費率判讀；回傳 [{t: 文字, d: 偏多 1／偏空 -1／0}]
export function chipScene(r) {
  const out = [], f = r.funding;
  const p4 = r.chg4 ?? null, p24 = r.chg24, oi4 = r.oiChg4, oi24 = r.oiChg24, cvd = r.cvd4, top = r.topLSChg;
  const up = (p4 ?? p24) > 0.8, dn = (p4 ?? p24) < -0.8, flat = !up && !dn;
  if (up && oi4 > 1 && cvd > 0) out.push({ t: '新多單進場推升（價漲、持倉增、主動買）', d: 1 });
  if (up && oi4 < -1) out.push({ t: '空單回補推升（價漲、持倉減）：力道通常不持久', d: 0 });
  if (dn && oi4 > 1 && cvd < 0) out.push({ t: '新空單進場打壓（價跌、持倉增、主動賣）', d: -1 });
  if (dn && oi4 < -1) out.push({ t: '多單平倉／停損（價跌、持倉減）：槓桿在清', d: 0 });
  if (flat && oi24 >= 3 && top > 0 && cvd > 0) out.push({ t: '價格不動、持倉增、大戶加多：疑似吸籌', d: 1 });
  if (flat && oi24 >= 3 && top < 0 && cvd < 0) out.push({ t: '價格不動、持倉增、大戶加空：疑似派發', d: -1 });
  if (oi24 > 2 && top > 0.02) out.push({ t: '大戶加倉多單（持倉增、大戶多空比升）', d: 1 });
  if (oi24 > 2 && top < -0.02) out.push({ t: '大戶加倉空單（持倉增、大戶多空比降）：回測之後常被軋，做多加分', d: 1 });
  if (oi24 < -2 && top > 0.02) out.push({ t: '大戶平空單（持倉減、大戶多空比升）', d: 1 });
  if (oi24 < -2 && top < -0.02) out.push({ t: '大戶平多單（持倉減、大戶多空比降）', d: -1 });
  if (f != null && f >= 0.05) out.push({ t: `資金費率偏高 ${f.toFixed(3)}%：回測之後 1～3 天反而偏漲，不當做空理由`, d: 0 });
  if (f != null && f <= -0.03) out.push({ t: `空方擁擠（資金費率 ${f.toFixed(3)}%）：小心軋空`, d: 1 });
  if (r.globalLS >= 2.5) out.push({ t: `散戶極度偏多（多空比 ${r.globalLS.toFixed(2)}）`, d: -1 });
  if (r.globalLS > 0 && r.globalLS <= 0.7) out.push({ t: `散戶極度偏空（多空比 ${r.globalLS.toFixed(2)}）`, d: 1 });
  if (oi24 <= -8) out.push({ t: `大量平倉（24h 持倉 ${oi24.toFixed(1)}%）`, d: 0 });
  if (r.spotCvd4 != null && r.cvd4 != null) {
    if (up && r.spotCvd4 > 0 && r.cvd4 <= 0) out.push({ t: '現貨買盤推升（現貨買、合約沒追）：回測沒有比較好', d: 0 });
    if (up && r.spotCvd4 <= 0 && r.cvd4 > 0) out.push({ t: '合約多單推升、現貨沒跟：回測沒有比較差', d: 0 });
  }
  return out;
}

// 加密籌碼分（2026-10-29 回測：幣安 Binance Vision 20 幣、2022-11～2026-09，
// 1,441 筆 4H 諧波 D／諧波＋維加斯／CD 交易，比較「進場當下有／沒有這個籌碼條件」每筆 R，前後兩段都要同方向）
//   做多：持倉 24h 增 >2% 且大戶多空比降 >0.02（大戶加空）+0.79R vs +0.12R → +10（20 幣都有、門檻換 0～3% 都成立）
//         資金費率 ≤ −0.01% +0.35R vs +0.17R → +4
//         持倉 24h 減 ≥4%（大量平倉後才進場）−0.05R vs +0.32R → −6
//         恐懼貪婪指數 ≥75 −0.34R vs +0.23R → −6
//   做空：資金費率 ≤ 0 −0.25R vs +0.11R → −6；散戶多空比 24h 上升 +0.13R vs −0.33R → +4
//   現貨 vs 合約 CVD、新多單推升、多單平倉、空單回補、大戶加多：有沒有差都不到 0.2R、不顯著，不計分
export function cryptoChip(r, dir) {
  let s = 0; const why = [];
  const f = r.funding, oi = r.oiChg24, top = r.topLSChg;
  if (dir > 0) {
    if (oi > 2 && top < -0.02) { s += 10; why.push(`＋大戶加空單（持倉 +${oi.toFixed(1)}%、大戶多空比降）：回測之後常被軋`); }
    if (f != null && f <= -0.01) { s += 4; why.push(`＋資金費率 ${f.toFixed(3)}%（空方付費）`); }
    if (oi != null && oi <= -4) { s -= 6; why.push(`－24h 持倉 ${oi.toFixed(1)}%（大量平倉中）`); }
    if (r.fng != null && r.fng >= 75) { s -= 6; why.push(`－市場極度貪婪（恐懼貪婪指數 ${r.fng}）`); }
  } else {
    if (f != null && f <= 0) { s -= 6; why.push(`－資金費率 ${f.toFixed(3)}%（空方已在付費）`); }
    if (r.globalLSChg > 0) { s += 4; why.push('＋散戶多空比上升（散戶追多）'); }
  }
  return { score: s, why };
}

// 每個保留策略的進出場計畫（止盈照回測最好又穩定的設定）
function stratPlans(r) {
  const P = {}, why = [];
  const tp = (e, s, R, dir) => e + dir * R * Math.abs(e - s);
  const line = (k, tf, p, note) => why.push(`【${k}】${tf}：進場 ${px(p.entry)}・停損 ${px(p.stop)}（${(Math.abs(p.entry - p.stop) / p.entry * 100).toFixed(1)}%）・目標 ${px(p.target)}（${(Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop)).toFixed(1)}R）${note ? '・' + note : ''}`);
  const price = r.price;
  // MACD 持續背離：停損放最近 10 根 4H 的低／高點；底背離 4R 全出、頂背離 3R 全出（回測最穩）
  const a = r.macdAge || {};
  if (r.div?.bull >= 2 && a.bull != null && a.bull <= 15) {
    const p = { entry: price, stop: r.lo10, tf: '4H', bars: a.bull, wait: false };
    if (p.stop < p.entry) { p.target = tp(p.entry, p.stop, 4, 1); P.macdBull2 = p; line('參考：MACD 持續底背離', `4H ${a.bull} 根前出現`, p, '近一年有效、4 年回測不穩，不計分'); }
  }
  if (r.div?.bear >= 2 && a.bear != null && a.bear <= 15) {
    const p = { entry: price, stop: r.hi10, tf: '4H', bars: a.bear, wait: false };
    if (p.stop > p.entry) { p.target = tp(p.entry, p.stop, 3, -1); P.macdBear2 = p; line('參考：MACD 持續頂背離', `4H ${a.bear} 根前出現`, p, '4 年回測約 0，不計分'); }
  }
  // 維加斯通道 4H 做多：進場＝突破 K 高點、停損＝回踩低點；目標＝前高（最多 6R）
  const v = r.vg4?.now;
  if (v && v.status === '確認' && v.dir > 0 && v.ago <= 2) {
    const e = +v.entry, s = +v.stop, risk = e - s;
    const t = Math.min(+v.target, e + 6 * risk);
    const p = { entry: e, stop: s, target: t > e + risk ? t : e + 2 * risk, tf: '4H', bars: v.ago, wait: false };
    P.vegasLong = p; line('參考：維加斯通道做多', `4H ${v.tunnel}通道，${v.ago} 根前確認`, p, '近一年 +0.47R，但 4 年回測前半段虧，不計分');
  }
  // 諧波 D 點完成（只做多）：停損 D 外 2 倍 ATR，4R 全出
  const h = r.harm4;
  const T = r.tun;
  if (h && h.dir > 0 && !h.weak) {
    const p = { entry: h.plan.entry, stop: h.plan.stop, tf: '4H', bars: h.ago, wait: false };
    if (T?.up && h.D >= T.lo && h.D <= T.hi) {
      // 諧波＋維加斯：通道多頭排列、D 點落在通道上（4 年回測 +0.33R，3R 全出）
      p.target = tp(p.entry, p.stop, 3, 1); P.harmUpVegas = p;
      line(`諧波 ${h.name} D 點完成＋D 在維加斯通道上`, `4H，D 點 ${h.ago} 根前`, p, '3R 全出（4 年回測 +0.33R）');
    } else {
      p.target = tp(p.entry, p.stop, 6, 1); P.harmUp = p;
      line(`諧波 ${h.name} D 點完成`, `4H，D 點 ${h.ago} 根前`, p, '6R 全出（4 年回測 +0.21R）');
    }
  }
  // CRT：前一天區間被掃 → 30 分 CHoCH → 回 FVG 掛單；停損掃針低點、3R 全出（4 個月回測 +0.08R）
  if (r.crt) {
    const c = r.crt, k = c.dir > 0 ? 'crtLong' : 'crtShort';
    const p = { entry: c.entry, stop: c.stop, target: c.target, tf: '30m', bars: c.ago, wait: c.state === 'wait' };
    P[k] = p; line(`CRT 前日區間${c.dir > 0 ? '低點被掃→做多' : '高點被掃→做空'}`, `30 分，${c.state === 'wait' ? '等回 FVG 掛單' : c.ago + ' 根前成交'}`, p, '3R 全出（4 個月回測 +0.08R）');
  }
  // 諧波 CD 段：做多 1R 出一半、停損移保本、剩下 3R；做空 2R 出一半、剩下 4R
  for (const x of r.harmCD || []) {
    if (!(x.state === 'wait' || x.ago <= 3)) continue;
    const k = x.dir > 0 ? 'harmCDLong' : 'harmCDShort';
    if (P[k]) continue;
    const p = { entry: x.entry, stop: x.stop, tf: '4H', bars: x.state === 'wait' ? null : x.ago, wait: x.state === 'wait' };
    p.target = tp(p.entry, p.stop, x.dir > 0 ? 4 : 2, x.dir); P[k] = p;
    line(`諧波 ${x.name} CD 段${x.dir > 0 ? '做多' : '做空'}`, x.state === 'wait' ? '4H，等突破／跌破 B' : `4H，${x.ago} 根前觸發`, p, x.dir > 0 ? '4R 全出（4 年回測 +0.12R）' : '2R 全出（4 年回測 +0.07R）');
  }
  // PAI 使用者規則：前一次超買後超賣 ≥2 次 → 第一次超買 → 離開超買（Z 跌回 80 以下）做多；停損 10 根低點
  for (const [k, x, tf, R, note] of [['paiRevD', r.paiRevD, '1D', 4, '4R 全出（4 年 31 幣回測 +0.82R，只有 51 筆）'], ['paiRev12', r.paiRev12, '12H', 3, '3R 全出（4 年 31 幣回測 +0.38R，129 筆）']]) {
    // 停損超過 25% 不列（新幣暴跌後會出現 70% 以上的停損；回測排除後 12H 仍 +0.37R、1D +0.98R）
    if (!x || !(x.entry > x.stop) || (x.entry - x.stop) / x.entry > 0.25) continue;
    const p = { entry: x.entry, stop: x.stop, tf, bars: x.ago, wait: false };
    p.target = tp(p.entry, p.stop, R, 1); P[k] = p;
    line(`PAI 連續超賣 ${x.k} 次後第一次超買、離開超買做多`, `${tf}，${x.ago === 0 ? '剛確認' : x.ago + ' 根前'}`, p, note);
  }
  { const l = paiLine(r.pai, 'crypto', '4H'); if (l) why.push(l); }
  r.plans = P; r.stratWhy = why;
}

export function cryptoSignals(r) {
  // 箱體：回測只有「日線大箱底做多」有一點點優勢，其他箱體訊號拿掉
  const st = r.st ? { ...r.st, smallBox: null, smallBreak: null, pullback: null, retest: null, bigBox: r.st.bigBox && r.st.bigBox.pos <= 0.2 ? r.st.bigBox : null } : null;
  const bx = structSignals(r, st, confirmCrypto).filter((k) => k === 'dBoxLong' || k === 'boxLongPlus');
  const pt = patternSignals(r);
  const s = [...bx, ...pt];
  stratPlans(r);
  for (const k of Object.keys(r.plans)) s.push(k);
  // 諧波 CD 段的說明文字（4H）
  const cd = cdSignals(r.harmCD, '4H ', (d) => confirmCrypto(r, d));
  r.harmWhy = cd.why; r.harmPendWhy = null; r.harmId = cd.ids.join(','); r.chochWhy = null; r.chochId = '';
  r.scene = chipScene(r);
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
    if (r.div.bull === 1) s.push('macdBull');
    if (r.div.bear === 1) s.push('macdBear');
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
  return [...new Set(s)];
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
  // 持倉只抓一次 1 小時資料（7.5 天），近 24 小時和整理期都從這裡算，少打一次幣安
  const [oiH, top, glob, taker, k1, k4, kd, ks, k30] = await Promise.all([
    getJSON(`${BINANCE}/futures/data/openInterestHist?symbol=${s}&period=1h&limit=180`),
    getJSON(`${BINANCE}/futures/data/topLongShortPositionRatio?${q}`),
    getJSON(`${BINANCE}/futures/data/globalLongShortAccountRatio?${q}`),
    getJSON(`${BINANCE}/futures/data/takerlongshortRatio?symbol=${s}&period=1h&limit=4`),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=1h&limit=25`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=4h&limit=499`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=1d&limit=120`).catch(() => []),
    // 現貨 1H K（主動買入量），算現貨 CVD；沒有現貨的幣會失敗，當作沒有
    getJSON(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=1h&limit=5`).catch(() => []),
    // CRT 用 30 分 K（AMD、Omor OTE 重新回測扣費後虧損，沒有加）
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=30m&limit=99`).catch(() => []),
  ]);
  const toB = (a) => a.slice(0, -1).map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
  const b30 = toB(k30);
  const spotCvd4 = ks.length >= 5 ? ks.slice(-4).reduce((a, k) => a + 2 * +k[10] - +k[7], 0) : null;
  // 1 小時 K：最近 24 根算 CVD／振幅；已收盤的 299 根給 1H 諧波用（回測 1H 每筆 +0.25R）
  const kl = k1.slice(-24);
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
  const oi = oiH.slice(-25);
  const oiBoxChg = oiH.length >= 16 ? pct(+oiH[oiH.length - 9].sumOpenInterestValue, +oiH[0].sumOpenInterestValue) : null;
  const hi = kl.length ? Math.max(...kl.map((k) => +k[2])) : null;
  const lo = kl.length ? Math.min(...kl.map((k) => +k[3])) : null;
  if (!oi.length || !top.length || !glob.length) return null;
  const oiNow = +last(oi).sumOpenInterestValue;
  const r = {
    symbol: s,
    base: s.replace(/USDT$/, ''),
    price: +t.lastPrice,
    chg24: +t.priceChangePercent,
    chg4: kl.length >= 5 ? pct(+kl[kl.length - 1][4], +kl[kl.length - 5][4]) : null,
    spotCvd4,
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
    div: bars4h.length >= 40 ? divergence(bars4h.slice(-300)) : null,
    pat: bars4h.length >= 60 ? pattern(bars4h.slice(-300), { box: 42, runWin: 150, boxMax: 15 }) : null,
    st: structure(barsD, bars4h.slice(-300), STRUCT_CRYPTO),
    // 回測後保留的策略（2026-10-29）：4H 諧波 CD、4H 諧波 D 點完成（只做多）、4H MACD 持續背離、維加斯 4H（只做多）
    // 1H／4H CHoCH 訂單塊、1H 諧波回測無效，已拿掉
    harmCD: harmonicCD(bars4h.slice(-300)),
    harm4: harmonic(bars4h.slice(-300)),
    vg4: vegas(bars4h),
    tun: tunnel(bars4h),
    crt: barsD.length ? crtSignal(b30, barsD[barsD.length - 1]) : null,
    macdAge: macdAge(bars4h.slice(-300)),
    pai: paiNow(bars4h.slice(-200)),
    // PAI 連續超賣後第一次超買、離開超買才做多（使用者規則）：只有 12H、日線回測有效
    paiRev12: paiRevA((() => { const g = new Map(); for (const k of k4.slice(0, -1)) { const key = Math.floor(+k[0] / 432e5); if (!g.has(key)) g.set(key, []); g.get(key).push(k); }
      return [...g.values()].filter((a) => a.length === 3).map((a) => ({ o: +a[0][1], h: Math.max(...a.map((k) => +k[2])), l: Math.min(...a.map((k) => +k[3])), c: +a[2][4] })); })()),
    paiRevD: paiRevA(barsD),
    lo10: Math.min(...bars4h.slice(-10).map((b) => b.l)),
    hi10: Math.max(...bars4h.slice(-10).map((b) => b.h)),
    atr4: (() => { const b = bars4h.slice(-15); let s = 0; for (let i = 1; i < b.length; i++) s += Math.max(b[i].h, b[i - 1].c) - Math.min(b[i].l, b[i - 1].c); return s / (b.length - 1 || 1); })(),
    oiBoxChg,
  };
  r.signals = cryptoSignals(r);
  r.score = cryptoScore(r);
  return r;
}

// n = 取成交額前幾名的合約
// 前 fastN 名每次都重抓（預設 150，120 檔全部即時）；超過的才用 15 分鐘快取，避免一次打太多幣安 API 被擋
const rowCache = new Map(); // symbol → { at, row }
export async function buildCrypto(n, { getJSON, pool, fastN = 150, slowTtl = 15 * 60e3 }) {
  const [tickers, prem, info, fg] = await Promise.all([
    getJSON(`${BINANCE}/fapi/v1/ticker/24hr`),
    getJSON(`${BINANCE}/fapi/v1/premiumIndex`),
    getJSON(`${BINANCE}/fapi/v1/exchangeInfo`),
    // 恐懼貪婪指數（alternative.me，免費）；抓不到就不計
    getJSON('https://api.alternative.me/fng/?limit=1').catch(() => null),
  ]);
  const fng = fg?.data?.[0] ? +fg.data[0].value : null;
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
    await pool(top.map((t, i) => [t, i]), 8, async ([t, i]) => {
      const hit = rowCache.get(t.symbol);
      if (i >= fastN && hit && Date.now() - hit.at < slowTtl) {
        // 用快取的籌碼分析，但價格、漲跌、成交額、資金費率換成最新的
        const p = fund.get(t.symbol);
        return { ...hit.row, price: +t.lastPrice, chg24: +t.priceChangePercent, vol24: +t.quoteVolume, funding: p ? +p.lastFundingRate * 100 : hit.row.funding };
      }
      try {
        const row = await one(t, fund.get(t.symbol), getJSON);
        if (row) rowCache.set(t.symbol, { at: Date.now(), row });
        return row;
      } catch { return hit ? hit.row : null; }
    })
  ).filter(Boolean);
  for (const r of rows) r.fng = fng;
  if (!rows.length) throw new Error('幣安沒有回傳任何合約資料');
  return { updatedAt: Date.now(), source: '幣安 USDⓈ-M 永續合約', rows };
}
