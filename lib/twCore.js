// 台股訊號（前端與後端警報共用）：日 K 型態 + 箱體結構 + CHoCH，加上法人／融資確認
import { structSignals, chochWhy, chochKeys, cdSignals } from './cryptoCore.js';

export const TW_SIGNALS = {
  chochDown:   { label: '上漲後首次 CHoCH 轉弱', dir: -1, alert: true },
  chochDownClean: { label: '上漲中無深回調', dir: -1, alert: true },
  chochUp:     { label: '下跌後首次 CHoCH 轉強', dir: 1, alert: true },
  chochUpClean: { label: '下跌中無深反彈', dir: 1, alert: true },
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
function confirmTw(r, dir) {
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
  const c = r.div?.choch;
  r.chochWhy = c ? chochWhy(c, '日線（台股一天約等於一根 4H）') : null;
  if (c) boxOut.unshift(...chochKeys(c));
  // 諧波只用「反著用」：吃 C→D 這一段
  const cd = cdSignals(r.div?.harmCD, '日線', (d) => confirmTw(r, d));
  r.harmWhy = cd.why; r.harmPendWhy = null;
  boxOut.push(...cd.keys);
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


// 要抓日 K 的股票：有籌碼訊號、今天大漲大跌、或法人 5 日進出最大（避免被證交所擋，最多 40 檔）
export function twPick(rows) {
  const liquid = rows.filter((r) => r.volume >= 1000);
  const pick = new Set([
    ...liquid.filter((r) => r.signals.some((k) => TW_SIGNALS[k]?.alert)).map((r) => r.code),
    ...[...liquid].filter((r) => Math.abs(r.chg ?? 0) >= 3).sort((a, b) => b.volume - a.volume).slice(0, 16).map((r) => r.code),
    ...[...liquid].sort((a, b) => Math.abs(b.total5) - Math.abs(a.total5)).slice(0, 16).map((r) => r.code),
  ]);
  return [...pick].slice(0, 40);
}

// 把日 K 分析結果套到這檔股票上
export function applyTwHist(r, m) {
  r.div = m;
  if (m.bull >= 2) r.signals.push('macdBull2'); else if (m.bull === 1) r.signals.push('macdBull');
  if (m.bear >= 2) r.signals.push('macdBear2'); else if (m.bear === 1) r.signals.push('macdBear');
  r.signals.unshift(...twPatternSignals(r));
}
