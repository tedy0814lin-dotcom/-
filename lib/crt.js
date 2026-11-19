// CRT（Candle Range Theory）引擎 — 依「Yuki 的 CRT 教室」14 章規則，邏輯與專案內 TradingView 指標 v4（claude/crt_indicator.pine）一致
//   C1 定區間 CRH／CRL → C2 掃一端並收回區間 → 掃點碰到關鍵區 KL → LTF：TBS（實體掃前低再收回）→ 帶缺口的 MSS → CISD 進場
//   止損＝掃點外；TP1＝區間 50%；TP2＝區間另一端；TP3＝外側流動性
//   保守＝等 C2 收盤確認收回後，在 C3 進場；激進＝C2 還沒收盤，LTF 條件到了就進
// 輸入：已收盤的 LTF K 棒 [{o,h,l,c,v,t}]，舊 → 新（t＝開盤毫秒）。只用已收盤資料，不看未來。
// ⚠ 專案回測（4H CRT＋KL＋15 分進場，加密 60 檔）扣費後約 −0.12R、贏不過隨機進場；本引擎只做「掃描＋畫圖」的觀察用途，不是有效訊號。
import { volumeProfile } from '../vprofile.js';

const ok = (x) => x === x;
const r6 = (x) => (x == null || !ok(x) ? null : +x.toPrecision(7));

function atrSeries(K, n = 14) {
  const out = new Array(K.length); let a = 0;
  for (let i = 0; i < K.length; i++) {
    const tr = i ? Math.max(K[i].h - K[i].l, Math.abs(K[i].h - K[i - 1].c), Math.abs(K[i].l - K[i - 1].c)) : K[i].h - K[i].l;
    a = i < n ? (a * i + tr) / (i + 1) : (a * (n - 1) + tr) / n;
    out[i] = a;
  }
  return out;
}

// 把 LTF 聚合成 ms 週期的 K 棒（off＝時區位移，台股日線用 +8 小時對齊台北日期）；記錄高低點所在的 LTF 索引
function agg(bars, ms, off) {
  const out = []; let id = null, c = null;
  bars.forEach((b, i) => {
    const k = Math.floor((b.t + off) / ms);
    if (k !== id) { id = k; c = { id: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, i0: i, i1: i, ih: i, il: i }; out.push(c); }
    else { if (b.h > c.h) { c.h = b.h; c.ih = i; } if (b.l < c.l) { c.l = b.l; c.il = i; } c.c = b.c; c.v += b.v || 0; c.i1 = i; }
  });
  return out;
}

