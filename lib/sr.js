// 支撐壓力區＋SMC 趨勢（觀察用，不計分、不推播）
// 區：在近 300 根中找能包到最多影線的價位帶（寬 0.4～1.0 ATR，扣穿過的實體與寬度），區與區至少隔 1 ATR。
//     ③長影線尖端密集處（≥3 根）。強度＝區內轉折數＋0.5×長影線數＋1.5×穿過區的均線條數（均線重疊越多越重要）＋與 BOS／CHoCH 訂單塊重疊 +1。
//     只畫關鍵：現價上方、下方各 1 個（3 ATR 內最強，沒有就取最近）＋包住現價的區。區不分支撐／壓力，上方＝壓力、下方＝支撐。
// 區只用 4H 算（大時區），1H／15 分圖畫的是同一組 4H 區（useBigZones）；結構（BOS／CHoCH）各週期自己算。
// 趨勢（SMC）：左右各 5 根確認轉折；收盤突破最近未被突破的轉折高＝向上（原本空頭→CHoCH，否則 BOS），跌破轉折低同理。
// ⚠ 專案回測（2026-11-25）：在這類區掛單（斐波 0.5 以下、OB／前高翻轉／影線區）扣費後皆為負、不比隨機好 → 只畫參考，不給進出場。
import { EMA_P } from './ema.js';
const ema = (a, n) => { const k = 2 / (n + 1), o = [a[0]]; for (let i = 1; i < a.length; i++) o.push(o[i - 1] + k * (a[i] - o[i - 1])); return o; };
const atr14 = (B) => { const tr = B.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l)); let s = 0; return tr.map((x, i) => { s += x; if (i >= 14) s -= tr[i - 14]; return i >= 13 ? s / 14 : s / (i + 1); }); };
const r6 = (x) => (x == null || x !== x ? null : +x.toPrecision(7));
const K = 5;

