// 支撐壓力區＋SMC 趨勢（觀察用，不計分、不推播）
// 區：①結構突破（BOS／CHoCH）前那段走勢起點的訂單塊（最後一根反向 K）②確認的轉折點影線區。寬度限 0.25～1 ATR，重疊的合併（取較新的），只看近 300 根。
//     區不分支撐／壓力：在現價上方就是壓力、下方就是支撐、包住現價＝現價區。圖上只畫現價上下各最近 2 個（＋現價區）。
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
  // 合併：重疊超過較窄者 30% → 留較新的，記下來源與合併次數
  const Z = [];
  for (const z of zones.filter((z) => z.i >= n - 300).sort((a, b) => b.i - a.i)) {
    const ov = Z.find((y) => Math.min(y.hi, z.hi) - Math.max(y.lo, z.lo) > 0.3 * Math.min(y.hi - y.lo, z.hi - z.lo));
    if (ov) { ov.n++; if (!ov.k.includes(z.k)) ov.k += '+' + z.k; } else Z.push({ ...z, n: 1 });
  }
  for (const z of Z) { let t = 0, last = -9; for (let j = z.i + 1; j < n; j++) if (l[j] <= z.hi && h[j] >= z.lo) { if (j - last > 3) t++; last = j; } z.t = t; }
  const px = c[n - 1], a = A[n - 1];
  const at = Z.filter((z) => z.lo <= px && px <= z.hi).sort((x, y) => y.i - x.i).slice(0, 1);
  const up = Z.filter((z) => z.lo > px).sort((x, y) => x.lo - y.lo).slice(0, 2), dn = Z.filter((z) => z.hi < px).sort((x, y) => y.hi - x.hi).slice(0, 2);
  const s0 = Math.max(0, n - keep), X = (i) => i - s0;
  const pick = [...up.map((z) => ({ ...z, r: '壓力' })), ...at.map((z) => ({ ...z, r: '現價' })), ...dn.map((z) => ({ ...z, r: '支撐' }))];
  const last = evs[evs.length - 1];
  const sum = {
    trend, price: r6(px),
    ev: last ? { type: last.type, dir: last.dir, ago: n - 1 - last.j, v: r6(last.v) } : null,
    inZone: at.length > 0,
    res: up[0] ? r6((up[0].lo - px) / a) : null, sup: dn[0] ? r6((px - dn[0].hi) / a) : null, // 距最近壓力／支撐幾個 ATR
  };
  const chart = {
    bars: B.slice(s0).map((b) => [r6(b.o), r6(b.h), r6(b.l), r6(b.c)]), t: B.slice(s0).map((b) => b.t),
    e: E.map((e) => e.slice(s0).map(r6)),
    z: pick.map((z) => ({ lo: r6(z.lo), hi: r6(z.hi), x: X(z.i), k: z.k, r: z.r, t: z.t })),
    ev: evs.filter((e) => e.j >= s0).slice(-4).map((e) => ({ x0: X(e.i), x1: X(e.j), v: r6(e.v), d: e.dir, type: e.type })),
  };
  return { sum, chart };
}
