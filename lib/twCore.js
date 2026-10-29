// 台股訊號（前端與後端警報共用）：日 K 型態 + 箱體結構 + CHoCH，加上法人／融資確認
import { structSignals, obSignals, cdSignals } from './cryptoCore.js';
import { paiLine } from './pai.js';

const pxT = (v) => (v >= 100 ? v.toFixed(1) : v.toFixed(2));

export const TW_SIGNALS = {
  twCDVegas:      { label: '日線諧波 CD 段＋維加斯多頭', dir: 1, alert: true },
  twHarmDayVegas: { label: '日線諧波 D 點＋維加斯多頭', dir: 1, alert: true },
  twHarmCDDay:    { label: '日線諧波 CD 段做多', dir: 1, alert: true },
  twVegasDay:     { label: '日線維加斯通道做多', dir: 1, alert: true },
  twHarm4h:       { label: '4H 諧波 D 點做多', dir: 1, alert: true },
  twCD4h:         { label: '4H 諧波 CD 段做多', dir: 1, alert: true },
  twHarmDay:      { label: '日線諧波 D 點做多', dir: 1, alert: true },
  twPai80:        { label: 'PAI 進入超買做多（日線）', dir: 1, alert: true },
  chochDayUp:  { label: '日線 CHoCH 轉強', dir: 1, alert: true },
  chochTw1hUp: { label: '1H CHoCH 轉強', dir: 1, alert: true },
  chochHarmUp: { label: 'CHoCH 訂單塊＋同向諧波', dir: 1, alert: true },
  chochDown:   { label: '上漲後首次 CHoCH 轉弱', dir: -1, alert: true },
  chochDownClean: { label: '上漲中無深回調', dir: -1, alert: true },
  chochUp:     { label: '下跌後首次 CHoCH 轉強', dir: 1, alert: true },
  chochUpClean: { label: '下跌中無深反彈', dir: 1, alert: true },
  harmCPreLong: { label: '諧波 C 點成形（預告做多）', dir: 1, alert: true },
  harmCPreLongPlus: { label: '諧波 C 點＋籌碼確認', dir: 1, alert: true },
  harmCDLong:  { label: '諧波 CD 段做多', dir: 1, alert: true },
  harmCDShort: { label: '諧波 CD 段做空', dir: -1, alert: true },
  harmCDLongPlus:  { label: '諧波 CD 段＋籌碼確認', dir: 1, alert: true },
  harmCDShortPlus: { label: '諧波 CD 段＋籌碼確認', dir: -1, alert: true },
  harmUp:      { label: '諧波看漲完成', dir: 1, alert: true },
  harmDown:    { label: '諧波看跌完成', dir: -1, alert: true },
  harmWeakUp:  { label: '諧波看漲（低勝率型態）', dir: 1 },
  harmWeakDown:{ label: '諧波看跌（低勝率型態）', dir: -1 },
  chochBosUp:   { label: 'CHoCH 後第二次突破（趨勢延續）', dir: 1, alert: true },
  chochBosDown: { label: 'CHoCH 後第二次跌破（趨勢延續）', dir: -1, alert: true },
  dBoxLong:    { label: '日線大箱底做多', dir: 1, alert: true },
  dBoxShort:   { label: '日線大箱頂做空', dir: -1, alert: true },
  boxLong:     { label: '短箱底做多', dir: 1, alert: true },
  boxShort:    { label: '短箱頂做空', dir: -1, alert: true },
  hiBoxBreak:  { label: '高位小箱跌破', dir: -1, alert: true },
  loBoxBreak:  { label: '低位小箱突破', dir: 1, alert: true },
  pullLong:    { label: '多頭回踩箱體反彈', dir: 1, alert: true },
  pullShort:   { label: '空頭反彈箱體遇壓', dir: -1, alert: true },
  retestLong:  { label: '短箱突破回踩', dir: 1, alert: true },
  retestShort: { label: '短箱跌破回抽', dir: -1, alert: true },
  revRetestLong:  { label: '空頭短箱突破回踩・反轉', dir: 1, alert: true },
  revRetestShort: { label: '多頭短箱跌破回抽・反轉', dir: -1, alert: true },
  boxLongPlus: { label: '多重籌碼確認', dir: 1, alert: true },
  boxShortPlus:{ label: '多重籌碼確認', dir: -1, alert: true },
  baseBreak:   { label: '築底突破', dir: 1, alert: true },
  botTurn:     { label: '大跌後轉強啟動', dir: 1, alert: true },
  topTurn:     { label: '大漲後轉弱啟動', dir: -1, alert: true },
  topWarn:     { label: '大漲後高位警戒', dir: -1, alert: true },
  boxBreakDown:{ label: '整理後跌破', dir: -1, alert: true },
  stealthBuy:  { label: '法人逆勢偷買', dir: 1, alert: true },
  stealthSell: { label: '法人逢高偷賣', dir: -1, alert: true },
  macdBull2:   { label: '日線 MACD 持續底背離', dir: 1, alert: true },
  macdBear2:   { label: '日線 MACD 持續頂背離', dir: -1, alert: true },
  macdBull:    { label: '日線 MACD 底背離', dir: 1 },
  macdBear:    { label: '日線 MACD 頂背離', dir: -1 },
  coilUp:      { label: '築底吸籌', dir: 1, alert: true },
  coilDown:    { label: '高檔出貨', dir: -1, alert: true },
  trustBuy:    { label: '投信連買', dir: 1 },
  foreignBuy:  { label: '外資連買', dir: 1 },
  bothBuy:     { label: '土洋同買', dir: 1 },
  concentrate: { label: '籌碼集中', dir: 1 },
  bigRatio:    { label: '法人買超佔量大', dir: 1 },
  trustSell:   { label: '投信連賣', dir: -1 },
  foreignSell: { label: '外資連賣', dir: -1 },
  shortUp:     { label: '融券大增', dir: 0 },
};

