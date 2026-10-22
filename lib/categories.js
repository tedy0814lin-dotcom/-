// 把所有訊號整理成兩大類、四種結論，每檔只給一個結論和強度
//   交易機會：做多機會（突破／順勢）、做空機會（跌破／順勢）
//   潛在反轉：見底轉強、見頂轉弱
// 權重 3 = 主要訊號（單獨出現就成立），1–2 = 輔助訊號（要湊夠分數）

export const CATS = {
  long:   { group: '交易機會', label: '做多機會', sub: '突破／順勢', dir: 1 },
  short:  { group: '交易機會', label: '做空機會', sub: '跌破／順勢', dir: -1 },
  bottom: { group: '潛在反轉', label: '見底轉強', sub: '可能反轉向上', dir: 1 },
  top:    { group: '潛在反轉', label: '見頂轉弱', sub: '可能反轉向下', dir: -1 },
};

// 訊號代號 → [分類, 權重]（加密與台股共用同名代號）
export const SIGNAL_CAT = {
  // 做多機會
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
  const score = { long: 0, short: 0, bottom: 0, top: 0 };
  const why = { long: [], short: [], bottom: [], top: [] };
  for (const k of r.signals || []) {
    const m = SIGNAL_CAT[k];
    if (!m) continue;
    score[m[0]] += m[1];
    why[m[0]].push({ k, w: m[1], label: dict[k]?.label || k });
  }
  const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
  const s = score[best];
  r.cat = s >= 3 ? best : null;
  r.catScore = r.cat ? s : 0;
  r.catLevel = !r.cat ? '' : s >= 6 ? '強' : s >= 4 ? '中' : '弱';
  r.catWhy = r.cat ? why[best].sort((a, b) => b.w - a.w).map((x) => x.label) : [];
  // 反方向也有 3 分以上 → 訊號打架，提醒
  const opp = { long: ['short', 'top'], short: ['long', 'bottom'], bottom: ['short', 'top'], top: ['long', 'bottom'] };
  r.catConflict = r.cat ? opp[r.cat].filter((c) => score[c] >= 3).map((c) => CATS[c].label) : [];
  r.otherSignals = (r.signals || []).filter((k) => !SIGNAL_CAT[k] || SIGNAL_CAT[k][0] !== r.cat).map((k) => dict[k]?.label || k);
  return r;
}
