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
  // CHoCH 訂單塊：加密 4H 單獨只當參考（回測沒優勢）、加密 1H＝主要；台股日線／1H＝主要
  chochUp: ['bottom', 1], chochDown: ['top', 1], choch1hUp: ['bottom', 3], choch1hDown: ['top', 3],
  chochDayUp: ['bottom', 3], chochTw1hUp: ['bottom', 3], chochHarmUp: ['bottom', 3], chochHarmDown: ['top', 3],
  chochUpClean: ['bottom', 1], chochDownClean: ['top', 1], chochBosUp: ['bottom', 3], chochBosDown: ['top', 3],
  harmCDLong: ['long', 3], harmCDShort: ['short', 3], harmCDLongPlus: ['long', 1], harmCDShortPlus: ['short', 1],
  harmCPreLong: ['long', 3], harmCPreShort: ['short', 3], harmCPreLongPlus: ['long', 1], harmCPreShortPlus: ['short', 1],
  harmUp: ['bottom', 3], harmDown: ['top', 3], harmWeakUp: ['bottom', 1], harmWeakDown: ['top', 1],
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

// ===================== 打分機制（2026-10-29 起）=====================
// 只有「回測扣費後、前後兩段都賺」的策略才給策略分；其他訊號只當參考或籌碼情境。
// 策略分 = 30 + 100 × 期望值（R），最多 80；同方向每多一個有效策略 +8（最多 +16）
// 籌碼分 = 籌碼情境同方向 +4、反方向 −4（加密）；台股用法人／融資確認，同方向每項 +4（最多 ±15）
// 總分 ≥ 75 非常強、≥ 60 強、≥ 45 中、其他弱。多方和空方都有 ≥ 45 的策略 → 多空分歧（降為弱、不推播）
export const STRATS = {
  crypto: {
    // 2026-10-29 用 4 年 4H 資料重新驗證（前後兩段都要賺）；維加斯做多、MACD 背離 4 年不穩，改成只當參考
    harmUpVegas: { e: 0.33, cat: 'bottom', label: '4H 諧波 D 點完成＋D 在維加斯通道（多頭排列）' },
    harmUp:      { e: 0.21, cat: 'bottom', label: '4H 諧波 D 點完成（做多）' },
    harmCDLong:  { e: 0.12, cat: 'long',   label: '4H 諧波 CD 段做多' },
    dBoxLong:    { e: 0.09, cat: 'long',   label: '日線大箱底做多（11 個月資料）' },
    crtLong:     { e: 0.08, cat: 'bottom', label: 'CRT 前日低點被掃＋30 分確認（4 個月資料）' },
    crtShort:    { e: 0.08, cat: 'top',    label: 'CRT 前日高點被掃＋30 分確認（4 個月資料）' },
    harmCDShort: { e: 0.07, cat: 'short',  label: '4H 諧波 CD 段做空' },
  },
  tw: {
    // 2026-10-29 重測：股價 10～200 元 309 檔、日線 5 年、扣 0.585%。這個範圍隨機做多是虧的，e 用策略本身的報酬
    twCDVegas:      { e: 0.20, cat: 'long',   label: '日線諧波 CD 段＋維加斯多頭' },
    twHarmDayVegas: { e: 0.13, cat: 'bottom', label: '日線諧波 D 點＋維加斯多頭' },
    twHarmDay:      { e: 0.10, cat: 'bottom', label: '日線諧波 D 點做多' },
  },
};
export const LEVEL_OF = (sc) => (sc >= 75 ? '非常強' : sc >= 60 ? '強' : sc >= 45 ? '中' : '弱');

export function classify(r, dict) {
  const mkt = r.code ? 'tw' : 'crypto';
  const S = STRATS[mkt], sig = new Set(r.signals || []);
  const side = (dir) => {
    const all = Object.keys(S).filter((k) => sig.has(k) && CATS[S[k].cat].dir === dir);
    const ks = all.filter((k) => !S[k].bonus).sort((a, b) => S[b].e - S[a].e);
    if (!ks.length) return null;
    const nb = all.length - ks.length; // 加分條件（共振）
    let score = Math.min(80, 30 + 100 * S[ks[0]].e) + Math.min(16, 8 * (ks.length - 1 + nb));
    const why = [...ks, ...all.filter((k) => S[k].bonus)].map((k) => S[k].label), chip = [];
    let c = 0;
    if (mkt === 'crypto') {
      for (const x of r.scene || []) {
        if (x.d === dir) { c += 4; chip.push('＋' + x.t); } else if (x.d === -dir) { c -= 4; chip.push('－' + x.t); }
      }
    } else if (r.confirmTw) {
      const { flow, ctx } = r.confirmTw(dir);
      c += 4 * flow.length + 2 * ctx.length; chip.push(...flow, ...ctx);
    }
    c = Math.max(-15, Math.min(15, c));
    return { dir, ks, cat: S[ks[0]].cat, score: Math.round(Math.max(0, Math.min(100, score + c))), why, chip, chipScore: c };
  };
  let L = side(1), Sh = side(-1);
  // 沒有回測有效的策略時：原本的主要訊號（未回測或回測不穩）只當「參考」，一律算弱、最多 40 分、不推播
  if (!L && !Sh) {
    const ref = (dir) => {
      const ks = (r.signals || []).filter((k) => SIGNAL_CAT[k] && SIGNAL_CAT[k][1] >= 2 && CATS[SIGNAL_CAT[k][0]].dir === dir);
      if (!ks.length) return null;
      const main = ks.find((k) => SIGNAL_CAT[k][1] >= 3) || ks[0];
      return { dir, ks: [], cat: SIGNAL_CAT[main][0], score: Math.min(40, 20 + 5 * ks.length), why: [...ks.map((k) => (dict[k]?.label || k)), '（參考：未回測或回測不穩，不計策略分）'], chip: [], chipScore: 0, ref: true };
    };
    L = ref(1); Sh = ref(-1);
  }
  const best = !L ? Sh : !Sh ? L : L.score >= Sh.score ? L : Sh;
  const other = best === L ? Sh : L;
  r.cat = best ? best.cat : null;
  r.catScore = best ? best.score : 0;
  r.catLevel = best ? (best.ref ? '弱' : LEVEL_OF(best.score)) : '';
  r.catWhy = best ? (best.ref ? best.why : [...best.why, `策略分 ${best.score - best.chipScore}・籌碼分 ${best.chipScore >= 0 ? '+' : ''}${best.chipScore}`]) : [];
  r.chipWhy = best ? best.chip : [];
  r.catConflict = [];
  r.split = false;
  if (best && other && other.score >= 45 && best.score >= 45) {
    r.split = true; r.catLevel = '弱';
    r.catConflict = [`${CATS[other.cat].label}（${other.score} 分：${other.why.join('、')}）→ 多空分歧，先觀望`];
  }
  r.mainKey = best && !best.ref ? best.ks[0] : null;
  const used = new Set(best ? best.ks : []);
  r.otherSignals = (r.signals || []).filter((k) => !used.has(k) && !k.endsWith('Plus')).map((k) => dict[k]?.label || k);
  return r;
}