// 台股型態訊號：日 K 型態 + 當天法人與融資確認
// 台股的籌碼確認：資金流 = 法人今天買 / 投信連買 / 外資連買；輔助 = 融資減少、法人 5 日買超
// 台股籌碼分（2026-10-29 回測：113 檔、5 年法人資料，看諧波 D 點做多「有／沒有」這個條件的差別）
//   法人今日買超 +0.17R vs 沒有 +0.02R → +6；法人買超佔成交量 ≥20% +0.17R（前段 +0.27／後段 +0.07）→ +4
//   投信連買 ≥3 天 +0.13R（40 筆）→ +2；逆勢偷買 +0.20R（15 筆）→ +3；法人今日賣超 +0.03R vs +0.17R → −4
//   外資連買、土洋同買單獨看之後 5～20 天報酬都沒有比較好（甚至較差），不加分
export function twChip(r, dir) {
  if (dir < 0) return { score: 0, why: [] };
  let s = 0; const why = [];
  if (r.total > 0) { s += 6; why.push('＋法人今日買超'); }
  if (r.total < 0) { s -= 4; why.push('－法人今日賣超'); }
  if (r.ratio != null && r.ratio >= 20) { s += 4; why.push(`＋法人買超佔成交量 ${r.ratio.toFixed(0)}%`); }
  if (r.trustStreak >= 3) { s += 2; why.push(`＋投信連買 ${r.trustStreak} 天`); }
  if (r.signals?.includes('stealthBuy')) { s += 3; why.push('＋逆勢偷買'); }
  return { score: s, why };
}

export function confirmTw(r, dir) {
  const flow = [], ctx = [];
  if (dir > 0) {
    if (r.total > 0) flow.push('法人今日買超');
    if (r.trustStreak >= 2) flow.push(`投信連買 ${r.trustStreak} 天`);
    if (r.foreignStreak >= 2) flow.push(`外資連買 ${r.foreignStreak} 天`);
    if (r.marginChg != null && r.marginChg < 0) ctx.push('融資減少（籌碼集中）');
    if (r.total5 > 0) ctx.push('法人 5 日買超');
  } else {
    if (r.total < 0) flow.push('法人今日賣超');
    if (r.trustStreak <= -2) flow.push(`投信連賣 ${-r.trustStreak} 天`);
    if (r.foreignStreak <= -2) flow.push(`外資連賣 ${-r.foreignStreak} 天`);
    if (r.marginChg != null && r.marginChg > 0) ctx.push('融資增加（散戶在接）');
    if (r.total5 < 0) ctx.push('法人 5 日賣超');
  }
  return { flow, ctx };
}
const TW_UNITS = { small: '短箱', big: '日線大箱', tr: '日線', lenUnit: 1, lenName: '天', bigLenName: '天' };

