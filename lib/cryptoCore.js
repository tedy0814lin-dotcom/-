// 加密貨幣籌碼計算（伺服器和瀏覽器共用同一份）
// 資料來源：幣安 USDⓈ-M 永續合約公開 API，不需要 API key。
import { divergence, pattern, ema } from './indicators.js';
import { crtSignal } from './shortTf.js';
import { paiNow, paiLine, paiRevA } from './pai.js';
import { cvdoCross, cvdoCrossStrong, cvdFlip } from './cvdo.js';
import { macdTopDiv } from './macdHump.js';
import { pocBreak, bigBull, pocEngulfShort } from './pocBreak.js';
import { structure, STRUCT_CRYPTO, choch, chochOB, harmonic } from './structure.js';
import { harmonicCD } from './harmonic.js';
import { vegas } from './vegas.js';
import { smcSignals } from './smcFlip.js';
import { pinLowSignals } from './volEng.js';
import { patSignals, earlySignals, dailyFrom12h } from './chartPat.js';

export const BINANCE = 'https://fapi.binance.com';

// 訊號代號 → 中文名稱與方向（給畫面用）
export const CRYPTO_SIGNALS = {
  vegasLong:  { label: '維加斯通道 4H 做多確認', dir: 1, alert: true },
  vegasShort: { label: '維加斯通道 4H 做空確認（觀察中）', dir: -1, alert: false },
  pocBreakD:  { label: '日線大陽線突破 POC 做多', dir: 1, alert: true },
  bigBullD:   { label: '日線大陽線做多（BTC 站上 50 日線）', dir: 1, alert: true },
  pocEngD:    { label: '日線 POC 空方吞噬做空', dir: -1, alert: true },
  paiRevD:    { label: '日線 PAI 連續超賣後第一次超買（樣本少）', dir: 1, alert: false },
  crtLong:    { label: 'CRT 前日低點被掃（參考）', dir: 1, alert: false },
  crtShort:   { label: 'CRT 前日高點被掃（參考）', dir: -1, alert: false },
  chochDown:  { label: '4H 上漲後首次 CHoCH 轉弱', dir: -1, alert: true },
  chochDownClean: { label: '上漲中無深回調', dir: -1, alert: true },
  chochUp:    { label: '4H 下跌後首次 CHoCH 轉強', dir: 1, alert: true },
  chochUpClean: { label: '下跌中無深反彈', dir: 1, alert: true },
  harmCDLong:  { label: '諧波 CD 段做多', dir: 1, alert: true },
  harmCDShort: { label: '諧波 CD 段做空', dir: -1, alert: true },
  harmCDLongPlus:  { label: '諧波 CD 段＋籌碼確認', dir: 1, alert: true },
  harmCDShortPlus: { label: '諧波 CD 段＋籌碼確認', dir: -1, alert: true },
  smcFlipL4:  { label: '4H 突破空方訂單塊＋CVD 動能＋MACD 底背離（做多）', dir: 1, alert: true },
  smcFlipS4:  { label: '4H 跌破多方訂單塊＋CVD 動能＋維加斯壓力（做空）', dir: -1, alert: true },
  smcObL12:   { label: '12H 結構訂單塊回測＋CVD 動能（做多）', dir: 1, alert: true },
  pinLowL4:   { label: '4H 低位 Pinbar（長下影）做多', dir: 1, alert: true },
  pDbl4:      { label: '4H 雙底突破頸線（做多）', dir: 1, alert: false },
  pDbl12:     { label: '12H 雙底突破頸線（做多）', dir: 1, alert: true },
  pTri4:      { label: '4H 三重底突破頸線（做多）', dir: 1, alert: true },
  pRect4:     { label: '4H 矩形整理向上突破（做多）', dir: 1, alert: true },
  pAsc4:      { label: '4H 上升三角形向上突破（做多）', dir: 1, alert: false },
  eRect12:    { label: '12H 矩形底部早進場（不等突破，做多，觀察）', dir: 1, alert: false },
  eTri12:     { label: '12H 三重底早進場（不等突破，做多）', dir: 1, alert: true },
  eDia12:     { label: '12H 菱形底早進場（不等突破，做多）', dir: 1, alert: true },
  eDbl12:     { label: '12H 雙底早進場（不等突破，做多）', dir: 1, alert: false },
  eRect1d:    { label: '日線矩形底部早進場（不等突破，做多）', dir: 1, alert: true },
  eTri1d:     { label: '日線三重底早進場（不等突破，做多）', dir: 1, alert: true },
  eDbl1d:     { label: '日線雙底早進場（不等突破，做多）', dir: 1, alert: true },
  smcObL4:    { label: '4H 結構訂單塊回測＋CVD 動能（做多，觀察）', dir: 1, alert: false },
  smcFlipL12: { label: '12H 突破空方訂單塊＋CVD 動能＋維加斯支撐（做多，觀察）', dir: 1, alert: false },
  smcObS12:   { label: '12H 結構訂單塊回測＋CVD 動能（做空，觀察）', dir: -1, alert: false },
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

// 籌碼一行判斷（描述「現在倉位在做什麼」，不是預測，也沒做過回測）
// 依據 Coinglass 學習中心的標準對照：價漲＋持倉增＝新多單；價漲＋持倉減＝空單回補；價跌＋持倉增＝新空單；價跌＋持倉減＝多單平倉。
// 「被軋／被清」再加上 OKX 近 1 小時爆倉單（只含 OKX）：金額 ≥ 全市場持倉 0.01% 且某一邊 ≥ 另一邊 3 倍才算。沒有明顯特徵就不顯示。
// 4h 價格 ±0.8%、持倉 ±1%（沿用網站原本的門檻）；這些門檻是約定，不是回測出來的。
export function chipLabel(r) {
  const p = r.chg4, o = r.oiChg4;
  if (p == null || o == null) return null;
  const nums = `4h 價格 ${p >= 0 ? '+' : ''}${p.toFixed(1)}%、持倉 ${o >= 0 ? '+' : ''}${o.toFixed(1)}%`;
  const lq = r.liq, oi = r.oiAll || r.oi, thr = oi ? oi * 0.0001 : 2e5;
  const s1 = lq?.short1h || 0, l1 = lq?.long1h || 0;
  if (p >= 0.8 && s1 >= thr && s1 >= 3 * l1) return { t: '空單被軋', d: `${nums}；OKX 近 1 小時空單爆倉 $${fmtUsd(s1)}（多單 $${fmtUsd(l1)}）` };
  if (p <= -0.8 && l1 >= thr && l1 >= 3 * s1) return { t: '多單被清', d: `${nums}；OKX 近 1 小時多單爆倉 $${fmtUsd(l1)}（空單 $${fmtUsd(s1)}）` };
  if (p >= 0.8 && o >= 1) return { t: '新多單進場', d: nums };
  if (p >= 0.8 && o <= -1) return { t: '空單回補', d: nums };
  if (p <= -0.8 && o >= 1) return { t: '新空單進場', d: nums };
  if (p <= -0.8 && o <= -1) return { t: '多單平倉', d: nums };
  if (Math.abs(p) < 0.8 && o <= -2) return { t: '多空同時減倉', d: nums };
  if (Math.abs(p) < 0.8 && o >= 2) return { t: '多空同時加倉', d: nums };
  return null;
}

// ---------- 籌碼數據面板（只列數據，不下判斷、不給方向、不計分）----------
// 依使用者文件的四層分類列出：持倉×價格、資金費率、CVD／大戶、爆倉與訂單簿。每行標來源；抓不到的明講原因，不用猜的補。
// 回傳 { layers: [{n, title, items: [文字], miss: [原因]}] }
const fmtUsd = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0));
const sg = (v, d = 1, u = '%') => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + u);
export function chipRef(r) {
  const L = [1, 2, 3, 4].map((n) => ({ n, title: ['持倉 × 價格', '資金費率', 'CVD／大戶', '爆倉與訂單簿'][n - 1], items: [], miss: [] }));
  const [l1, l2, l3, l4] = L;
  const ok = r.okxCvd, cvdR = r.cvdRatio ?? ok?.r24 ?? null, cvd4 = r.cvd4 != null ? r.cvd4 : ok?.r4 ?? null, cvdSrc = r.cvdRatio != null ? '幣安' : 'OKX';
  const spot4 = r.spotCvd4 != null ? r.spotCvd4 : r.okxSpot?.r4 ?? null, spotSrc = r.spotCvd4 != null ? '幣安現貨' : 'OKX 現貨';
  // 層 1
  if (r.chg24 == null || r.oiChg24 == null) l1.miss.push('持倉變化抓不到（來源交易所沒有持倉歷史）');
  else {
    l1.items.push(`24h：價格 ${sg(r.chg24)}、持倉 ${sg(r.oiChg24)}`);
    if (r.chg4 != null && r.oiChg4 != null) l1.items.push(`4h：價格 ${sg(r.chg4)}、持倉 ${sg(r.oiChg4)}`);
    if (r.oiSources) l1.items.push(`持倉合計 ${r.oiSources} 所（${r.exList ? r.exList.filter((v) => v.share != null).slice(0, 3).map((v) => `${v.ex} ${v.share.toFixed(0)}%`).join('、') : '—'}）`);
  }
  // 層 2
  if (r.funding == null) l2.miss.push('資金費率抓不到');
  else {
    l2.items.push(`加權 ${r.funding.toFixed(4)}%／8h`);
    if (r.fundingMax && r.fundingMin && r.exCount > 1) l2.items.push(`各所最高 ${r.fundingMax.ex} ${r.fundingMax.funding.toFixed(4)}%、最低 ${r.fundingMin.ex} ${r.fundingMin.funding.toFixed(4)}%`);
  }
  // 層 3
  if (cvdR == null) l3.miss.push('合約 CVD：幣安與 OKX 都抓不到主動買賣量');
  else l3.items.push(`合約 CVD 24h ${sg(cvdR)}（佔成交量，${cvdSrc}）` + (cvd4 != null && r.cvdRatio == null ? `；4h ${sg(cvd4)}` : ''));
  if (spot4 == null) l3.miss.push('現貨 CVD：幣安現貨與 OKX 現貨都抓不到');
  else l3.items.push(`現貨 CVD 4h ${sg(spot4)}（${spotSrc}）`);
  if (r.topLS != null) l3.items.push(`大戶持倉多空比 ${r.topLS.toFixed(2)}，24h 變化 ${sg(r.topLSChg, 2, '')}（幣安）`);
  else if (r.okxTop) l3.items.push(`大戶持倉多空比 ${r.okxTop.now.toFixed(2)}，24h 變化 ${sg(r.okxTop.chg, 2, '')}（OKX）`);
  else l3.miss.push('大戶持倉多空比：幣安與 OKX 都抓不到');
  if (r.globalLS != null) l3.items.push(`散戶多空比 ${r.globalLS.toFixed(2)}，24h 變化 ${sg(r.globalLSChg, 2, '')}（幣安）`);
  if (r.bybitLS != null) l3.items.push(`Bybit 散戶多空比 ${r.bybitLS.toFixed(2)}`);
  l3.miss.push('單筆 10 萬美元以上大單：需要逐筆成交串流，網站每 15 分鐘快照抓不到');
  // 層 4
  const lq = r.liq;
  if (!lq) l4.miss.push('爆倉：OKX 沒有這個幣，或這次抓取失敗');
  else if (!lq.n) l4.items.push('OKX 近期沒有爆倉單');
  else {
    const tot = lq.longUsd + lq.shortUsd, oi = r.oiAll || r.oi;
    l4.items.push(`OKX 近${lq.full ? '' : '約'} ${lq.hrs.toFixed(0)} 小時爆倉：多單 $${fmtUsd(lq.longUsd)}、空單 $${fmtUsd(lq.shortUsd)}` + (oi ? `（合計約全市場持倉的 ${((tot / oi) * 100).toFixed(2)}%）` : ''));
    if (lq.long1h + lq.short1h > 0) l4.items.push(`最近 1 小時：多單 $${fmtUsd(lq.long1h)}、空單 $${fmtUsd(lq.short1h)}`);
    l4.miss.push('爆倉只含 OKX 一家；清算熱力圖（預估爆倉價位）沒有免費來源');
  }
  const dp = r.depth;
  if (!dp) l4.miss.push('訂單簿：BingX 與 OKX 都沒抓到');
  else {
    for (const b of dp.bands) l4.items.push(`訂單簿 ±${b.pct}%：買單 $${fmtUsd(b.bid)}、賣單 $${fmtUsd(b.ask)}（${dp.src}）`);
    if (!dp.bands.length) l4.items.push(`訂單簿只涵蓋現價上下 ${dp.cover.toFixed(2)}%（流動性太密，抓不到更遠的）`);
    for (const [w, nm] of [[dp.bidWall, '買方最大一格'], [dp.askWall, '賣方最大一格']]) if (w && w.usd > 0) l4.items.push(`${nm}（0.1% 一格）：距現價 ${sg(w.dist, 1, '%')}、$${fmtUsd(w.usd)}`);
  }
  return { layers: L };
}