// 關鍵區狀態：第 j 根 KL 週期 K 棒「開始時」已知的資料（只用 j-1 以前）。OHP/OLP、EQH/EQL、A/V 水平、FVG、OB
function klStates(K) {
  const n = K.length, atr = atrSeries(K), S = new Array(n);
  let ohp = NaN, ohp0 = NaN, olp = NaN, olp0 = NaN, aHi = NaN, vLo = NaN, bfT = NaN, bfB = NaN, sfT = NaN, sfB = NaN, bobT = NaN, bobB = NaN, sobT = NaN, sobB = NaN;
  const piv = (f, c, hi) => { // 中心 c，左右各 3 根的轉折
    const v = K[c][f];
    for (let j = c - 3; j <= c + 3; j++) { if (j === c) continue; if (hi ? (j < c ? v < K[j][f] : v <= K[j][f]) : (j < c ? v > K[j][f] : v >= K[j][f])) return NaN; }
    return v;
  };
  for (let j = 0; j < n; j++) {
    if (j >= 7) {
      const c = j - 4, pH = piv('h', c, true), pL = piv('l', c, false), cH = piv('c', c, true), cL = piv('c', c, false);
      if (ok(pH)) { ohp0 = ohp; ohp = pH; }
      if (ok(pL)) { olp0 = olp; olp = pL; }
      if (ok(cH)) aHi = cH;
      if (ok(cL)) vLo = cL;
    }
    if (j >= 8) {
      const c1 = K[j - 1].c;
      if (ok(bfB) && c1 < bfB) { bfT = bfB = NaN; }
      if (ok(sfT) && c1 > sfT) { sfT = sfB = NaN; }
      if (ok(bobB) && c1 < bobB) { bobT = bobB = NaN; }
      if (ok(sobT) && c1 > sobT) { sobT = sobB = NaN; }
      if (K[j - 1].l > K[j - 3].h) { // 多方 FVG ＋ 其前連續陰線（最多 5 根）＝多方 OB
        bfT = K[j - 1].l; bfB = K[j - 3].h;
        if (K[j - 3].c < K[j - 3].o) {
          let lo = K[j - 3].l, tp = K[j - 3].o;
          for (let m = 4; m <= 7 && K[j - m].c < K[j - m].o; m++) { lo = Math.min(lo, K[j - m].l); tp = K[j - m].o; }
          bobT = tp; bobB = lo;
        }
      }
      if (K[j - 1].h < K[j - 3].l) { // 空方 FVG ＋ 其前連續陽線 ＝ 空方 OB
        sfT = K[j - 3].l; sfB = K[j - 1].h;
        if (K[j - 3].c > K[j - 3].o) {
          let hi = K[j - 3].h, bt = K[j - 3].o;
          for (let m = 4; m <= 7 && K[j - m].c > K[j - m].o; m++) { hi = Math.max(hi, K[j - m].h); bt = K[j - m].o; }
          sobT = hi; sobB = bt;
        }
      }
    }
    const tl = (j ? atr[j - 1] : 0) * 0.1;
    S[j] = { ohp, olp, aHi, vLo, bfT, bfB, sfT, sfB, bobT, bobB, sobT, sobB,
      eqh: ok(ohp0) && Math.abs(ohp - ohp0) <= tl ? Math.max(ohp, ohp0) : NaN, eql: ok(olp0) && Math.abs(olp - olp0) <= tl ? Math.min(olp, olp0) : NaN };
  }
  return S;
}

// 紐約時段（亞洲 20–24、倫敦 02–05、紐約上 09:30–12、紐約下 14:30–17）的「上一個時段」高低
function sessions(bars) {
  const W = [[1200, 1440], [120, 300], [570, 720], [870, 1020]], n = bars.length;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  const H = W.map(() => new Float64Array(n).fill(NaN)), Lo = W.map(() => new Float64Array(n).fill(NaN));
  const cu = W.map(() => [NaN, NaN]), pv = W.map(() => [NaN, NaN]), was = W.map(() => false), nyM = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const p = fmt.formatToParts(new Date(bars[i].t)), m = +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value;
    nyM[i] = m;
    W.forEach(([a, b], w) => {
      const inS = m >= a && m < b;
      if (inS) { if (!was[w]) { cu[w] = [bars[i].h, bars[i].l]; } else { cu[w][0] = Math.max(cu[w][0], bars[i].h); cu[w][1] = Math.min(cu[w][1], bars[i].l); } }
      else if (was[w]) pv[w] = cu[w].slice();
      was[w] = inS; H[w][i] = pv[w][0]; Lo[w][i] = pv[w][1];
    });
  }
  return { H, Lo, nyM };
}

