// 多週期箱體結構（加密與台股共用）
//   大週期（加密 = 日線，台股 = 日線長箱）：判斷趨勢、大箱體、現在在高位還是低位
//   小週期（加密 = 4H，台股 = 日線短箱）：找小箱體、跌破 / 突破、回踩箱體反彈
// 箱子多寬才算「窄」不是固定 %，而是看這檔自己的平均波動（ATR）：
//   台積電這種大資金標的平常一天只動 1–2%，3% 的箱子就很明顯；小幣一根 4H 就動 3%，7% 只是雜訊。
// bars: [{o, h, l, c, v, d}]，舊 → 新

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 平均真實波幅（佔價格 %）：最近 n 根 K 棒平均「一根會動多少」
export function atrPct(bars, n = 14) {
  const m = bars.length;
  if (m < 2) return null;
  let sum = 0, k = 0;
  for (let i = Math.max(1, m - n); i < m; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    sum += (Math.max(b.h, pc) - Math.min(b.l, pc)) / b.c * 100;
    k++;
  }
  return k ? sum / k : null;
}

// 找「結束在 end 之前」的箱子：bars[end-len, end)，從長往短試，取最長、寬度 ≤ maxPct、上下緣都被碰過 2 次以上的
export function findBox(bars, { end = bars.length - 1, maxPct, minLen, maxLen, step = 2, band = 0.2, minTouch = 2 }) {
  for (let len = Math.min(maxLen, end); len >= minLen; len -= step) {
    const bx = bars.slice(end - len, end);
    let hi = -Infinity, lo = Infinity;
    for (const b of bx) { if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l; }
    const range = (hi / lo - 1) * 100;
    if (range > maxPct) continue;
    const span = hi - lo;
    const touchLo = bx.filter((b) => b.l <= lo + span * band).length;
    const touchHi = bx.filter((b) => b.h >= hi - span * band).length;
    if (touchLo < minTouch || touchHi < minTouch) continue;
    // 要真的「來回」：底 → 頂 → 底 或 頂 → 底 → 頂 至少一次，單邊上漲 / 下跌不算箱子
    let seq = '';
    for (const b of bx) {
      const z = b.l <= lo + span * band ? 'L' : b.h >= hi - span * band ? 'H' : '';
      if (z && seq[seq.length - 1] !== z) seq += z;
    }
    if (seq.length < 3) continue;
    return { start: end - len, end, len, hi, lo, range };
  }
  return null;
}

// 轉折點（左右各 w 根都比它低 / 高）
function swings(bars, w) {
  const hs = [], ls = [];
  for (let i = w; i < bars.length - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (bars[j].h > bars[i].h) isH = false;
      if (bars[j].l < bars[i].l) isL = false;
    }
    if (isH) hs.push({ i, p: bars[i].h });
    if (isL) ls.push({ i, p: bars[i].l });
  }
  return { hs, ls };
}

// 趨勢：最近兩個高點、兩個低點都墊高 = 多頭；都降低 = 空頭
// 多頭「結構沒壞」= 收盤還在最近一個轉折低點之上（肉眼看得到的結構破壞就是跌破它）
export function trendOf(bars, w = 3) {
  const { hs, ls } = swings(bars, w);
  if (hs.length < 2 || ls.length < 2) return { trend: 'range' };
  const [h1, h2] = hs.slice(-2), [l1, l2] = ls.slice(-2);
  const c = bars[bars.length - 1].c;
  if (h2.p > h1.p && l2.p > l1.p) {
    return c > l2.p ? { trend: 'up', keyLow: l2.p, keyHigh: h2.p } : { trend: 'range', brokeUp: true, keyLow: l2.p };
  }
  if (h2.p < h1.p && l2.p < l1.p) {
    return c < h2.p ? { trend: 'down', keyHigh: h2.p, keyLow: l2.p } : { trend: 'range', brokeDown: true, keyHigh: h2.p };
  }
  return { trend: 'range' };
}

