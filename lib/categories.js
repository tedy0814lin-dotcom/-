// 把所有訊號整理成兩大類、四種結論，每檔只給一個結論和強度
import { cryptoChip } from './cryptoCore.js';
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
  twHarmDay: ['bottom', 2], paiRevD: ['bottom', 2],
  pullLong: ['long', 3], pullShort: ['short', 3], retestLong: ['long', 3], retestShort: ['short', 3],
  revRetestLong: ['bottom', 3], revRetestShort: ['top', 3],
  // CHoCH 訂單塊：加密 4H 單獨只當參考（回測沒優勢）、加密 1H＝主要；台股日線／1H＝主要
  chochUp: ['bottom', 1], chochDown: ['top', 1], choch1hUp: ['bottom', 3], choch1hDown: ['top', 3],
  chochDayUp: ['bottom', 3], chochTw1hUp: ['bottom', 3], chochHarmUp: ['bottom', 3], chochHarmDown: ['top', 3],
  chochUpClean: ['bottom', 1], chochDownClean: ['top', 1], chochBosUp: ['bottom', 3], chochBosDown: ['top', 3],
  crtLong: ['bottom', 2], crtShort: ['top', 2],
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
    // PAI 連續超賣→第一次超買→離開超買做多：1D +0.82R（51 筆）、12H +0.38R（129 筆）；隨機進場有時也 +0.2R，樣本少，保守給分
    // paiRevD（日線版）排除停損 >25% 後只剩 24 筆，樣本太少 → 只當參考、不計分
    // CVD Oscillator 上穿 0 做多：分數用「扣掉隨機做多」的部分（12H +0.30−0.09、4H +0.13−0.01）
    cvdoUp12:    { e: 0.21, cat: 'long',   label: '12H CVD Oscillator 上穿 0 做多' },
    cvdoUp4:     { e: 0.12, cat: 'long',   label: '4H CVD Oscillator 上穿 0 做多' },
    // CVD 連跌後轉正爆量（使用者規則）：12H +0.36R、4H 真實主動買賣 +0.26R；連跌後放量上穿 0（4H）+0.24R → 保守給分
    // MACD 柱狀體波峰頂背離做空（使用者規則）：4H 連續 ≥2 次 +0.74R（142 筆）、4H 價格還在創高 +0.28R、12H +0.35R → 保守給分
    macdTopDiv4C: { e: 0.35, cat: 'top',   label: '4H MACD 柱狀體連續頂背離（做空）' },
    macdTopDiv4:  { e: 0.20, cat: 'top',   label: '4H MACD 柱狀體頂背離、價格還在創高（做空）' },
    macdTopDiv12: { e: 0.25, cat: 'top',   label: '12H MACD 柱狀體頂背離、價格還在創高（做空）' },
    macdTopDiv1D: { e: 0.25, cat: 'top',   label: '日線 MACD 柱狀體頂背離、價格還在創高（做空）' },
    cvdFlip12:   { e: 0.25, cat: 'bottom', label: '12H CVD 連跌後轉正爆量（看多反轉）' },
    cvdFlip4:    { e: 0.20, cat: 'bottom', label: '4H CVD 連跌後轉正爆量（看多反轉）' },
    cvdoUp4V:    { e: 0.22, cat: 'long',   label: '4H CVD Oscillator 連跌後放量上穿 0' },
    paiRev12:    { e: 0.25, cat: 'bottom', label: '12H PAI 連續超賣後第一次超買（離開超買做多）' },
    harmCDLong:  { e: 0.12, cat: 'long',   label: '4H 諧波 CD 段做多' },
    // 2026-10-29 計分門檻：扣費後 ≥ +0.10R、前後半段都賺、贏隨機、樣本夠 → 日線大箱（+0.09R、11 個月）、CRT（+0.08R、4 個月）、
    // CD 做空（+0.07R）不合格，改為參考（照樣顯示、不計分、不推播）
  },
  tw: {
    // 2026-10-29 重測：股價 10～200 元 309 檔、日線 5 年、扣 0.585%。這個範圍隨機做多是虧的，e 用策略本身的報酬
    twCDVegas:      { e: 0.20, cat: 'long',   label: '日線諧波 CD 段＋維加斯多頭' },
    twHarmDayVegas: { e: 0.13, cat: 'bottom', label: '日線諧波 D 點＋維加斯多頭' },
    // PAI 進入超買做多：回測 +0.35R，扣掉同樣出場的隨機做多 +0.07R，保守用 0.28
    // CVD Oscillator 日線上穿 0：+0.24R，隨機做多 +0.06R → 用 0.18
    twCvdoUp:       { e: 0.18, cat: 'long',   label: '日線 CVD Oscillator 上穿 0 做多' },
    // CVD 連跌後轉正爆量（日線）：6R +0.44R，隨機 +0.13R → 用 0.25
    twCvdFlip:      { e: 0.25, cat: 'bottom', label: '日線 CVD 連跌後轉正爆量（看多反轉）' },
    twPai80:        { e: 0.28, cat: 'long',   label: '日線 PAI 進入超買做多（動能延續）' },
    // twHarmDay（日線諧波 D 點、不在維加斯多頭）2026-10-29 重測：+0.06R 但前半段 −0.14R → 不計分，只當參考
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
    if (mkt === 'crypto' && r.oiChg24 !== undefined) {
      const t = cryptoChip(r, dir); c += t.score; chip.push(...t.why);
    } else if (mkt === 'crypto') {
      for (const x of r.scene || []) {
        if (x.d === dir) { c += 4; chip.push('＋' + x.t); } else if (x.d === -dir) { c -= 4; chip.push('－' + x.t); }
      }
    } else if (r.twChip) {
      const t = r.twChip(dir); c += t.score; chip.push(...t.why);
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
      // 台股：投信連買、外資連買、土洋同買、法人買超佔量回測之後 5～20 天沒有比較好，不當參考訊號
      const NO_TW = ['trustBuy', 'foreignBuy', 'bothBuy', 'bigRatio', 'concentrate', 'trustSell', 'foreignSell'];
      const ks = (r.signals || []).filter((k) => SIGNAL_CAT[k] && SIGNAL_CAT[k][1] >= 2 && CATS[SIGNAL_CAT[k][0]].dir === dir && !(mkt === 'tw' && NO_TW.includes(k)));
      if (!ks.length) return null;
      const main = ks.find((k) => SIGNAL_CAT[k][1] >= 3) || ks[0];
      return { dir, ks: [], cat: SIGNAL_CAT[main][0], score: Math.min(40, 20 + 5 * ks.length), why: [...ks.map((k) => (dict[k]?.label || k)), '（參考：未回測或回測不穩，不計策略分）'], chip: [], chipScore: 0, ref: true };
    };
    // 2026-10-29 使用者：沒有回測賺錢的不要顯示 → 不再用「弱（參考）」補位
    void ref;
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