// 加密籌碼分（2026-11-01 重驗後大幅縮減）
// 原本的規則是在 1,441 筆 4H 諧波／CD 做多上挑出來的；2026-11-01 拿「沒用來找規則」的另一批訊號
// （4H CVD 轉正爆量＋放量上穿 0，812 筆做多）與 MACD 頂背離做空（149 筆）重驗，每筆 R 比「有／沒有條件」，按日重抽 90% 區間：
//   大戶加倉空單（持倉 24h >2% 且大戶多空比降）：諧波/CD +0.79R vs +0.12R，但 CVD 樣本外 +0.18R vs +0.24R（差 −0.06R，區間 −0.33～+0.27）
//     → 不是通用籌碼規則，拿掉（框架說這是新空進場偏空，回測在做空側也看不到差別：+0.62R vs +0.51R，區間 −0.72～+0.89）
//   24h 持倉 ≤ −4%：諧波 −0.05R vs +0.32R，但 CVD +0.50R vs +0.18R，兩批方向相反 → 拿掉
//   恐懼貪婪 ≥ 75：CVD 樣本外 +0.22R vs +0.23R → 拿掉
//   做空的資金費率／散戶多空比：MACD 做空 149 筆，差距區間跨 0（−1.05～+0.39、−0.88～+0.50）→ 拿掉
//   BTC 大盤籌碼（價格＋持倉、費率、大戶多空比）當濾網：兩批做多方向不一致，MACD 做空區間也跨 0 → 不計分
//   保留：資金費率 ≤ −0.01%（空方付費）做多 兩批都較好（諧波 +0.35R vs +0.17R、CVD +0.38R vs +0.20R；全幣事件研究 24h +0.37%、72h +0.64%，前後半段都正）→ +4
export function cryptoChip(r, dir) {
  let s = 0; const why = [];
  const f = r.funding;
  if (dir > 0) {
    if (f != null && f <= -0.01) { s += 4; why.push(`＋資金費率 ${f.toFixed(3)}%（空方付費）`); }
    // 2026-11-01 大戶持倉多空比 <1（大戶淨空）做多：初測 20 檔 4,620 筆 +0.69R vs +0.30R（前 +0.34／後 +0.66）；
    //   樣本外 122 檔 9,375 筆 +0.42R vs +0.11R（差 +0.31R，90% 區間 +0.12～+0.52，前 +0.30／後 +0.45）。bigBullD +0.63、cvdoUp12 +0.40 較明顯，
    //   cvdFlip12、cvdoUp4V 方向不穩（樣本小）。只有約 13% 的訊號符合；保守加 +8（做空沒有成立的規則）
    if (r.topLS != null && r.topLS > 0 && r.topLS < 1) { s += 8; why.push(`＋大戶持倉多空比 ${(+r.topLS).toFixed(2)}（<1，大戶偏空；回測做多多賺約 +0.3R）`); }
  }
  return { score: s, why };
}