// 參數：加密（big = 日線、small = 4H）與台股（big = small = 日線）用不同長度
export const STRUCT_CRYPTO = {
  bigBox: { k: 6, min: 6, max: 35, minLen: 15, maxLen: 90, step: 5 }, // 日線大箱 15–90 天
  smallBox: { k: 5, min: 1.5, max: 14, minLen: 12, maxLen: 42, step: 6 }, // 4H 小箱 2–7 天
  pullBox: { minLen: 8, maxLen: 30, step: 2, scan: 120 }, // 回踩找的「前一個 4H 箱」
  retest: { scan: 42, maxAfter: 18 }, // 突破回踩：箱子在最近 7 天內結束、突破後 3 天內回踩
  posWin: 90, trendW: 3, smallUnit: '4H', bigUnit: '日線', lenUnit: 4, lenName: '小時',
};
export const STRUCT_TW = {
  bigBox: { k: 6, min: 6, max: 35, minLen: 20, maxLen: 60, step: 5 }, // 日線大箱 20–60 天
  smallBox: { k: 3.5, min: 2, max: 12, minLen: 5, maxLen: 15, step: 2 }, // 日線小箱 5–15 天
  pullBox: { minLen: 5, maxLen: 15, step: 2, scan: 60 },
  retest: { scan: 25, maxAfter: 12 },
  posWin: 60, trendW: 3, smallUnit: '短', bigUnit: '日線', lenUnit: 1, lenName: '天',
};