// 台股 1H → 4H（同一交易日 09:00–12:59 一根、13:00 之後一根，與 TradingView 台股 4H 相同切法）
export function tw4h(H) {
  const out = [];
  for (const b of H) {
    const d = new Date(b.t + 8 * 3600e3), key = d.toISOString().slice(0, 10) + (d.getUTCHours() >= 13 ? 'b' : 'a'), l = out[out.length - 1];
    if (l && l.key === key) { l.h = Math.max(l.h, b.h); l.l = Math.min(l.l, b.l); l.c = b.c; l.v += b.v || 0; }
    else out.push({ key, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
  }
  return out.map(({ key, ...b }) => b);
}

export function srScan(B, keep = 140, zonesOn = true) {
  const n = B.length; if (n < 120) return null;
  const o = B.map((b) => b.o), h = B.map((b) => b.h), l = B.map((b) => b.l), c = B.map((b) => b.c), A = atr14(B), E = EMA_P.map((p) => ema(c, p));
  const isPH = (i) => { for (let k = 1; k <= K; k++) if (!(h[i] > h[i - k] && h[i] >= h[i + k])) return false; return true; };
  const isPL = (i) => { for (let k = 1; k <= K; k++) if (!(l[i] < l[i - k] && l[i] <= l[i + k])) return false; return true; };
  const zones = [], evs = []; let lh = null, ll = null, trend = 0;
  const clamp = (lo, hi, a, up) => { const w = Math.min(Math.max(hi - lo, 0.25 * a), a); return up ? [lo, lo + w] : [hi - w, hi]; };
  for (let j = K; j < n; j++) {
    const i = j - K; // 第 j 根收盤時，第 i 根轉折才確認
    if (i >= K) {
      if (isPH(i)) { lh = { i, v: h[i], used: false }; const [lo, hi] = clamp(Math.max(o[i], c[i]), h[i], A[i], false); zones.push({ lo, hi, i, k: '轉折' }); }
      if (isPL(i)) { ll = { i, v: l[i], used: false }; const [lo, hi] = clamp(l[i], Math.min(o[i], c[i]), A[i], true); zones.push({ lo, hi, i, k: '轉折' }); }
    }
    for (const up of [true, false]) {
      const p = up ? lh : ll; if (!p || p.used || !(up ? c[j] > p.v : c[j] < p.v)) continue;
      p.used = true; const type = trend === (up ? 1 : -1) ? 'BOS' : 'CHoCH'; trend = up ? 1 : -1;
      evs.push({ j, i: p.i, v: p.v, dir: trend, type });
      // 訂單塊：這段突破走勢的起點（近 30 根內最低／最高），往前 3 根內最後一根反向 K
      const a0 = Math.max(0, j - 30); let m = a0;
      for (let q = a0; q <= j; q++) if (up ? l[q] < l[m] : h[q] > h[m]) m = q;
      let q = m; for (let r = m; r >= Math.max(0, m - 3); r--) if (up ? c[r] < o[r] : c[r] > o[r]) { q = r; break; }
      const [lo, hi] = up ? clamp(l[q], h[q] - l[q] > A[j] ? Math.max(o[q], c[q]) : h[q], A[j], true) : clamp(h[q] - l[q] > A[j] ? Math.min(o[q], c[q]) : l[q], h[q], A[j], false);
      zones.push({ lo, hi, i: q, k: 'OB' });
    }
  }
  // 區＝價格最常轉折的地方：近 300 根所有轉折高／低點（左右各 3 根）依價格分群（同群價差 ≤0.6 ATR），
  // 至少 2 個轉折才算區；強度＝轉折數（與訂單塊重疊再 +1）。高低點混在一起算：原本的壓力被突破就變支撐。
  const px = c[n - 1], a = A[n - 1];
  // 區＝能包到最多影線的價位帶：近 300 根每根 K 的上、下影線（≥0.15 ATR）當線段，
  // 在每個價位試 0.4～1.0 ATR 寬的帶，分數＝碰到的影線數 −0.5×穿過的實體數 −2×(寬/ATR)，取最佳寬度；
  // 再由高分往低挑，和已選帶距離 <1 ATR 的丟掉（兩區之間拉開）；至少碰到 3 根影線才算。
  const i0 = Math.max(0, n - 300), WK = [], BD = [];
  for (let i = i0; i < n; i++) {
    const top = Math.max(o[i], c[i]), bot = Math.min(o[i], c[i]);
    if (h[i] - top >= 0.15 * a) WK.push([top, h[i], i]); if (bot - l[i] >= 0.15 * a) WK.push([l[i], bot, i]);
    BD.push([bot, top]);
  }
  const lo0 = Math.min(...l.slice(i0)), hi0 = Math.max(...h.slice(i0)), C0 = [];
  for (let y = lo0; zonesOn && y <= hi0; y += 0.1 * a) { // 1H／15 分用 4H 的區，不必算
    let bst = null;
    for (const w of [0.4, 0.6, 0.8, 1.0]) {
      const y2 = y + w * a; let nw = 0, nb = 0, fi = n;
      for (const [s, e, i] of WK) if (s <= y2 && e >= y) { nw++; if (i < fi) fi = i; }
      for (const [s, e] of BD) if (s <= y2 && e >= y) nb++;
      const q = nw - 0.5 * nb - 2 * w;
      if (nw >= 3 && (!bst || q > bst.q)) bst = { lo: y, hi: y2, q, w: nw, b: nb, i: fi };
    }
    if (bst) C0.push(bst);
  }
  const En = E.map((e) => e[n - 1]);
  const C = [];
  for (const z of C0.sort((x, y) => y.q - x.q)) if (z.q > 0 && C.every((k) => Math.max(z.lo - k.hi, k.lo - z.hi) >= 1.0 * a)) C.push(z);
  // 強度＝影線分數＋1.5×穿過區的均線條數（均線重疊越多越重要）＋訂單塊 1
  const Z = C.map((z) => {
    const ne = En.filter((v) => v >= z.lo - 0.25 * a && v <= z.hi + 0.25 * a).length, ob = zones.some((k) => k.k === 'OB' && k.i >= i0 && k.lo <= z.hi && k.hi >= z.lo);
    return { ...z, p: z.w, e: ne, n: z.q + 1.5 * ne + (ob ? 1 : 0) };
  });
  // 只畫關鍵：上方、下方各 1 個。3 ATR 內取最強；3 ATR 內沒有就取最近的
  const best = (L, d) => { const nr = L.filter((z) => d(z) <= 3 * a && z.n >= 2); return (nr.length ? nr.sort((x, y) => y.n - x.n || d(x) - d(y)) : L.sort((x, y) => d(x) - d(y))).slice(0, 1); };
  const at = Z.filter((z) => z.lo <= px && px <= z.hi).sort((x, y) => y.n - x.n).slice(0, 1);
  const up = best(Z.filter((z) => z.lo > px), (z) => z.lo - px), dn = best(Z.filter((z) => z.hi < px), (z) => px - z.hi);
  const s0 = Math.max(0, n - keep), X = (i) => i - s0;
  const pick = [...up.map((z) => ({ ...z, r: '壓力' })), ...at.map((z) => ({ ...z, r: '現價' })), ...dn.map((z) => ({ ...z, r: '支撐' }))];
  // 曾經碰過的區：圖上這段期間價格有碰到、但不是上面那幾個關鍵區的，只留強度 ≥4 的最強 2 個（虛線框）
  const key = new Set([...up, ...at, ...dn]);
  const old = Z.filter((z) => !key.has(z) && z.n >= 4 && B.slice(s0).some((b) => b.l <= z.hi && b.h >= z.lo)).sort((x, y) => y.n - x.n).slice(0, 2);
  pick.push(...old.map((z) => ({ ...z, r: z.hi < px ? '支撐' : z.lo > px ? '壓力' : '現價', old: true })));
  const last = evs[evs.length - 1];
  const sum = {
    trend, price: r6(px),
    ev: last ? { type: last.type, dir: last.dir, ago: n - 1 - last.j, v: r6(last.v) } : null,
    inZone: at.length > 0, a: r6(a),
    res: up[0] ? r6((up[0].lo - px) / a) : null, sup: dn[0] ? r6((px - dn[0].hi) / a) : null, // 距最近壓力／支撐幾個 ATR
  };
  const chart = {
    bars: B.slice(s0).map((b) => [r6(b.o), r6(b.h), r6(b.l), r6(b.c)]), t: B.slice(s0).map((b) => b.t),
    e: E.map((e) => e.slice(s0).map(r6)),
    z: pick.map((z) => ({ lo: r6(z.lo), hi: r6(z.hi), x: X(z.i), ts: B[z.i].t, r: z.r, old: !!z.old, n: r6(z.n), p: z.p, e: z.e })),
    ev: evs.filter((e) => e.j >= s0).slice(-4).map((e) => ({ x0: X(e.i), x1: X(e.j), v: r6(e.v), d: e.dir, type: e.type })),
  };
  return { sum, chart };
}

// 支撐壓力區一律用 4H（大時區）：把 4H 的區畫到 1H／15 分圖上，並用各自現價重算在區內／距離（距離仍以 4H ATR 計）
export function useBigZones(r, big) {
  if (!r || !big) return r;
  const { chart, sum } = r, px = sum.price, a = big.sum.a, t = chart.t;
  chart.z = big.chart.z.map((z) => {
    let x = t.findIndex((v) => v >= z.ts); if (x < 0) x = t.length - 1;
    return { ...z, x, r: z.hi < px ? '支撐' : z.lo > px ? '壓力' : '現價' };
  });
  const up = chart.z.filter((z) => z.lo > px && !z.old), dn = chart.z.filter((z) => z.hi < px && !z.old);
  sum.inZone = chart.z.some((z) => z.lo <= px && px <= z.hi);
  sum.res = up.length ? r6((Math.min(...up.map((z) => z.lo)) - px) / a) : null;
  sum.sup = dn.length ? r6((px - Math.max(...dn.map((z) => z.hi))) / a) : null;
  return r;
}