// LTF 進場引擎（以「做多」方向寫；做空用 −價格 鏡射）：TBS → 帶缺口 MSS → CISD 直接進
function mkLtf(d, bars, swN, tws) {
  const n = bars.length, hh = new Float64Array(n), ll = new Float64Array(n), oo = new Float64Array(n), cc = new Float64Array(n);
  for (let i = 0; i < n; i++) { const b = bars[i]; hh[i] = d === 1 ? b.h : -b.l; ll[i] = d === 1 ? b.l : -b.h; oo[i] = d === 1 ? b.o : -b.o; cc[i] = d === 1 ? b.c : -b.c; }
  const pivots = (arr, low) => {
    const out = new Float64Array(n).fill(NaN);
    for (let i = 2 * swN; i < n; i++) {
      const c = i - swN; let good = true;
      for (let j = c - swN; j <= c + swN && good; j++) { if (j === c) continue; if (low ? (j < c ? arr[c] > arr[j] : arr[c] >= arr[j]) : (j < c ? arr[c] < arr[j] : arr[c] <= arr[j])) good = false; }
      if (good) out[i] = arr[c];
    }
    return out;
  };
  const pL = pivots(ll, true), pH = pivots(hh, false);
  let lastSL = NaN, lastSH = NaN, runOpen = NaN, tsOk = false, mssOk = false, cisdOk = false, done = false, tbsP = false;
  let lvl = NaN, ext = NaN, mssLvl = NaN, cisd = NaN, fT = NaN, fB = NaN, fBar = -1, mssBar = -1, tsBar = -1;
  return (i, act, rst, canEnter) => {
    if (ok(pL[i])) lastSL = pL[i];
    if (ok(pH[i])) lastSH = pH[i];
    if (cc[i] < oo[i] && (i === 0 || !(cc[i - 1] < oo[i - 1]))) runOpen = oo[i];
    let hi10 = -Infinity; for (let j = Math.max(0, i - 9); j <= i; j++) hi10 = Math.max(hi10, hh[j]);
    let trig = false;
    if (rst) { tsOk = mssOk = cisdOk = done = tbsP = false; ext = mssLvl = fT = fB = NaN; fBar = mssBar = tsBar = -1; }
    if (act && !done) {
      if (tsOk && !mssOk && i >= 2 && ll[i] > hh[i - 2]) { fT = ll[i]; fB = hh[i - 2]; fBar = i; }
      if (!tsOk && ok(lastSL)) {
        if (tws && ll[i] < lastSL && cc[i] >= lastSL) { tsOk = true; ext = ll[i]; }
        else if (!tbsP) { if (cc[i] < lastSL) { tbsP = true; lvl = lastSL; ext = ll[i]; } }
        else { ext = Math.min(ext, ll[i]); if (cc[i] > lvl) { tsOk = true; tbsP = false; } }
        if (tsOk) { tsBar = i; mssLvl = ok(lastSH) && lastSH > cc[i] ? lastSH : hi10; cisd = runOpen; }
      }
      if (tsOk && !mssOk) {
        cisd = runOpen;
        if (ok(cisd) && cc[i] > cisd) cisdOk = true;
        if (cc[i] > mssLvl && fBar >= 0 && i - fBar <= 3) { mssOk = true; mssBar = i; }
        else if (cc[i] < ext) { tsOk = false; cisdOk = false; tbsP = false; fBar = -1; tsBar = -1; }
      }
      if (mssOk && !done && canEnter && cc[i] > cisd) { trig = true; done = true; }
    }
    const zA = d * fT, zB = d * fB;
    return { ts: tsOk, mss: mssOk, trig, ext: d * ext, cisdOk, fvg: fBar >= 0, cisd: d * cisd, zHi: Math.max(zA, zB), zLo: Math.min(zA, zB), tsBar, mssBar, fBar };
  };
}

// 進場後追蹤：先看停損（TP1 到價後止損移到入場價），再看 TP1／TP2／TP3；最多追蹤到 C3 之後 2 根 CRT K 棒
function outcome(bars, ev, kOf, last) {
  let h1 = false, h2 = false, h3 = false, res = 'open'; const lim = kOf[ev.i] + 2;
  const up = ev.dir === 1;
  for (let j = ev.i + 1; j <= last && kOf[j] <= lim; j++) {
    const b = bars[j], stop = h1 ? ev.entry : ev.sl;
    if (!h2 && (up ? b.l <= stop : b.h >= stop)) { res = h1 ? 'be' : 'sl'; break; }
    if (up ? b.h >= ev.t1 : b.l <= ev.t1) h1 = true;
    if (up ? b.h >= ev.t2 : b.l <= ev.t2) h2 = true;
    if (ok(ev.t3) && (up ? b.h >= ev.t3 : b.l <= ev.t3)) h3 = true;
  }
  return { h1, h2, h3, res, over: res === 'open' && kOf[last] > lim };
}