export function twPatternSignals(r) {
  const boxOut = structSignals(r, r.div?.st, confirmTw, TW_UNITS);
  const pat = twPatternOnly(r);
  // CHoCH 訂單塊（台股只做多，回測做空都虧）：單獨＝強；跟同週期反向諧波同方向＝非常強
  // 2026-10-29：CHoCH 訂單塊（日線、1H）回測沒有超過隨機做多，拿掉；改用回測後有效的諧波／維加斯策略
  r.chochWhy = null; r.chochId = '';
  const h1 = r.div?.h1 || {};
  const P = {}, why = [];
  const tp = (e, s, R) => e + R * (e - s);
  const line = (k, tf, p, note) => why.push(`【${k}】${tf}：進場 ${pxT(p.entry)}・停損 ${pxT(p.stop)}（${((p.entry - p.stop) / p.entry * 100).toFixed(1)}%）・目標 ${pxT(p.target)}（${((p.target - p.entry) / (p.entry - p.stop)).toFixed(1)}R）・${note}`);
  // 2026-10-29 重測：股價 10～200 元、309 檔、日線 5 年（扣手續費＋證交稅 0.585%）；這個範圍隨機做多是虧的（−0.1～−0.3R），沒有多頭偏差
  // 有效：諧波 CD＋維加斯多頭（6R +0.20R）、諧波 D 點＋維加斯多頭（+0.13R）、諧波 D 點（+0.10R）
  // 拿掉：諧波 CD 單獨（0R）、維加斯日線單獨（−0.09R）、4H 諧波（前半段虧，不穩）
  const hD = h1.harmD, T = h1.tunD;
  if (hD && hD.dir > 0 && !hD.weak) {
    const p = { entry: hD.plan.entry, stop: hD.plan.stop, tf: '1D', bars: hD.ago, wait: false };
    p.target = tp(p.entry, p.stop, 3);
    if (T?.up) { P.twHarmDayVegas = p; line(`日線諧波 ${hD.name} D 點＋維加斯多頭`, `D 點 ${hD.ago} 天前`, p, '1R 出一半、停損移保本、剩下 3R（回測 +0.13R）'); }
    else { P.twHarmDay = p; line(`日線諧波 ${hD.name} D 點`, `D 點 ${hD.ago} 天前`, p, '參考：不在維加斯多頭時回測前半段虧（−0.14R），不計分'); }
  }
  if (T?.up) for (const x of h1.cdD || []) {
    if (!(x.state === 'wait' || x.ago <= 3) || P.twCDVegas) continue;
    const p = { entry: x.entry, stop: x.stop, tf: '1D', bars: x.state === 'wait' ? null : x.ago, wait: x.state === 'wait' };
    p.target = tp(p.entry, p.stop, 6); P.twCDVegas = p;
    line(`日線諧波 ${x.name} CD 段做多＋維加斯多頭`, x.state === 'wait' ? '等突破 B' : `${x.ago} 天前觸發`, p, '6R 全出（回測 +0.20R）');
  }
  // PAI 進入超買（日線 Z 上穿 80）做多：停損 10 根低點、4R 全出（回測 +0.35R，隨機做多 +0.07R）
  const ob = h1.pai?.ob;
  if (ob && ob.entry > ob.stop) {
    const p = { entry: ob.entry, stop: ob.stop, tf: '1D', bars: ob.ago, wait: false };
    p.target = tp(p.entry, p.stop, 4); P.twPai80 = p;
    line('PAI 價格行為指數進入超買（動能延續）', ob.ago === 0 ? '今天' : `${ob.ago} 天前`, p, '4R 全出（回測 +0.35R，同樣出場隨機做多 +0.07R）');
  }
  { const l = paiLine(h1.pai, 'tw', '日線'); if (l) why.push(l); }
  r.plans = P; r.stratWhy = why; r.harmWhy = null; r.harmPendWhy = null; r.harmId = Object.keys(P).join(',');
  boxOut.push(...Object.keys(P));
  return [...boxOut, ...pat.filter((k) => !(k === 'baseBreak' && boxOut.includes('loBoxBreak')) && !(k === 'boxBreakDown' && boxOut.includes('hiBoxBreak')))];
}