// big：大週期 K 線；small：小週期 K 線（台股兩個傳同一份）
export function structure(big, small, P = STRUCT_CRYPTO) {
  if (!big || big.length < 30 || !small || small.length < 30) return null;
  const out = {};
  const atrB = atrPct(big), atrS = atrPct(small);
  out.atrBig = atrB; out.atrSmall = atrS;
  out.tr = trendOf(big, P.trendW);

  // 現在在高位還是低位：近 posWin 根大週期 K 棒的區間位置（0 = 最低，1 = 最高）
  const win = big.slice(-P.posWin);
  const wHi = Math.max(...win.map((b) => b.h)), wLo = Math.min(...win.map((b) => b.l));
  const c = small[small.length - 1].c;
  out.price = c;
  out.posBig = wHi > wLo ? (c - wLo) / (wHi - wLo) : 0.5;

  const boxAt = (bars, cfg, atr, end) => {
    const maxPct = clamp(cfg.k * atr, cfg.min, cfg.max);
    const b = findBox(bars, { end, maxPct, minLen: cfg.minLen, maxLen: cfg.maxLen, step: cfg.step });
    if (!b) return null;
    b.maxPct = maxPct; b.atrMult = b.range / atr;
    return b;
  };
  const place = (b, price) => {
    const span = b.hi - b.lo;
    b.pos = span ? (price - b.lo) / span : 0.5;
    b.broke = price < b.lo ? 'down' : price > b.hi ? 'up' : null;
    return b;
  };

  // 1) 大箱：大週期在箱子裡來回 → 可以做箱體交易
  const bigEnd = big.length - 1;
  const bb = boxAt(big, P.bigBox, atrB, bigEnd);
  out.bigBox = bb ? place(bb, c) : null;

  // 2) 小箱（現在這個）：給區間交易用
  const sEnd = small.length - 1;
  const sb = boxAt(small, P.smallBox, atrS, sEnd);
  out.smallBox = sb ? place(sb, c) : null;

  // 3) 小箱剛跌破 / 突破（最近 1–3 根才發生）
  for (let k = 1; k <= 3 && !out.smallBreak; k++) {
    const e = small.length - k; // 突破那根的 index
    const b = boxAt(small, P.smallBox, atrS, e);
    if (!b) continue;
    const brk = small[e].c;
    if (brk < b.lo && c < b.lo) out.smallBreak = { dir: -1, ago: k - 1, ...b };
    else if (brk > b.hi && c > b.hi) out.smallBreak = { dir: 1, ago: k - 1, ...b };
  }

  // 4) 順勢回踩：大週期多頭結構沒壞，小週期從高點回檔，剛好踩到前一個小箱並反彈（空頭反過來）
  const t = out.tr.trend;
  if (t === 'up' || t === 'down') {
    const n = small.length, look = Math.min(n - 1, 40);
    const dir = t === 'up' ? 1 : -1;
    // 最近 40 根的極值（多頭找高點、空頭找低點）
    let ext = n - look;
    for (let i = n - look; i < n; i++) if (dir > 0 ? small[i].h >= small[ext].h : small[i].l <= small[ext].l) ext = i;
    const extP = dir > 0 ? small[ext].h : small[ext].l;
    const pullPct = dir > 0 ? (1 - c / extP) * 100 : (c / extP - 1) * 100;
    if (n - 1 - ext >= 2 && pullPct >= 2 * atrS) {
      // 在極值之前找最近的一個小箱，箱子要在極值的「下面」（多頭）
      const cfg = { ...P.smallBox, minLen: P.pullBox.minLen, maxLen: P.pullBox.maxLen, step: P.pullBox.step };
      let box = null;
      for (let e = ext; e >= Math.max(cfg.minLen, n - P.pullBox.scan); e--) {
        const b = boxAt(small, cfg, atrS, e);
        if (b && (dir > 0 ? b.hi < extP : b.lo > extP)) { box = b; break; }
      }
      if (box) {
        const span = box.hi - box.lo;
        const recent = small.slice(-4);
        const lo4 = Math.min(...recent.map((b) => b.l)), hi4 = Math.max(...recent.map((b) => b.h));
        const lastB = small[n - 1];
        const atrAbs = (atrS / 100) * c;
        const touched = dir > 0 ? lo4 <= box.hi + span * 0.15 && lo4 >= box.lo - span * 0.3 : hi4 >= box.lo - span * 0.15 && hi4 <= box.hi + span * 0.3;
        const held = dir > 0 ? c >= box.lo : c <= box.hi;
        const bounced = dir > 0
          ? c - lo4 >= 0.3 * atrAbs && (lastB.o == null || lastB.c > lastB.o)
          : hi4 - c >= 0.3 * atrAbs && (lastB.o == null || lastB.c < lastB.o);
        out.pullback = { dir, box, extP, pullPct, touched, held, bounced, ok: touched && held && bounced };
      }
    }
  }

  // 5) 突破回踩 / 跌破回抽：小箱突破後走出去，再回來踩箱頂站穩反彈（跌破則反過來）
  //    日線空頭裡的小箱往上突破再回踩 = 可能反轉向上；日線多頭裡的小箱跌破再回抽 = 可能反轉向下
  {
    const n = small.length, atrAbs = (atrS / 100) * c, R = P.retest;
    const lastB = small[n - 1];
    const recent = small.slice(-4);
    const lo4 = Math.min(...recent.map((b) => b.l)), hi4 = Math.max(...recent.map((b) => b.h));
    for (let e = n - 3; e >= Math.max(P.smallBox.minLen, n - R.scan) && !out.retest; e--) {
      const b = boxAt(small, P.smallBox, atrS, e);
      if (!b) continue;
      const span = b.hi - b.lo;
      // 箱子結束後第一根收在箱外的方向
      let k = -1;
      for (let i = e; i < Math.min(n - 1, e + R.maxAfter); i++) {
        if (small[i].c > b.hi || small[i].c < b.lo) { k = i; break; }
      }
      if (k < 0 || k > n - 3) continue;
      const dir = small[k].c > b.hi ? 1 : -1;
      const after = small.slice(k, n);
      if (dir > 0) {
        const ext = Math.max(...after.map((x) => x.h));
        const went = ext >= b.hi + Math.max(span * 0.5, atrAbs); // 突破後真的有走出去
        const failed = after.slice(0, -4).some((x) => x.c < b.lo); // 中間跌回箱底 = 假突破
        const touched = lo4 <= b.hi + span * 0.25 && lo4 >= b.lo + span * 0.3; // 回踩到箱頂附近，沒有深跌回箱子
        const held = c >= b.hi - span * 0.1;
        const bounced = c - lo4 >= 0.3 * atrAbs && (lastB.o == null || lastB.c > lastB.o);
        if (went && !failed && touched && held && bounced) out.retest = { dir, box: b, extP: ext, ago: n - 1 - k };
      } else {
        const ext = Math.min(...after.map((x) => x.l));
        const went = ext <= b.lo - Math.max(span * 0.5, atrAbs);
        const failed = after.slice(0, -4).some((x) => x.c > b.hi);
        const touched = hi4 >= b.lo - span * 0.25 && hi4 <= b.hi - span * 0.3;
        const held = c <= b.lo + span * 0.1;
        const bounced = hi4 - c >= 0.3 * atrAbs && (lastB.o == null || lastB.c < lastB.o);
        if (went && !failed && touched && held && bounced) out.retest = { dir, box: b, extP: ext, ago: n - 1 - k };
      }
    }
  }
  return out;
}

