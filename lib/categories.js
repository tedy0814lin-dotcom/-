// 把所有訊號整理成兩大類、四種結論，每檔只給一個結論和強度
//   交易機會：做多機會（突破／順勢）、做空機會（跌破／順勢）
//   潛在反轉：見底轉強、見頂轉弱
// 權重 3 = 主要訊號（單獨出現就成立），1–2 = 輔助訊號（只能加分；只有輔助訊號最多算「弱」）

export const CATS = {
  long:   { group: '交易機會', label: '做多機會', sub: '突破／順勢', dir: 1 },
  short:  { group: '交易機會', label: '做空機會', sub: '跌破／順勢', dir: -1 },
  bottom: { group: '潛在反轉', label: '見底轉強', sub: '可能反轉向上', dir: 1 },
  top:    { group: '潛在反轉', label: '見頂轉弱', sub: '可能反轉向下', dir: -1 },
};

// 訊號代號 → [分類, 權重]（加密與台股共用同名代號）
export const SIGNAL_CAT = {
  // 做多機會（箱底做多 / 箱頂做空 是主要的交易機會）
  boxLong: ['long', 3], boxLongPlus: ['long', 3], boxShort: ['short', 3], boxShortPlus: ['short', 3],
  dBoxLong: ['long', 3], dBoxShort: ['short', 3], loBoxBreak: ['long', 3], hiBoxBreak: ['short', 3],
  pullLong: ['long', 3], pullShort: ['short', 3], retestLong: ['long', 3], retestShort: ['short', 3],
  revRetestLong: ['bottom', 3], revRetestShort: ['top', 3],
  chochUp: ['bottom', 3], chochUpClean: ['bottom', 3], chochDown: ['top', 3], chochDownClean: ['top', 3], chochBosUp: ['bottom', 3], chochBosDown: ['top', 3],
  harmUp: ['bottom', 3], harmDown: ['top', 3],
  baseBreak: ['long', 3], whaleLong: ['long', 2], takerBuy: ['long', 1],
  trustBuy: ['long', 2], foreignBuy: ['long', 1], bothBuy: ['long', 2], concentrate: ['long', 1], bigRatio: ['long', 1],
  // 做空機會
  boxBreakDown: ['short', 3], whaleShort: ['short', 2], takerSell: ['short', 1],
  trustSell: ['short', 2], foreignSell: ['short', 1],
  // 見底轉強
  botTurn: ['bottom', 3], coilUp: ['bottom', 3], stealthBuy: ['bottom', 3], macdBull2: ['bottom', 3],
  macdBull: ['bottom', 1], divLong: ['bottom', 1], crowdShort: ['bottom', 1], shortUp: ['bottom', 1],
  // 見頂轉弱
  topTurn: ['top', 3], topWarn: ['top', 3], coilDown: ['top', 3], stealthSell: ['top', 3], macdBear2: ['top', 3],
  macdBear: ['top', 1], divShort: ['top', 1], crowdLong: ['top', 1],
  // coil（方向未明）、oiFlush（大量平倉）只當參考，不分類
};

export function classify(r, dict) {
  // 每個分類分開算：主要訊號個數 p、輔助訊號分數 s（最多算 3 分，避免一堆常見的輔助訊號疊成「強」）
  const p = { long: 0, short: 0, bottom: 0, top: 0 };
  const sec = { long: 0, short: 0, bottom: 0, top: 0 };
  const why = { long: [], short: [], bottom: [], top: [] };
  for (const k of r.signals || []) {
    let m = SIGNAL_CAT[k];
    if (!m) continue;
    // 「多重籌碼確認」跟著主訊號走：主訊號是反轉型的，就算進反轉那一類
    if (k === 'boxLongPlus' && (r.signals || []).includes('revRetestLong')) m = ['bottom', 3];
    if (k === 'boxShortPlus' && (r.signals || []).includes('revRetestShort')) m = ['top', 3];
    if (m[1] >= 3) p[m[0]]++; else sec[m[0]] += m[1];
    why[m[0]].push({ k, w: m[1], label: dict[k]?.label || k });
  }
  const score = {};
  for (const c in p) score[c] = p[c] * 3 + Math.min(sec[c], 3);
  // 有主要訊號的分類優先，再比總分
  const best = Object.keys(score).sort((a, b) => p[b] - p[a] || score[b] - score[a])[0];
  r.cat = score[best] >= 3 ? best : null;
  r.catScore = r.cat ? score[best] : 0;
  // 強：2 個以上主要訊號，或 1 個主要＋輔助滿 3 分；中：1 個主要訊號；弱：只有輔助訊號
  r.catLevel = !r.cat ? '' : p[best] >= 2 || (p[best] >= 1 && sec[best] >= 3) ? '強' : p[best] >= 1 ? '中' : '弱';
  // SMC 趨勢轉變（4H 首次 CHoCH）是「強」的主要依據：有 CHoCH 才算強，沒有 CHoCH 最多算中
  if (r.cat) {
    const hasChoch = (r.signals || []).some((k) => k.startsWith('choch') && SIGNAL_CAT[k]?.[0] === r.cat);
    const sameDir = { long: ['long', 'bottom'], bottom: ['long', 'bottom'], short: ['short', 'top'], top: ['short', 'top'] };
    // 有 CHoCH ＋ 同方向其他訊號重疊 → 非常強；只有 CHoCH → 強
    const others = (r.signals || []).filter((k) => !k.startsWith('choch') && !k.endsWith('Plus') && sameDir[r.cat].includes(SIGNAL_CAT[k]?.[0])).length;
    if (hasChoch) r.catLevel = others || (r.signals || []).some((k) => k.startsWith('chochBos')) ? '非常強' : '強';
    else if (r.catLevel === '強') r.catLevel = '中';
  }
  r.catWhy = r.cat ? why[best].sort((a, b) => b.w - a.w).map((x) => x.label) : [];
  // 反方向也有主要訊號 → 訊號打架，提醒
  const opp = { long: ['short', 'top'], short: ['long', 'bottom'], bottom: ['short', 'top'], top: ['long', 'bottom'] };
  r.catConflict = r.cat ? opp[r.cat].filter((c) => p[c] >= 1).map((c) => CATS[c].label) : [];
  r.otherSignals = (r.signals || []).filter((k) => !k.endsWith('Plus') && (!SIGNAL_CAT[k] || SIGNAL_CAT[k][0] !== r.cat)).map((k) => dict[k]?.label || k);
  return r;
}