function twPatternOnly(r) {
  const p = r.div?.pat;
  if (!p) return [];
  const out = [], why = [];
  if (p.rise >= 30 && p.hiAgo <= 10) {
    let score = 0; const w = [];
    if (r.total < 0) { score++; w.push('法人今日賣超'); }
    if (r.marginChg > 0) { score++; w.push('融資增加（散戶在接）'); }
    if (p.volRatio >= 2 && Math.abs(r.chg ?? 0) < 1) { score++; w.push('爆量不漲'); }
    if (r.div.bear >= 1) { score++; w.push('日線 MACD 頂背離'); }
    if (p.dd >= 3 && p.dd <= 15 && r.total < 0 && (r.foreignStreak <= -1 || r.trustStreak <= -1)) {
      out.push('topTurn'); why.push(`漲 ${p.rise.toFixed(0)}% 後回落 ${p.dd.toFixed(1)}%`, ...w);
    } else if (p.dd <= 4 && score >= 2) {
      out.push('topWarn'); why.push(`漲 ${p.rise.toFixed(0)}% 仍在高點`, ...w);
    }
  }
  if (p.drop >= 30 && p.loAgo <= 10 && p.bounce >= 3 && p.bounce <= 15 && r.total > 0 && (r.foreign > 0 || r.trust > 0)) {
    out.push('botTurn'); why.push(`跌 ${p.drop.toFixed(0)}% 後反彈 ${p.bounce.toFixed(1)}%`, '法人轉買');
    if (r.div.bull >= 1) why.push('日線 MACD 底背離');
  }
  if (p.breakUp && p.volRatio >= 2 && r.total > 0) {
    out.push('baseBreak'); why.push(`20 日箱型 ${p.boxRange.toFixed(1)}% 帶量突破`, `量 ${p.volRatio.toFixed(1)} 倍`, '法人買超');
    if (r.total5 > 0) why.push('整理期間法人已在買');
    if (r.marginChg != null && r.marginChg <= 0) why.push('融資沒增加');
  }
  if (p.breakDown && p.volRatio >= 2 && r.total < 0) {
    out.push('boxBreakDown'); why.push(`20 日箱型 ${p.boxRange.toFixed(1)}% 帶量跌破`, '法人賣超');
  }
  r.patWhy = why;
  return out;
}


// K 線策略要掃的股票（2026-10-29 起）：股價 10～200 元，而且成交量 ≥ 1000 張或成交值 ≥ 0.5 億，全部掃
export const TW_PRICE = [10, 200];
export const twInRange = (r) => r.close != null && r.close >= TW_PRICE[0] && r.close <= TW_PRICE[1];
export function twPick(rows) {
  const val = (r) => (r.close || 0) * (r.volume || 0) * 1000;
  return rows.filter((r) => twInRange(r) && (r.volume >= 1000 || val(r) >= 5e7)).sort((a, b) => val(b) - val(a)).map((r) => r.code);
}
// 舊的挑選方式（有籌碼訊號、大漲大跌、法人進出最大，最多 56 檔），留著備用
export function twPickOld(rows) {
  const liquid = rows.filter((r) => r.volume >= 1000);
  const pick = new Set([
    ...liquid.filter((r) => r.signals.some((k) => TW_SIGNALS[k]?.alert)).map((r) => r.code),
    ...[...liquid].filter((r) => Math.abs(r.chg ?? 0) >= 3).sort((a, b) => b.volume - a.volume).slice(0, 16).map((r) => r.code),
    ...[...liquid].sort((a, b) => Math.abs(b.total5) - Math.abs(a.total5)).slice(0, 16).map((r) => r.code),
    // 成交量最大的 20 檔也一定掃（策略回測用的是成交值前 100 檔）
    ...[...liquid].sort((a, b) => b.volume - a.volume).slice(0, 20).map((r) => r.code),
  ]);
  return [...pick].slice(0, 56);
}

// 把日 K 分析結果套到這檔股票上
export function applyTwHist(r, m) {
  r.div = m;
  if (m.bull >= 2) r.signals.push('macdBull2'); else if (m.bull === 1) r.signals.push('macdBull');
  if (m.bear >= 2) r.signals.push('macdBear2'); else if (m.bear === 1) r.signals.push('macdBear');
  r.signals.unshift(...twPatternSignals(r));
  Object.defineProperty(r, 'confirmTw', { value: (d) => confirmTw(r, d), enumerable: false, configurable: true });
  Object.defineProperty(r, 'twChip', { value: (d) => twChip(r, d), enumerable: false, configurable: true });
}