const RANK = { entry: 5, ready: 4, mss: 3, tbs: 2, swept: 1, blocked: 0 };

export function crt(bars, cfg) {
  const { crtSec, klSec, off = 0, ses = false, swN = 2, slBuf = 0.1, minRR = 1, maxSt = 3, tolMul = 0.25, side = 0, keep = 200 } = cfg;
  const n = bars.length;
  if (n < 150) return null;
  const crtMs = crtSec * 1000;
  const K = agg(bars, klSec * 1000, off), KS = klStates(K), D = agg(bars, 86400e3, off);
  const kIdx = new Int32Array(n), dIdx = new Int32Array(n);
  K.forEach((c, k) => { for (let i = c.i0; i <= c.i1; i++) kIdx[i] = k; });
  D.forEach((c, k) => { for (let i = c.i0; i <= c.i1; i++) dIdx[i] = k; });
  const SS = ses ? sessions(bars) : null;
  const kOf = new Int32Array(n); // 每根 LTF 屬於第幾根 CRT K 棒
  { let id = null, k = -1; for (let i = 0; i < n; i++) { const x = Math.floor((bars[i].t + off) / crtMs); if (x !== id) { id = x; k++; } kOf[i] = k; } }

  function run(isCons) {
    const HC = []; let cur = null, atrA = 0, atrPrev = 0;
    const ltfL = mkLtf(1, bars, swN, false), ltfS = mkLtf(-1, bars, swN, false);
    let trkDir = 0, confC = 0, klSet = [], confKl = [], cDir = 0;
    const events = []; let tr = null, lastBlock = '', view = null;
    for (let i = 0; i < n; i++) {
      const b = bars[i], newCrt = !cur || kOf[i] !== kOf[i - 1];
      if (newCrt) {
        if (cur) {
          HC.push(cur);
          const t = Math.max(cur.h - cur.l, HC.length > 1 ? Math.abs(cur.h - HC[HC.length - 2].c) : 0, HC.length > 1 ? Math.abs(cur.l - HC[HC.length - 2].c) : 0);
          atrA = HC.length <= 14 ? (atrA * (HC.length - 1) + t) / HC.length : (atrA * 13 + t) / 14; atrPrev = atrA;
        }
        cur = { o: b.o, h: b.h, l: b.l, c: b.c, i0: i, ih: i, il: i };
        const L = HC.length;
        if (L >= 2) { const a = HC[L - 1], c1 = HC[L - 2]; cDir = a.h > c1.h && a.c <= c1.h && a.c >= c1.l && a.l >= c1.l ? -1 : a.l < c1.l && a.c >= c1.l && a.c <= c1.h && a.h <= c1.h ? 1 : 0; }
      } else { if (b.h > cur.h) { cur.h = b.h; cur.ih = i; } if (b.l < cur.l) { cur.l = b.l; cur.il = i; } cur.c = b.c; }
      const L = HC.length;
      if (L < 3) { ltfL(i, false, false, false); ltfS(i, false, false, false); continue; }
      const P = HC[L - 1], C1 = HC[L - 2], cH1 = P.h, cL1 = P.l, tolK = atrPrev * tolMul;
      const aggDir = cur.h > cH1 && cur.l >= cL1 ? -1 : cur.l < cL1 && cur.h <= cH1 ? 1 : 0;
      // KL：掃蕩範圍 [CRH, 掃點] 內有碰到才算
      const S = KS[kIdx[i]], dd = dIdx[i] > 0 ? D[dIdx[i] - 1] : null;
      const hiHit = (lv) => ok(lv) && lv >= cH1 - tolK && lv <= cur.h, loHit = (lv) => ok(lv) && lv <= cL1 + tolK && lv >= cur.l;
      const zHiHit = (zb, zt) => ok(zb) && ok(zt) && zb <= cur.h && zt >= cH1 - tolK, zLoHit = (zb, zt) => ok(zb) && ok(zt) && zt >= cur.l && zb <= cL1 + tolK;
      const nS = [], nL = [];
      if (dd && hiHit(dd.h)) nS.push('PDH'); if (SS && [0, 1, 2, 3].some((w) => hiHit(SS.H[w][i]))) nS.push('時段高');
      if (hiHit(S.eqh)) nS.push('EQH'); if (hiHit(S.ohp)) nS.push('OHP'); if (hiHit(S.aHi)) nS.push('A 水平');
      if (zHiHit(S.sfB, S.sfT)) nS.push('FVG'); if (zHiHit(S.sobB, S.sobT)) nS.push('OB');
      if (dd && loHit(dd.l)) nL.push('PDL'); if (SS && [0, 1, 2, 3].some((w) => loHit(SS.Lo[w][i]))) nL.push('時段低');
      if (loHit(S.eql)) nL.push('EQL'); if (loHit(S.olp)) nL.push('OLP'); if (loHit(S.vLo)) nL.push('V 水平');
      if (zLoHit(S.bfB, S.bfT)) nL.push('FVG'); if (zLoHit(S.bobB, S.bobT)) nL.push('OB');
      if (newCrt) { confC = isCons && cDir !== 0 && cDir === trkDir ? cDir : 0; confKl = confC !== 0 ? klSet : []; trkDir = aggDir; klSet = []; tr = tr && kOf[tr.ev.i] + 2 >= kOf[i] ? tr : null; lastBlock = ''; }
      else if (trkDir === 0) trkDir = aggDir;
      for (const x of trkDir === -1 ? nS : trkDir === 1 ? nL : []) if (!klSet.includes(x)) klSet.push(x);
      const setupDir = isCons ? confC : trkDir;
      const rH = isCons ? C1.h : cH1, rL = isCons ? C1.l : cL1, rM = (rH + rL) / 2;
      const swH = isCons ? cH1 : cur.h, swL = isCons ? cL1 : cur.l;
      const failed = isCons && ((confC === 1 && b.c < cL1) || (confC === -1 && b.c > cH1));
      const klOkNow = klSet.length > 0, klOkConf = confKl.length > 0;
      const trkL = trkDir === 1 && klOkNow && side >= 0, trkS = trkDir === -1 && klOkNow && side <= 0;
      const cfL = isCons && confC === 1 && klOkConf && side >= 0 && !failed, cfS = isCons && confC === -1 && klOkConf && side <= 0 && !failed;
      const rL_ = ltfL(i, trkL || cfL, newCrt && !(isCons && confC === 1), isCons ? cfL : trkL);
      const rS_ = ltfS(i, trkS || cfS, newCrt && !(isCons && confC === -1), isCons ? cfS : trkS);
      const tDir = rL_.trig ? 1 : rS_.trig ? -1 : 0;
      const plan = (dir, e) => { // 停損 / 目標 / 盈虧比
        const sw = dir === 1 ? swL : swH, buf = atrPrev * slBuf, sl = dir === 1 ? sw - buf : sw + buf;
        const t3Raw = (() => { const a = Math.max(0, L - 22); let v = dir === 1 ? -Infinity : Infinity; for (let j = a; j <= L - 3; j++) v = dir === 1 ? Math.max(v, HC[j].h) : Math.min(v, HC[j].l); return v; })();
        const t2 = dir === 1 ? rH : rL, t3 = dir === 1 ? (t3Raw > t2 ? t3Raw : NaN) : (t3Raw < t2 ? t3Raw : NaN), risk = Math.abs(e - sl);
        const rr1 = risk > 0 ? dir * (rM - e) / risk : NaN, rr2 = risk > 0 ? dir * (t2 - e) / risk : NaN, stPct = risk / e * 100;
        const valid = dir === 1 ? sl < e && rM > e : sl > e && rM < e;
        return { dir, entry: e, sl, t1: rM, t2, t3, rr1, rr2, stPct, valid, okP: valid && rr1 >= minRR && stPct <= maxSt };
      };
      if (tDir) {
        const p = plan(tDir, b.c), ev = { i, t: b.t, mode: isCons ? '保守' : '激進', kl: (isCons ? confKl : klSet).slice(), rH, rL, c1i: isCons ? C1.i0 : P.i0, sweepI: tDir === 1 ? (isCons ? P.il : cur.il) : (isCons ? P.ih : cur.ih),
          tsI: (tDir === 1 ? rL_ : rS_).tsBar, mssI: (tDir === 1 ? rL_ : rS_).mssBar, gap: (tDir === 1 ? rL_ : rS_).fvg ? [(tDir === 1 ? rL_ : rS_).fBar, (tDir === 1 ? rL_ : rS_).zLo, (tDir === 1 ? rL_ : rS_).zHi] : null, ...p };
        if (p.okP) { events.push(ev); tr = { ev }; } else lastBlock = !p.valid ? 'TP1 已在進場後方' : p.rr1 < minRR ? '區間太小（盈虧比不足）' : '停損太遠（區間太大）';
      }
      if (i === n - 1) { // 最後一根：目前狀態
        const dRow = isCons && confC !== 0 ? confC : trkDir, R = dRow === 1 ? rL_ : dRow === -1 ? rS_ : null;
        const klX = dRow !== 0 && (isCons && confC !== 0 ? klOkConf : klOkNow);
        let status = null;
        if (tr) status = 'entry'; else if (lastBlock) status = 'blocked';
        else if (isCons && confC === 0 && trkDir !== 0) status = klOkNow ? 'swept' : null;
        else if (setupDir !== 0 && !failed && klX) status = !R.ts ? 'tbs' : !R.mss ? 'mss' : 'ready';
        if (status) {
          const dir = tr ? tr.ev.dir : (dRow || trkDir);
          view = { status, mode: isCons ? '保守' : '激進', dir, kl: (isCons ? (confC !== 0 ? confKl : klSet) : klSet).slice(), rH, rL, rM, c1i: isCons ? C1.i0 : P.i0, ts: !!R?.ts, mss: !!R?.mss, cisdOk: !!R?.cisdOk, fvg: !!R?.fvg, why: lastBlock };
          if (tr) view.trade = { ...tr.ev, ...outcome(bars, tr.ev, kOf, i) };
          else if (R?.ts) { // 預計進場點位（TBS 完成後先預告）
            const e = ok(R.cisd) ? R.cisd : b.c, p = plan(dir, e);
            view.plan = { ...p, why: !p.valid ? 'TP1 已在進場後方' : p.rr1 < minRR ? '盈虧比不足' : p.stPct > maxSt ? '停損太遠' : '' };
            view.sweepI = dir === 1 ? (isCons ? P.il : cur.il) : (isCons ? P.ih : cur.ih); view.tsI = R.tsBar; view.mssI = R.mssBar;
            view.gap = R.fvg ? [R.fBar, R.zLo, R.zHi] : null;
          } else view.sweepI = dir === 1 ? (isCons ? P.il : cur.il) : (isCons ? P.ih : cur.ih);
          const dpt = dir === 1 ? (rH - rL) : (rH - rL); const swp = dir === 1 ? swL : swH;
          view.depth = dpt > 0 ? (dir === 1 ? rL - swp : swp - rH) / dpt : null; // 掃蕩深度（相對區間）
        }
      }
    }
    for (const ev of events) ev.out = outcome(bars, ev, kOf, n - 1);
    return { events, view };
  }

  const A = run(false), C = run(true);
  const views = [C.view, A.view].filter(Boolean).sort((a, b) => RANK[b.status] - RANK[a.status]);
  const now = views[0] || null;
  const recent = [...C.events, ...A.events].sort((a, b) => b.i - a.i).slice(0, 4).map((e) => ({ mode: e.mode, dir: e.dir, t: e.t, entry: r6(e.entry), sl: r6(e.sl), t1: r6(e.t1), t2: r6(e.t2), t3: r6(e.t3), rr1: r6(e.rr1), kl: e.kl, out: e.out }));
  if (!now && !recent.length) return { now: null, recent: [] };
  const last = bars[n - 1];
  const out = { now: null, recent, price: last.c, t: last.t };
  if (now) {
    const s = Math.max(0, n - keep), rel = (i) => (i == null || i < 0 ? null : i - s), pe = now.trade || now.plan;
    // VP 參考：進場價在不在價值區／POC 附近（只當參考，專案回測單獨照 VP 做不賺）
    let vp = null;
    if (pe) {
      const seg = bars.slice(-300).map((x) => [x.o, x.h, x.l, x.c, x.v]), v = volumeProfile(seg, Math.min(...seg.map((x) => x[2])), Math.max(...seg.map((x) => x[1])));
      if (v) vp = { poc: r6(v.pocP), val: r6(v.val), vah: r6(v.vah), inVA: pe.entry >= v.val && pe.entry <= v.vah, nearPoc: Math.abs(pe.entry - v.pocP) <= 0.5 * (now.rH - now.rL) * 0.25 };
    }
    const rr = (o) => o && { ...o, entry: r6(o.entry), sl: r6(o.sl), t1: r6(o.t1), t2: r6(o.t2), t3: r6(o.t3), rr1: r6(o.rr1), rr2: r6(o.rr2), stPct: r6(o.stPct), i: rel(o.i), sweepI: rel(o.sweepI), tsI: rel(o.tsI), mssI: rel(o.mssI), c1i: rel(o.c1i), gap: o.gap && [rel(o.gap[0]), r6(o.gap[1]), r6(o.gap[2])], rH: r6(o.rH), rL: r6(o.rL) };
    out.now = { status: now.status, mode: now.mode, dir: now.dir, kl: now.kl, rH: r6(now.rH), rL: r6(now.rL), rM: r6(now.rM), c1i: rel(now.c1i), ts: now.ts, mss: now.mss, cisdOk: now.cisdOk, fvg: now.fvg, why: now.why, depth: r6(now.depth),
      sweepI: rel(now.sweepI), tsI: rel(now.tsI), mssI: rel(now.mssI), gap: now.gap && [rel(now.gap[0]), r6(now.gap[1]), r6(now.gap[2])],
      trade: rr(now.trade) && { ...rr(now.trade), out: undefined, h1: now.trade.h1, h2: now.trade.h2, h3: now.trade.h3, res: now.trade.res, over: now.trade.over },
      plan: now.plan && { ...now.plan, entry: r6(now.plan.entry), sl: r6(now.plan.sl), t1: r6(now.plan.t1), t2: r6(now.plan.t2), t3: r6(now.plan.t3), rr1: r6(now.plan.rr1), rr2: r6(now.plan.rr2), stPct: r6(now.plan.stPct) }, vp };
    out.chart = { bars: bars.slice(s).map((b) => [r6(b.o), r6(b.h), r6(b.l), r6(b.c), Math.round(b.v || 0)]), t: bars.slice(s).map((b) => b.t) };
  }
  return out;
}

// 各週期設定：加密 1H CRT 看 5 分、4H CRT 看 15 分；台股日線 CRT 看 15 分（日期按台北時間）
export const CRT_CFG = {
  crypto1h: { crtSec: 3600, klSec: 14400, ses: true, maxSt: 3 },
  crypto4h: { crtSec: 14400, klSec: 86400, ses: true, maxSt: 6 },
  tw1d: { crtSec: 86400, klSec: 86400, off: 8 * 3600e3, ses: false, maxSt: 8, side: 1 },
};