// 每個保留策略的進出場計畫（止盈照回測最好又穩定的設定）
// 2026-11-08 搬到 BingX 資料後的重測結果（replay_result*.csv）：這些策略在 BingX 資料上沒過門檻，停止計分、只觀察
//   CVD 三個（cvdFlip12／cvdoUp4V／cvdoUp12）：CVD 靠真實主動買賣量，BingX 沒有，用成交量近似後後半段轉負
//   harmUp（前半 −0.07R）、pinLowL4（後半 −0.11R）、smcFlipL4（後半 −0.02R；用 4 所聚合成交量才過）
export const BX_OFF = new Set(['harmUp', 'pinLowL4', 'smcFlipL4', 'cvdFlip12', 'cvdoUp4V', 'cvdoUp12']);
function stratPlans(r) {
  const P = {}, why = [];
  const tp = (e, s, R, dir) => e + dir * R * Math.abs(e - s);
  const line = (k, tf, p, note) => {
    // BingX 資料重測沒過的策略：計畫照樣產生（數據記錄會追蹤實盤結果），但說明加「參考」→ 不顯示、不計分
    const key = Object.keys(P).find((kk) => P[kk] === p);
    if (key && BX_OFF.has(key)) note = '參考：BingX 資料重測未通過，已停用計分，僅觀察';
    why.push(`【${k}】${tf}：進場 ${px(p.entry)}・停損 ${px(p.stop)}（${(Math.abs(p.entry - p.stop) / p.entry * 100).toFixed(1)}%）・目標 ${px(p.target)}（${(Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop)).toFixed(1)}R）${note ? '・' + note : ''}`);
  };
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
  // 維加斯通道 4H 做多：進場＝突破 K 高點、停損＝回踩低點；目標＝固定 6R（2026-11-05 回測：固定 6R 優於前高結構目標，4H 做多 訓 +0.16／驗 +0.04R）
  const v = r.vg4?.now;
  if (v && v.status === '確認' && v.dir > 0 && v.ago <= 2) {
    const e = +v.entry, s = +v.stop, risk = e - s;
    const t = e + 6 * risk;
    const p = { entry: e, stop: s, target: t, tf: '4H', bars: v.ago, wait: false };
    P.vegasLong = p; line('參考：維加斯通道做多', `4H ${v.tunnel}通道，${v.ago} 根前確認`, p, '近一年 +0.47R，但 4 年回測前半段虧，不計分');
  }
  // 維加斯通道 4H 做空：觀察中（只寫進「數據記錄」，不計分、不顯示）；回測 4H +0.16R 但有衰退跡象，累積即時資料再決定
  if (v && v.status === '確認' && v.dir < 0 && v.ago <= 2) {
    const e = +v.entry, s = +v.stop, risk = s - e;
    if (risk > 0) {
      const t = e - 6 * risk; // 2026-11-05：固定 6R（4H 做空 +0.28R 對結構目標 +0.15R；近期 2026 衰退，仍觀察中）
      const p = { entry: e, stop: s, target: t, tf: '4H', bars: v.ago, wait: false };
      P.vegasShort = p; line('參考：維加斯通道做空', `4H ${v.tunnel}通道，${v.ago} 根前確認`, p, '觀察中，不計分');
    }
  }
  // 諧波 D 點完成（只做多）：停損 D 外 2 倍 ATR，4R 全出
  const h = r.harm4;
  const T = r.tun;
  // BTC 大盤暫停：BTC 24h 跌幅 ≤ −2% 時不給 4H 諧波 D 點做多（2026-11-01 回測：31 幣 1,440 筆，
  // 諧波 D 點 −0.18R vs 沒下跌 +0.58R，差 −0.76R、區間 −1.11～−0.42；另外 11 個沒參與挑規則的幣也同方向 −0.78R；
  // 逐年 2024／2025 明顯、2023 相反）。CD 做多在 BTC 下跌時只有 6 筆、CVD 做多不受影響（甚至較好）→ 只暫停諧波 D 點
  const btcDump = r.btc24 != null && r.btc24 <= -2;
  if (h && h.dir > 0 && !h.weak && !btcDump) {
    const p = { entry: h.plan.entry, stop: h.plan.stop, tf: '4H', bars: h.ago, wait: false };
    // 2026-11-01 全幣種重驗：維加斯通道加成 3R 只有 +0.03R、6R 逐年不穩（328 筆）→ 不再單獨計分，統一算「諧波 D 點」
    void T;
    p.target = tp(p.entry, p.stop, 6, 1); P.harmUp = p;
    line(`諧波 ${h.name} D 點完成`, `4H，D 點 ${h.ago} 根前`, p, '6R 全出（全幣種重驗 820 檔、高流動樣本外 2,913 筆 +0.10R，隨機 −0.01R）');
  }
  // CRT：前一天區間被掃 → 30 分 CHoCH → 回 FVG 掛單；停損掃針低點、3R 全出（4 個月回測 +0.08R）
  if (r.crt) {
    const c = r.crt, k = c.dir > 0 ? 'crtLong' : 'crtShort';
    const p = { entry: c.entry, stop: c.stop, target: c.target, tf: '30m', bars: c.ago, wait: c.state === 'wait' };
    P[k] = p; line(`CRT 前日區間${c.dir > 0 ? '低點被掃→做多' : '高點被掃→做空'}`, `30 分，${c.state === 'wait' ? '等回 FVG 掛單' : c.ago + ' 根前成交'}`, p, '參考：4 個月回測 +0.08R，未達 +0.10R 門檻，不計分');
  }
  // 諧波 CD 段：做多 1R 出一半、停損移保本、剩下 3R；做空 2R 出一半、剩下 4R
  for (const x of r.harmCD || []) {
    if (!(x.state === 'wait' || x.ago <= 3)) continue;
    const k = x.dir > 0 ? 'harmCDLong' : 'harmCDShort';
    if (P[k]) continue;
    const p = { entry: x.entry, stop: x.stop, tf: '4H', bars: x.state === 'wait' ? null : x.ago, wait: x.state === 'wait' };
    p.target = tp(p.entry, p.stop, x.dir > 0 ? 4 : 2, x.dir); P[k] = p;
    line(`諧波 ${x.name} CD 段${x.dir > 0 ? '做多' : '做空'}`, x.state === 'wait' ? '4H，等突破／跌破 B' : `4H，${x.ago} 根前觸發`, p, x.dir > 0 ? '參考：全幣種重驗 1,007 筆 4R −0.10R，不計分' : '參考：2R 回測 +0.07R，未達門檻，不計分');
  }
  // PAI 使用者規則：前一次超買後超賣 ≥2 次 → 第一次超買 → 離開超買（Z 跌回 80 以下）做多；停損 10 根低點
  for (const [k, x, tf, R, note] of [['paiRevD', r.paiRevD, '1D', 4, '參考：回測 +0.98R 但只有 24 筆，樣本太少，不計分'], ['paiRev12', r.paiRev12, '12H', 3, '參考：全幣種重驗樣本外 312 筆 +0.03R，不計分']]) {
    // 停損超過 25% 不列（新幣暴跌後會出現 70% 以上的停損；回測排除後 12H 仍 +0.37R、1D +0.98R）
    if (!x || !(x.entry > x.stop) || (x.entry - x.stop) / x.entry > 0.25) continue;
    const p = { entry: x.entry, stop: x.stop, tf, bars: x.ago, wait: false };
    p.target = tp(p.entry, p.stop, R, 1); P[k] = p;
    line(`PAI 連續超賣 ${x.k} 次後第一次超買、離開超買做多`, `${tf}，${x.ago === 0 ? '剛確認' : x.ago + ' 根前'}`, p, note);
  }
  // CVD：連跌後轉正爆量（使用者規則）＞連跌後放量上穿 0＞單純上穿 0；同一個時區只取最強的一個，兩個時區也只算一個（沒有回測過共振）
  const cvdList = [
    ['cvdFlip12', r.cvdFlip12, '12H', 10, 'CVD 連跌後轉正爆量', '10R 全出，最長抱 60 天（樣本外 325 筆 +0.57R，前 +0.59／後 +0.55，隨機同出場 +0.11R；勝率約 26%，原 4R 為 +0.29R）'],
    ['cvdoUp12', r.cvdo12, '12H', 6, 'CVD Oscillator 上穿 0', '6R 全出（全幣種重驗樣本外 6,828 筆 +0.12R，隨機 +0.02R）'],
    ['cvdoUp4V', r.cvdo4s, '4H', 10, 'CVD Oscillator 連跌後放量上穿 0', '10R 全出，最長抱 40 天（樣本外 2,094 筆 +0.26R，前 +0.21／後 +0.31，隨機同出場 +0.04R；勝率約 20%，原 6R 為 +0.18R）'],
    ['cvdFlip4', r.cvdFlip4, '4H', 4, 'CVD 連跌後轉正爆量（幣安真實主動買賣）', '參考：全幣種重驗樣本外 575 筆 0R，不計分'],
    ['cvdoUp4', r.cvdo4, '4H', 6, 'CVD Oscillator 上穿 0', '參考：全幣種重驗樣本外 +0.08R，未達門檻，不計分'],
  ];
  for (const [k, x, tf, R, name, note] of cvdList) {
    if (!x || !(x.entry > x.stop) || (x.entry - x.stop) / x.entry > 0.25) continue;
    if (['cvdFlip12', 'cvdoUp12', 'cvdFlip4', 'cvdoUp4V', 'cvdoUp4'].some((q) => P[q])) continue;
    const p = { entry: x.entry, stop: x.stop, tf, bars: x.ago, wait: false };
    p.target = tp(p.entry, p.stop, R, 1); P[k] = p;
    line(name, `${tf}，${x.ago === 0 ? '剛出現' : x.ago + ' 根前'}`, p, note);
  }
  // 結構訂單塊（使用者規則；2026-11-02 回測）：做多 5R／做空 4R 全出（止盈對照回測：固定 R 贏過前高低、反向訂單塊、SNR、POC、缺口；做多拉高到 6～8R 更好、做空 3～4R 就夠）；停損＝訂單塊外側 0.1ATR，超過 25% 不列
  for (const [k, x, tf, hold, name, note] of [
    ['smcFlipL4', r.smc4 && r.smc4.smcFlipL4, '4H', 120, '4H 突破空方訂單塊（收盤突破當根）＋CVD 動能＋MACD 底背離（做多）', '5R 全出，最長抱 20 天（樣本外 588 筆：3R +0.32R、5R 約 +0.55R，贏隨機；前後半都為正；幣種奇偶組 +0.24／+0.40；2020、2022 年持平或略負；勝率約 34%）'],
    ['smcFlipS4', r.smc4 && r.smc4.smcFlipS4, '4H', 120, '4H 跌破多方訂單塊（收盤跌破當根）＋CVD 動能＋維加斯壓力（做空）', '4R 全出，最長抱 20 天（樣本外 612 筆：3R +0.27R、4R 約 +0.37R，前 +0.39／後 +0.14；幣種奇偶組 +0.15／+0.39；2020、2026 年略負；勝率約 36%）'],
    ['pinLowL4', r.pin4 && r.pin4.pinLowL4, '4H', 120, '4H 低位 Pinbar：下影 ≥60%、實體 ≤25%、全長 ≥1ATR、近 60 根底部 15% 且已跌 >15%（做多）', '5R 全出，最長抱 20 天（樣本外 949 筆：3R +0.17R／5R +0.23R；前半 +0.32／後半 +0.15；去掉最集中 5 天仍 +0.20R；日聚類區間跨 0，給分只算回測的一半；勝率約 25%）'],
    ['smcObL4', r.smc4 && r.smc4.smcObL4, '4H', 120, '4H 結構訂單塊回測守住（BOS／CHoCH 後）＋CVD 動能（做多，觀察）', '觀察用、不計分：回測 817 筆 3R 僅 +0.04R、未達 +0.10R 門檻，只記錄實盤結果'],
    ['smcFlipL12', r.smc12 && r.smc12.smcFlipL12, '12H', 90, '12H 突破空方訂單塊（收盤突破當根）＋CVD 動能＋維加斯支撐（做多，觀察）', '觀察用、不計分：回測 343 筆 3R +0.36R／5R +0.46R，但與 12H 訂單塊回測高度重疊、打亂旗標對照後不夠穩，累積實盤再決定'],
    ['smcObS12', r.smc12 && r.smc12.smcObS12, '12H', 90, '12H 結構訂單塊回測（做空）＋CVD 動能（觀察）', '觀察用、不計分：回測 145 筆 3R −0.10R（不合格），作為對照記錄'],
    ['smcObL12', r.smc12 && r.smc12.smcObL12, '12H', 90, '12H 結構訂單塊回測守住（BOS／CHoCH 後）＋CVD 動能（做多）', '5R 全出，最長抱 45 天（樣本外 249 筆：3R +0.46R、5R 約 +0.49R；前 +0.64／後 +0.28；5／7 年為正；停損中位 11%，勝率約 39%）'],
  ]) {
    if (!x || x.ago > 1) continue;
    const dir = x.side;
    if (!((x.entry - x.stop) * dir > 0) || Math.abs(x.entry - x.stop) / x.entry > 0.25) continue;
    const p = { entry: x.entry, stop: x.stop, tf, bars: x.ago, wait: false };
    p.target = tp(p.entry, p.stop, dir > 0 ? 5 : 4, dir); P[k] = p; void hold;
    line(name, `${tf}，${x.ago === 0 ? '剛收盤' : '1 根前'}`, p, note);
  }
  // 圖表型態（2026-11-03）：ATR 之字轉折＋幾何規則，收盤突破頸線→下一根開盤進場，停損＝型態低點下 0.1ATR，超過 25% 不列
  // 54 組參數（時區 4H／12H／1D × 轉折尺度 × 容錯 × 過濾 × 3 種目標）前 75% 日期挑參數、後 25% 日期驗證；日聚類 90% 區間是「驗證期減同出場隨機進場」
  for (const [k, x, tf, R, name, note] of [
    ['pDbl12', r.pat12 && r.pat12.pDbl12, '12H', 4, '12H 雙底（兩低點差 ≤4%、中間反彈 ≥2ATR、左右時間對稱）收盤突破頸線（做多）', '4R 全出（驗證期 193 筆 +0.43R，隨機 +0.08R；超額區間 +0.06～+0.64；挑選期 543 筆 +0.46R；勝率約 25%）'],
    ['pTri4', r.pat4 && r.pat4.pTri4, '4H', 4, '4H 三重底（三個低點差 ≤4%）收盤突破頸線（做多）', '4R 全出（驗證期 169 筆 +0.44R，隨機 −0.10R；超額區間 +0.29～+0.78；挑選期 245 筆 +0.39R；驗證期只有約 8 個月、偏多頭行情）'],
    ['pRect4', r.pat4 && r.pat4.pRect4, '4H', 4, '4H 矩形整理（上下沿各兩次碰觸、差 ≤4%、高度 ≥2ATR）向上突破（做多）', '4R 全出（驗證期 253 筆 +0.38R，隨機 −0.01R；超額區間 +0.16～+0.62；挑選期 532 筆 +0.23R；做空版驗證期轉負）'],
    ['pDbl4', r.pat4 && r.pat4.pDbl4, '4H', 3, '4H 雙底（兩低點差 ≤2%）收盤突破頸線（做多）', '3R 全出（驗證期 684 筆 +0.26R，隨機 +0.02R；超額區間 +0.07～+0.44；挑選期 1,990 筆 +0.12R，優勢比 12H 小，只算觀察）'],
    ['pAsc4', r.pat4 && r.pat4.pAsc4, '4H', 4, '4H 上升三角形（高點持平、低點墊高）向上突破（做多）', '4R 全出（驗證期 181 筆 +0.19R，隨機 −0.18R；超額區間 +0.08～+0.66；挑選期 560 筆 +0.21R，只算觀察）'],
  ]) {
    if (!x || x.ago > 1) continue;
    if (!(x.entry > x.stop) || (x.entry - x.stop) / x.entry > 0.25) continue;
    const p = { entry: x.entry, stop: x.stop, tf, bars: x.ago, wait: false };
    p.target = tp(p.entry, p.stop, R, 1); P[k] = p;
    line(name, `${tf}，${x.ago === 0 ? '剛收盤' : '1 根前'}`, p, note);
  }
  // 底部早進場（2026-11-04）：型態一成形（最後一個低點被反彈確認）就在下一根開盤進場，不等突破頸線；停損＝型態低點下 0.1ATR、4R 全出
  // 幣安成交額前 150 名、2020–2026；每個型態、每個時區各自在 27 組參數 × 5 種確認 × 3 種目標裡用前 75% 日期挑，後 25%（2025-11 之後）驗證；
  // 另外要求全期每筆報酬贏同期持有 BTC。2022、2025 兩個空頭年接近 0 或虧損。
  for (const [k, x, tf, name, note] of [
    ['eTri12', r.early12 && r.early12.eTri12, '12H', '12H 三重底（第三個低點確認）早進場（做多）', '4R 全出（驗證期 347 筆 +0.51R，隨機 −0.02R；超額區間 +0.24～+0.84；挑選期 923 筆 +0.32R；每筆贏同期 BTC +0.5%）'],
    ['eDia12', r.early12 && r.early12.eDia12, '12H', '12H 菱形底（擴散後再收斂）早進場（做多）', '4R 全出（驗證期 135 筆 +0.42R，隨機 −0.06R；超額區間 +0.07～+0.91；挑選期 389 筆 +0.30R；每筆贏同期 BTC +1.3%；樣本少）'],
    ['eDbl12', r.early12 && r.early12.eDbl12, '12H', '12H 雙底（第二個低點確認）早進場（做多）', '4R 全出（驗證期 1,260 筆 +0.25R，隨機 +0.01R；超額區間 +0.06～+0.43；挑選期 3,962 筆 +0.17R；全期每筆與持有 BTC 打平，只算觀察）'],
    ['eRect12', r.early12 && r.early12.eRect12, '12H', '12H 矩形整理底部早進場（做多）', '4R 全出（驗證期 1,039 筆 +0.28R，隨機 +0.01R；超額區間 +0.09～+0.45；挑選期 3,153 筆 +0.15R；全期每筆輸同期 BTC 0.1%，只算觀察）'],
    ['eDbl1d', r.early1d && r.early1d.eDbl1d, '1D', '日線雙底早進場（做多）', '4R 全出、最長 40 天（驗證期 199 筆 +0.86R，隨機 +0.15R；超額區間 +0.22～+1.24；挑選期 713 筆 +0.37R；每筆贏同期 BTC +1.0%）'],
    ['eRect1d', r.early1d && r.early1d.eRect1d, '1D', '日線矩形整理底部早進場（做多）', '4R 全出、最長 40 天（驗證期 267 筆 +0.64R，隨機 +0.03R；超額區間 +0.25～+0.93；挑選期 809 筆 +0.34R；每筆贏同期 BTC +0.5%）'],
    ['eTri1d', r.early1d && r.early1d.eTri1d, '1D', '日線三重底早進場（做多）', '4R 全出、最長 40 天（驗證期 176 筆 +0.67R，隨機 −0.07R；超額區間 +0.32～+1.18；挑選期 593 筆 +0.41R；每筆贏同期 BTC +0.2%）'],
  ]) {
    if (!x || x.ago > 1) continue;
    if (!(x.entry > x.stop) || (x.entry - x.stop) / x.entry > 0.25) continue;
    const p = { entry: x.entry, stop: x.stop, tf, bars: x.ago, wait: false };
    p.target = tp(p.entry, p.stop, 4, 1); P[k] = p;
    line(name, `${tf}，${x.ago === 0 ? '剛成形' : '1 根前成形'}`, p, note);
  }
  // 日線大陽線突破 POC 做多（使用者訂單流策略二）：停損＝這根最低點，4R 全出；停損超過 25% 不列
  {
    const x = r.pocD;
    if (x && x.stop < x.entry && (x.entry - x.stop) / x.entry <= 0.25) {
      const p = { entry: x.entry, stop: x.stop, tf: '1D', bars: 0, wait: false };
      p.target = tp(p.entry, p.stop, 4, 1); P.pocBreakD = p;
      line('日線大陽線突破 POC（價格原本在 POC 下方）', '1D，剛收盤', p, '4R 全出（895 幣回測 342 筆 +0.67R，隨機做多 +0.07R；單純大陽線也有 +0.40R）');
    }
  }
  // 日線大陽線（實體 ≥1.5ATR）做多：2026-11-01 全幣種重驗（成交額前 150 名、不含原 31 幣）1,811 筆 4R +0.27R（前 +0.36／後 +0.19，隨機 +0.02R）；
  // BTC 日線在 50 日線上：1,340 筆 +0.37R、之下 0R（逐年 2022、2025 仍虧）→ 只在 BTC 站上 50 日線時給分。已有 POC 突破就不重複
  {
    const x = r.bigD;
    if (x && !P.pocBreakD && r.btcUp !== false && x.stop < x.entry && (x.entry - x.stop) / x.entry <= 0.25) {
      const p = { entry: x.entry, stop: x.stop, tf: '1D', bars: 0, wait: false };
      p.target = tp(p.entry, p.stop, 6, 1); P.bigBullD = p;
      line('日線大陽線（實體 ≥1.5ATR，BTC 站上 50 日線）', '1D，剛收盤', p, '6R 全出，最長抱 60 天（樣本外 1,255 筆 +0.54R，前 +0.67／後 +0.41，隨機同出場 +0.03R；勝率約 29%，原 4R 為 +0.39R）');
    }
  }
  // 日線 POC 空方吞噬做空：價格在 POC 上方，這根陰線碰到 POC 並吞噬前一根陽線；停損＝這根最高點、4R 全出
  // 2026-11-01 回測樣本外 1,260 筆 +0.34R（區間 +0.16～+0.51）、原 31 幣 844 筆 +0.31R，隨機 −0.02R；2020、2026 年偏弱，所以分數設保守（0.20）
  {
    const x = r.engD;
    if (x && x.stop > x.entry && (x.stop - x.entry) / x.entry <= 0.25) {
      const p = { entry: x.entry, stop: x.stop, tf: '1D', bars: 0, wait: false };
      p.target = tp(p.entry, p.stop, 8, -1); P.pocEngD = p;
      line('日線 POC 空方吞噬（價格在 POC 上方，碰到 POC 後陰線吞噬前一根陽線）', '1D，剛收盤', p, '8R 全出，最長抱 60 天（樣本外 1,321 筆 +0.39R，前 +0.32／後 +0.46，隨機同出場 +0.03R；勝率約 24%，原 4R 為 +0.32R）');
    }
  }
  // MACD 柱狀體波峰頂背離做空（使用者規則）：停損＝這段最高點；停損超過 25% 不列
  {
    const a = r.macdTop4, b = r.macdTop12, dd = r.macdTop1D;
    const add = (k, x, tf, R, name, note) => {
      if (!x || !(x.stop > x.entry) || (x.stop - x.entry) / x.entry > 0.25) return;
      const p = { entry: x.entry, stop: x.stop, tf, bars: x.ago, wait: false };
      p.target = tp(p.entry, p.stop, R, -1); P[k] = p;
      line(name, `${tf}，${x.ago === 0 ? '剛確認' : x.ago + ' 根前'}`, p, note);
    };
    // 2026-10-29 用幣安全部 USDT 永續重驗（原本 31 幣以外的新樣本）：
    //   4H 連續頂背離 ≥2：全部 680 筆 4R +0.24R（新樣本 457 筆 +0.17R，隨機 −0.07R）→ 保留，改 4R
    //   4H、12H「頂背離＋價格還在創高」新樣本 −0.11R／−0.02R → 拿掉（原本 31 幣的好成績樣本外不成立）
    void b;
    if (a && a.k >= 2) add('macdTopDiv4C', a, '4H', 4, `MACD 柱狀體連續頂背離 ${a.k} 次`, '4R 全出（全幣種重驗 820 檔、高流動樣本外 398 筆 +0.11R，隨機 −0.04R）');
    // 日線：幣安全部 USDT 永續 2020 年起、日成交額 ≥500 萬美元的幣（180 筆）3R +0.33R（前 +0.27／後 +0.42，隨機 −0.04R）
    if (!P.macdTopDiv4C && dd && dd.still) add('macdTopDiv1D', dd, '1D', 3, 'MACD 柱狀體頂背離（價格還在創高）', '參考：全幣種重驗樣本外 91 筆（前半段虧），樣本不足，不計分');
  }
  { const l = paiLine(r.pai, 'crypto', '4H'); if (l) why.push(l); }
  // 只顯示回測有賺、達到門檻的策略；標「參考」的一律不顯示
  r.plans = P; r.stratWhy = why.filter((l) => !l.includes('參考'));
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
  if (r.taker != null && r.taker >= 1.2) s.push('takerBuy'); // BingX 沒有主動買賣比 → taker 為 null，不能讓 null 被當成 0
  if (r.taker != null && r.taker <= 0.83) s.push('takerSell');
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
  const [oiH, top, glob, taker, k1, k4, kd, ks, k30, k12] = await Promise.all([
    getJSON(`${BINANCE}/futures/data/openInterestHist?symbol=${s}&period=1h&limit=180`).catch(() => []), // BingX 沒有持倉／大戶多空比歷史 → 空陣列，這些欄位當作沒有
    getJSON(`${BINANCE}/futures/data/topLongShortPositionRatio?${q}`).catch(() => []),
    getJSON(`${BINANCE}/futures/data/globalLongShortAccountRatio?${q}`).catch(() => []),
    getJSON(`${BINANCE}/futures/data/takerlongshortRatio?symbol=${s}&period=1h&limit=4`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=1h&limit=25`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=4h&limit=499`).catch(() => []),
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=1d&limit=120`).catch(() => []),
    // 現貨 1H K（主動買入量），算現貨 CVD；沒有現貨的幣會失敗，當作沒有
    getJSON(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=1h&limit=5`).catch(() => []),
    // CRT 用 30 分 K（AMD、Omor OTE 重新回測扣費後虧損，沒有加）
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=30m&limit=99`).catch(() => []),
    // CVD Oscillator 12H（EMA200 需要夠長的歷史）
    getJSON(`${BINANCE}/fapi/v1/klines?symbol=${s}&interval=12h&limit=500`).catch(() => []),
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
  const barsD = kd.slice(0, -1).map((k) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  const bars4h = k4.slice(0, -1).map((k) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], d: 2 * +k[10] - +k[7] }));
  const b12 = k12.slice(0, -1).map((k) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], t: +k[0] }));
  // 整理期間（突破前 7 天）持倉變化
  const oi = oiH.slice(-25);
  const oiBoxChg = oiH.length >= 16 ? pct(+oiH[oiH.length - 9].sumOpenInterestValue, +oiH[0].sumOpenInterestValue) : null;
  const hi = kl.length ? Math.max(...kl.map((k) => +k[2])) : null;
  const lo = kl.length ? Math.min(...kl.map((k) => +k[3])) : null;
  if (!k4.length) return null;
  const hasChip = oi.length && top.length && glob.length; // 幣安才有；BingX 沒有 → 籌碼欄位為 null，之後由其他交易所資料補
  const oiNow = oi.length ? +last(oi).sumOpenInterestValue : null;
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
    oiChg24: hasChip ? pct(oiNow, +oi[0].sumOpenInterestValue) : null,
    oiChg4: hasChip ? pct(oiNow, +oi[Math.max(0, oi.length - 5)].sumOpenInterestValue) : null,
    topLS: top.length ? +last(top).longShortRatio : null,
    topLSChg: top.length ? +last(top).longShortRatio - +top[0].longShortRatio : null,
    topLong: top.length ? +last(top).longAccount * 100 : null,
    globalLS: glob.length ? +last(glob).longShortRatio : null,
    globalLSChg: glob.length ? +last(glob).longShortRatio - +glob[0].longShortRatio : null,
    taker: taker.length ? taker.reduce((a, x) => a + +x.buySellRatio, 0) / taker.length : null,
    spark: oi.map((x) => +x.sumOpenInterestValue),
    chipSrc: hasChip ? 'binance' : null,
    // 真實 CVD 需要主動買賣量（幣安才有）；BingX 的 k[10] 是 OHLCV 近似，不拿來顯示成 CVD
    cvd24: hasChip && kl.length ? cum : null,
    cvd4: hasChip && kl.length ? buyMinusSell4 : null,
    cvdRatio: hasChip && quoteSum ? (cum / quoteSum) * 100 : null, // CVD 佔 24h 成交額 %
    cvdSpark: hasChip ? cvdSpark : [],
    brk: bars4h.length >= 22 ? (() => { const L = bars4h[bars4h.length - 1], P = bars4h.slice(-21, -1); return { up: L.c >= Math.max(...P.map((b) => b.h)), dn: L.c <= Math.min(...P.map((b) => b.l)) }; })() : null, // 最近一根已收盤 4H 是否收在前 20 根高／低之外
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
    pocD: pocBreak(barsD),
    bigD: bigBull(barsD),
    engD: pocEngulfShort(barsD),
    cvdo4: cvdoCross(bars4h),
    cvdo4s: cvdoCrossStrong(bars4h),
    cvdo12: cvdoCross(b12),
    cvdFlip4: cvdFlip(bars4h, true),
    cvdFlip12: cvdFlip(b12),
    pin4: pinLowSignals(bars4h),
    pat4: patSignals(bars4h, ['pDbl4', 'pTri4', 'pRect4', 'pAsc4']),
    pat12: patSignals(b12, ['pDbl12']),
    early12: earlySignals(b12, ['eTri12', 'eDia12', 'eDbl12', 'eRect12']),
    early1d: earlySignals(dailyFrom12h(b12), ['eRect1d', 'eTri1d', 'eDbl1d']),
    smc4: smcSignals(bars4h, [
      ['smcFlipL4', (e) => e.kind === 'FLIP' && e.side > 0 && e.cvd && e.macd],
      ['smcFlipS4', (e) => e.kind === 'FLIP' && e.side < 0 && e.cvd && e.vegas],
      ['smcObL4', (e) => (e.kind === 'BOS' || e.kind === 'CHoCH') && e.side > 0 && e.cvd],
    ]),
    smc12: smcSignals(b12, [
      ['smcObL12', (e) => (e.kind === 'BOS' || e.kind === 'CHoCH') && e.side > 0 && e.cvd],
      ['smcFlipL12', (e) => e.kind === 'FLIP' && e.side > 0 && e.cvd && e.vegas],
      ['smcObS12', (e) => (e.kind === 'BOS' || e.kind === 'CHoCH') && e.side < 0 && e.cvd],
    ]),
    macdTop4: macdTopDiv(bars4h),
    macdTop12: macdTopDiv(b12),
    macdTop1D: macdTopDiv(barsD),
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
  // BTC 日線是否站上 50 日均線（最後一根已收盤日線）：多打 1 個請求，抓不到就不設濾網
  let btcUp = null;
  try {
    const kb = await getJSON(`${BINANCE}/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200`);
    const cl = kb.slice(0, -1).map((k) => +k[4]);
    if (cl.length >= 100) { let e = cl[0]; const a = 2 / 51; for (let i = 1; i < cl.length; i++) e = cl[i] * a + e * (1 - a); btcUp = cl[cl.length - 1] > e; }
  } catch {}
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
  // BTC 24h 漲跌：直接取本來就抓的 24hr ticker，不多打請求
  const btcT = tickers.find((t) => t.symbol === 'BTCUSDT');
  const btc24 = btcT ? +btcT.priceChangePercent : null;
  for (const r of rows) { r.fng = fng; r.btc24 = btc24; r.btcUp = btcUp; r.signals = cryptoSignals(r); }
  if (!rows.length) throw new Error('幣安沒有回傳任何合約資料');
  return { updatedAt: Date.now(), source: 'BingX USDT 永續合約', rows };
}