// ---------- 趨勢中的第一次 CHoCH（結構轉變）----------
// 上漲趨勢：轉折低點一路墊高、高點一路創高，而且每次回調都不深（不超過前一段漲幅的一半）
// 第一次收盤跌破「最近一個墊高的低點」（造出最後新高的那個低點）= 第一次轉弱訊號
// 下跌趨勢反過來。只抓剛發生的（最近 recent 根內）
function chochUp(bars, { w = 3, minMoveAtr = 6, maxRetr = 0.5, recent = 3 }) {
  const n = bars.length;
  const hs = [], ls = [];
  for (let i = w; i < n - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (bars[j].h > bars[i].h) isH = false;
      if (bars[j].l < bars[i].l) isL = false;
    }
    if (isH) hs.push(i);
    if (isL) ls.push(i);
  }
  if (hs.length < 2 || ls.length < 2) return null;
  // 趨勢的最高點：最近 80 根裡最高的轉折高點（CHoCH 之後的反彈高點會比它低）
  let iH = hs[hs.length - 1];
  for (const i of hs) if (i >= n - 80 && bars[i].h > bars[iH].h) iH = i;
  // 最後新高之前的低點，往回找一路墊高的那一段
  const lows = ls.filter((i) => i < iH);
  if (lows.length < 2) return null;
  const run = [lows[lows.length - 1]];
  for (let k = lows.length - 2; k >= 0; k--) { const v = bars[lows[k]].l, r0 = bars[run[0]].l; if (v < r0) run.unshift(lows[k]); else if (v > r0) break; }
  const highs = hs.filter((i) => i <= iH);
  const hrun = [highs[highs.length - 1]];
  for (let k = highs.length - 2; k >= 0; k--) { const v = bars[highs[k]].h, r0 = bars[hrun[0]].h; if (v < r0) hrun.unshift(highs[k]); else if (v > r0) break; }
  if (run.length < 2 || hrun.length < 2) return null;
  // 每一段的回調深度：前一個低點 → 中間的高點 → 下一個低點
  let maxR = 0;
  for (let k = 0; k < run.length - 1; k++) {
    const a = run[k], b = run[k + 1];
    let top = -Infinity;
    for (let i = a; i <= b; i++) top = Math.max(top, bars[i].h);
    const leg = top - bars[a].l;
    if (leg > 0) maxR = Math.max(maxR, (top - bars[b].l) / leg);
  }
  const key = bars[run[run.length - 1]].l, start = bars[run[0]].l, peak = bars[iH].h;
  const atr = atrPct(bars) / 100 * bars[n - 1].c;
  if (!(peak - start >= minMoveAtr * atr) || maxR > maxRetr) return null;
  // 第一次收盤跌破關鍵低點
  let j = -1;
  for (let i = iH + 1; i < n; i++) if (bars[i].c < key) { j = i; break; }
  if (j < 0) return null;
  // 做空計畫（這裡是上漲轉弱的視角）：回抽被跌破的關鍵價進場，停損放在跌破前最後一個高點上方，
  // 目標 1 = 2 倍風險，目標 2 = 整段漲幅回吐 0.618
  const lastPH = hs.filter((i) => i >= iH && i < j).pop() ?? iH;
  const plan = (entry, stopRef) => {
    const stop = stopRef + 0.2 * atr, risk = stop - entry;
    if (!(risk > 0)) return null;
    return { entry, stop, t1: entry - 2 * risk, t2: peak - 0.618 * (peak - start) };
  };
  const base = { key, peak, start, movePct: (peak / start - 1) * 100, maxRetr: maxR * 100 };
  if (j >= n - recent) return { ...base, stage: 'choch', ago: n - 1 - j, plan: plan(key, bars[lastPH].h) };
  // 第二次：CHoCH 後反彈出更低的高點，再收盤跌破 CHoCH 後的低點 = 趨勢延續（BOS）
  if (j < n - 60) return null;
  const pl = ls.find((i) => i >= j);
  if (pl == null) return null;
  const ph = hs.find((i) => i > pl && bars[i].h < peak);
  if (ph == null) return null;
  for (let i = pl + 1; i < ph; i++) if (bars[i].c > peak) return null;
  const low1 = bars[pl].l;
  let k = -1;
  for (let i = ph + 1; i < n; i++) { if (bars[i].h > bars[ph].h) return null; if (bars[i].c < low1) { k = i; break; } }
  if (k < 0 || k < n - recent) return null;
  return { ...base, stage: 'bos', low1, lh: bars[ph].h, ago: n - 1 - k, chochAgo: n - 1 - j, plan: plan(low1, bars[ph].h) };
}

