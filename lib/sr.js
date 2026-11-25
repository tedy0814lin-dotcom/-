// 支撐壓力區＋SMC 趨勢（觀察用，不計分、不推播）
// 區：近 300 根影線尖端（轉折點或長影線）依價格分群（≤0.6 ATR；≥2 個轉折或 ≥3 根長影線），區以影線為主、再延伸到實體邊（中位數）；另加現在均線密集處。區與區至少隔 1 ATR。
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

export function srScan(B, keep = 140) {
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
  const px = c[n - 1], a = A[n - 1], Q = [];
  // 點＝K 棒的影線尖端（轉折高低點左右各 3 根、或長影線：影線 ≥ 實體且 ≥0.3 ATR），帶著該 K 的實體邊（區以影線為主、再延伸到實體）
  for (let i = Math.max(3, n - 300); i < n; i++) {
    const bd = Math.abs(c[i] - o[i]), top = Math.max(o[i], c[i]), bot = Math.min(o[i], c[i]);
    let ph = i < n - 3, pl = i < n - 3;
    for (let k = 1; k <= 3 && i < n - 3; k++) { if (!(h[i] > h[i - k] && h[i] >= h[i + k])) ph = false; if (!(l[i] < l[i - k] && l[i] <= l[i + k])) pl = false; }
    const wu = h[i] - top >= bd && h[i] - top >= 0.3 * a, wl = bot - l[i] >= bd && bot - l[i] >= 0.3 * a;
    if (ph || wu) Q.push({ v: h[i], e: top, up: true, i, pv: ph, w: wu });
    if (pl || wl) Q.push({ v: l[i], e: bot, up: false, i, pv: pl, w: wl });
  }
  Q.sort((x, y) => x.v - y.v);
  const grp = (V, f) => { const G = []; for (let k = 0; k < V.length;) { let m = k; while (m + 1 < V.length && f(V[m + 1]) - f(V[k]) <= 0.6 * a) m++; G.push(V.slice(k, m + 1)); k = m + 1; } return G; };
  const med = (v) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pad = (lo, hi) => (hi - lo < 0.2 * a ? [(lo + hi) / 2 - 0.1 * a, (lo + hi) / 2 + 0.1 * a] : [lo, hi]);
  const cand = [];
  for (const g of grp(Q, (q) => q.v)) {
    if (g.filter((q) => q.pv).length < 2 && g.filter((q) => q.w).length < 3) continue;
    const tl = Math.min(...g.map((q) => q.v)), th = Math.max(...g.map((q) => q.v));
    const eu = g.filter((q) => q.up).map((q) => q.e), el = g.filter((q) => !q.up).map((q) => q.e); // 上影線往下延伸到實體、下影線往上延伸
    let lo = eu.length ? Math.min(tl, med(eu)) : tl, hi = el.length ? Math.max(th, med(el)) : th;
    if (hi - lo > 0.6 * a) { lo = Math.max(lo, tl - 0.1 * a); hi = Math.min(hi, th + 0.1 * a); } // 區要窄：最寬約 0.6 ATR，實體太長只延伸一點
    if (hi - lo > 0.6 * a) { const m = med(g.map((q) => q.v)); lo = Math.max(lo, m - 0.3 * a); hi = Math.min(hi, m + 0.3 * a); } // 影線本身散太開 → 以影線中位數為中心收窄
    cand.push(pad(lo, hi));
  }
  const En = E.map((e) => e[n - 1]).sort((x, y) => x - y);
  for (const g of grp(En, (v) => v)) if (g.length >= 2) cand.push(pad(g[0], g[g.length - 1])); // 均線密集處本身也是候選區
  // 強度＝區內轉折數＋0.5×長影線數＋1.5×穿過區的均線條數＋訂單塊 1
  const Z0 = [];
  for (const [lo, hi] of cand) {
    const inQ = Q.filter((q) => q.v >= lo && q.v <= hi), np = inQ.filter((q) => q.pv).length, nw = inQ.filter((q) => q.w).length;
    const ne = En.filter((v) => v >= lo - 0.25 * a && v <= hi + 0.25 * a).length;
    const ob = zones.some((z) => z.k === 'OB' && z.i >= n - 300 && z.lo <= hi && z.hi >= lo);
    Z0.push({ lo, hi, i: inQ.length ? Math.min(...inQ.map((q) => q.i)) : n - 1, p: np, e: ne, w: nw, n: np + 0.5 * nw + 1.5 * ne + (ob ? 1 : 0) });
  }
  // 區與區至少隔 1 ATR：由強到弱挑，太靠近較強區的丟掉
  const Z = [];
  for (const z of Z0.sort((x, y) => y.n - x.n)) if (Z.every((k) => Math.max(z.lo - k.hi, k.lo - z.hi) >= 1.0 * a)) Z.push(z);
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
