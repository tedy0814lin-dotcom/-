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
// 策略分 = 30 + 100 × 期望值（R），最多 80；同方向每多一個有效策略 +4（最多 +8；2026-11-01 回測互補沒有穩定加分，由 +8 降為 +4）
// 籌碼分 = 籌碼情境同方向 +4、反方向 −4（加密）；台股用法人／融資確認，同方向每項 +4（最多 ±15）
// 總分 ≥ 75 非常強、≥ 60 強、≥ 45 中、其他弱。多方和空方都有 ≥ 45 的策略 → 多空分歧（降為弱、不推播）
export const STRATS = {
  crypto: {
    // 2026-11-01 全幣種重驗（幣安 820 檔永續 4H/12H/日線，2020 起；樣本外＝成交額前 150 名且不在原 31 幣；扣 0.1% 費用；
    // 門檻：期望 ≥ +0.10R、前後半段都正、贏同出場隨機進場、樣本夠）。原 31 幣上的數字普遍高估，e 改用樣本外數字。
    //   通過：12H CVD 連跌後轉正爆量 +0.29R（329 筆）、4H CVD 連跌後放量上穿 0 +0.18R（2,094 筆）、12H CVD 上穿 0 +0.12R（6,828 筆）、
    //         4H 諧波 D 點（6R）+0.10R（2,913 筆）、4H MACD 連續頂背離做空 +0.11R（398 筆）、日線大陽線突破 POC（895 幣 342 筆 +0.67R，保守 0.25）
    //   不合格改成參考（不計分）：4H CVD 上穿 0（+0.08R）、4H CVD 轉正爆量（0R）、12H PAI（+0.03R）、諧波＋維加斯（3R +0.03R）、
    //         諧波 CD 做多（−0.10R）、日線 MACD 頂背離（91 筆、前半段虧）
    // 2026-11-01 止盈拉遠（優先看期望值）：cvdFlip12 4R→10R、cvdoUp4V 6R→10R、pocEngD 4R→8R、bigBullD 4R→6R；e 取實測的約 7 成。
    // cvdoUp12 不動（拉遠後只比隨機多 +0.07R、後半段 +0.12R 偏弱）
    harmUp:      { e: 0.10, cat: 'bottom', label: '4H 諧波 D 點完成（做多）' },
    // 2026-11-02 結構訂單塊（使用者規則）：回測 +0.27～+0.46R，但一次比較了約 400 組、打亂旗標的對照實驗平均也會過 5 組（實測 20 組），
    // 所以期望值打對折再給分（≈中級，不推播）
    // 2026-11-03 低位 Pinbar（使用者規則，不用吞噬確認）：回測 4H 5R +0.23R（949 筆），但集中在少數暴跌日、信賴區間貼近 0，給分打對折以上
    pinLowL4:    { e: 0.10, cat: 'bottom', label: '4H 低位 Pinbar（長下影）做多' },
    // 2026-11-03 圖表型態（只做多；54 組參數前 75% 挑、後 25% 驗證；做空版驗證期全部轉負所以沒收）。
    // 一次比了 54 組、驗證期只有約 8～10 個月偏多頭行情，所以期望值打對折再給分（≈中級，不推播的給 40～42 分）
    pDbl12:      { e: 0.20, cat: 'bottom', label: '12H 雙底突破頸線（做多）' },
    pTri4:       { e: 0.20, cat: 'bottom', label: '4H 三重底突破頸線（做多）' },
    pRect4:      { e: 0.18, cat: 'long',   label: '4H 矩形整理向上突破（做多）' },
    pDbl4:       { e: 0.12, cat: 'bottom', label: '4H 雙底突破頸線（做多）' },
    pAsc4:       { e: 0.10, cat: 'long',   label: '4H 上升三角形向上突破（做多）' },
    // 2026-11-04 底部早進場（型態成形就進、不等突破）：驗證期（2025-11 之後）期望值打對折、日線樣本少再封頂 0.30
    eRect12:     { e: 0.25, cat: 'bottom', label: '12H 矩形底部早進場（做多）' },
    eTri12:      { e: 0.25, cat: 'bottom', label: '12H 三重底早進場（做多）' },
    eDbl12:      { e: 0.12, cat: 'bottom', label: '12H 雙底早進場（做多）' },
    eRect1d:     { e: 0.30, cat: 'bottom', label: '日線矩形底部早進場（做多）' },
    eTri1d:      { e: 0.30, cat: 'bottom', label: '日線三重底早進場（做多）' },
    eDbl1d:      { e: 0.30, cat: 'bottom', label: '日線雙底早進場（做多）' },
    smcFlipL4:   { e: 0.15, cat: 'long',   label: '4H 突破空方訂單塊＋CVD 動能＋MACD 底背離（做多）' },
    smcFlipS4:   { e: 0.13, cat: 'short',  label: '4H 跌破多方訂單塊＋CVD 動能＋維加斯壓力（做空）' },
    smcObL12:    { e: 0.18, cat: 'long',   label: '12H 結構訂單塊回測＋CVD 動能（做多）' },
    cvdoUp12:    { e: 0.10, cat: 'long',   label: '12H CVD Oscillator 上穿 0 做多' },
    pocBreakD:   { e: 0.25, cat: 'long',   label: '日線大陽線突破 POC（價格原本在 POC 下方，做多）' },
    bigBullD:    { e: 0.38, cat: 'long',   label: '日線大陽線（實體 ≥1.5ATR，BTC 站上 50 日線，做多）' },
    pocEngD:     { e: 0.28, cat: 'top',    label: '日線 POC 空方吞噬（價格在 POC 上方，做空）' },
    macdTopDiv4C: { e: 0.10, cat: 'top',   label: '4H MACD 柱狀體連續頂背離（做空）' },
    cvdFlip12:   { e: 0.40, cat: 'bottom', label: '12H CVD 連跌後轉正爆量（看多反轉）' },
    cvdoUp4V:    { e: 0.18, cat: 'long',   label: '4H CVD Oscillator 連跌後放量上穿 0' },
  },
  tw: {
    // 2026-11-01 全市場重驗：台股 1,969 檔（股價 10～200 元、20 日均量 ≥1,000 張）、日線 2021～2026、扣 0.585%、做多；
    // 加「大盤濾網」：加權指數昨收 > 60 日均線才給分（PAI：之上 +0.22R／之下 −0.31R，每年都正；CVD 轉正爆量：之上 +0.15R／之下 −0.17R）
    //   通過：PAI 進入超買（5,382 筆 +0.12R、濾網後 +0.22R；隨機 −0.09R）、CVD 連跌後轉正爆量（濾網後 901 筆 +0.15R，年度不穩 → 保守 0.12）
    //   不合格改成參考：日線 CVD 上穿 0（24,209 筆 0R）、諧波 CD＋維加斯（381 筆 −0.06R）、諧波 D 點＋維加斯（1,382 筆 +0.01R）
    twCvdFlip:      { e: 0.12, cat: 'bottom', label: '日線 CVD 連跌後轉正爆量（看多反轉；加權站上 60 日線）' },
    twPai80:        { e: 0.18, cat: 'long',   label: '日線 PAI 進入超買做多（動能延續；加權站上 60 日線）' },
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
    let score = Math.min(80, 30 + 100 * S[ks[0]].e) + Math.min(8, 4 * (ks.length - 1 + nb));
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