export function choch(bars, opts = {}) {
  if (!bars || bars.length < 60) return null;
  const dn = chochUp(bars, opts);
  if (dn) return { dir: -1, ...dn };
  const flip = bars.map((b) => ({ o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
  const up = chochUp(flip, opts);
  if (up) return { dir: 1, stage: up.stage, key: -up.key, peak: -up.peak, start: -up.start, movePct: (1 - (-up.peak) / (-up.start)) * 100, maxRetr: up.maxRetr, ago: up.ago,
    chochAgo: up.chochAgo, low1: up.low1 == null ? undefined : -up.low1, lh: up.lh == null ? undefined : -up.lh,
    plan: up.plan && { entry: -up.plan.entry, stop: -up.plan.stop, t1: -up.plan.t1, t2: -up.plan.t2 } };
  return null;
}

// ---------- 諧波型態（Gartley / Bat / Butterfly / Crab）----------
// 用轉折點找 X-A-B-C，D = C 之後的最極端價（剛碰到 PRZ 反轉區），比例都對上才算
// 看漲：X 低、A 高、B 低、C 高、D 低（D 附近做多）；看跌反過來
const HARM = [
  { name: 'Gartley', b: [0.55, 0.68], xd: [0.75, 0.82], stopX: true },
  { name: 'Bat', b: [0.35, 0.52], xd: [0.85, 0.92], stopX: true },
  { name: 'Butterfly', b: [0.74, 0.82], xd: [1.25, 1.45], stopX: false },
  { name: 'Crab', b: [0.35, 0.64], xd: [1.55, 1.7], stopX: false },
];

function zigzag(bars, w) {
  const n = bars.length, pts = [];
  for (let i = w; i < n - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (bars[j].h > bars[i].h) isH = false;
      if (bars[j].l < bars[i].l) isL = false;
    }
    if (isH) pts.push({ i, t: 'H', v: bars[i].h });
    if (isL) pts.push({ i, t: 'L', v: bars[i].l });
  }
  // 連續同方向只留最極端的，變成高低交替
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && q.t === p.t) { if ((p.t === 'H' && p.v > q.v) || (p.t === 'L' && p.v < q.v)) out[out.length - 1] = p; }
    else out.push(p);
  }
  return out;
}

function harmUp(bars, { w = 3, recent = 3, minXaAtr = 5 } = {}) {
  const n = bars.length;
  const z = zigzag(bars, w);
  const atr = atrPct(bars) / 100 * bars[n - 1].c;
  // 最後一個確認的轉折要是高點 C，前面依序是 B 低、A 高、X 低
  let k = z.length - 1;
  if (k >= 0 && z[k].t === 'L') k--;
  if (k < 3) return null;
  const C = z[k], B = z[k - 1], A = z[k - 2], X = z[k - 3];
  if (!(X.t === 'L' && A.t === 'H' && B.t === 'L' && C.t === 'H')) return null;
  const XA = A.v - X.v;
  if (!(XA >= minXaAtr * atr)) return null;
  // D = C 之後的最低點，要剛發生（最近 recent 根內）
  let iD = -1, D = Infinity;
  for (let i = C.i + 1; i < n; i++) if (bars[i].l < D) { D = bars[i].l; iD = i; }
  if (iD < 0 || iD < n - recent) return null;
  const AB = A.v - B.v, BC = C.v - B.v, CD = C.v - D;
  const rb = AB / XA, rc = BC / AB, rxd = (A.v - D) / XA, rd = CD / BC;
  if (!(rc >= 0.38 && rc <= 0.89 && rd >= 1.1)) return null;
  const P = HARM.find((h) => rb >= h.b[0] && rb <= h.b[1] && rxd >= h.xd[0] && rxd <= h.xd[1]);
  if (!P) return null;
  // D 之後要開始收回（最新收盤高於 D），代表在反轉區有反應
  if (!(bars[n - 1].c > D)) return null;
  const AD = A.v - D;
  const stop = P.stopX ? X.v - 0.1 * atr : D - 0.13 * XA;
  const entry = bars[n - 1].c;
  const plan = entry > stop ? { entry, stop, t1: D + 0.382 * AD, t2: D + 0.618 * AD } : null;
  return { name: P.name, X: X.v, A: A.v, B: B.v, C: C.v, D, rb, rc, rxd, rd, ago: n - 1 - iD, plan };
}

export function harmonic(bars, opts = {}) {
  if (!bars || bars.length < 60) return null;
  const up = harmUp(bars, opts);
  if (up) return { dir: 1, ...up };
  const flip = bars.map((b) => ({ o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
  const dn = harmUp(flip, opts);
  if (!dn) return null;
  return { dir: -1, ...dn, X: -dn.X, A: -dn.A, B: -dn.B, C: -dn.C, D: -dn.D,
    plan: dn.plan && { entry: -dn.plan.entry, stop: -dn.plan.stop, t1: -dn.plan.t1, t2: -dn.plan.t2 } };
}
