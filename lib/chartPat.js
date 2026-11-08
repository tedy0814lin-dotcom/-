// 圖表型態（雙底、三重底、矩形、上升三角形，只做多）：用 ATR 之字轉折（反轉幅度 K×ATR14、反轉後才確認，沒有偷看未來）找高低點，
// 再用幾何規則判斷型態，收盤突破頸線就進場（下一根開盤）。跟 Python 回測（ptn10.py，旗標 pct+tight）逐根對照過。
//   pct  ：兩個高／低點允許百分比誤差（EQP），三重底 4%，並要求左右時間大致對稱（0.4～2.5 倍）
//   tight：K 棒影線最多只算到實體外 1ATR（避免插針當成轉折點）
// 各型態的時區與參數是在 12H／4H、54 組參數裡「前 75% 日期挑參數、後 25% 驗證」選出來的，見 categories.js 的說明。
function atr14(B) {
  const o = new Array(B.length); let a = 0;
  for (let i = 0; i < B.length; i++) {
    const pc = i ? B[i - 1].c : B[0].c;
    const tr = Math.max(B[i].h - B[i].l, Math.abs(B[i].h - pc), Math.abs(B[i].l - pc));
    a = i ? a * (1 - 1 / 14) + tr / 14 : tr; o[i] = a;
  }
  return o;
}
const WAIT = 15;
// 對 c[i0..t] 做二次曲線最小平方（y = a x² + b x + c），回傳 { a, r2 }
function quad(c, i0, t) {
  const m = t - i0 + 1; let s1 = m, sx = 0, sxx = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sxxy = 0, syy = 0;
  for (let k = 0; k < m; k++) { const x = k, y = c[i0 + k]; sx += x; sxx += x * x; sx3 += x ** 3; sx4 += x ** 4; sy += y; sxy += x * y; sxxy += x * x * y; syy += y * y; }
  const M = [[sx4, sx3, sxx, sxxy], [sx3, sxx, sx, sxy], [sxx, sx, s1, sy]];
  for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; if (!M[i][i]) return null;
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let k = i; k < 4; k++) M[r][k] -= f * M[i][k]; } }
  const A2 = M[0][3] / M[0][0], B2 = M[1][3] / M[1][1], C2 = M[2][3] / M[2][2];
  let ssr = 0, sst = 0; const ym = sy / m;
  for (let k = 0; k < m; k++) { const y = c[i0 + k], f = A2 * k * k + B2 * k + C2; ssr += (y - f) ** 2; sst += (y - ym) ** 2; }
  return { a: A2, r2: 1 - ssr / Math.max(sst, 1e-12) };
}

// 單一轉折尺度 K 的事件：回傳 [{kind, i（進場那根）, stop, sb（突破收盤那根）}]
function events(B, A, K, eqp) {
  const n = B.length, ev = [], piv = [];
  const h = B.map((b, t) => Math.min(b.h, Math.max(b.o, b.c) + A[t]));
  const l = B.map((b, t) => Math.max(b.l, Math.min(b.o, b.c) - A[t]));
  const c = B.map((b) => b.c);
  let d = 0, ei = 0, ext = h[0], pend = []; const regs = [];
  for (let t = 1; t < n; t++) {
    const a = A[t];
    let newp = false;
    if (d >= 0) {
      if (h[t] >= ext) { ext = h[t]; ei = t; }
      if (d === 0) d = 1;
      if (l[t] <= ext - K * a) { piv.push([1, ei, ext]); d = -1; ext = l[t]; ei = t; newp = true; }
    } else {
      if (l[t] <= ext) { ext = l[t]; ei = t; }
      if (h[t] >= ext + K * a) { piv.push([-1, ei, ext]); d = 1; ext = h[t]; ei = t; newp = true; }
    }
    const keep = [];
    for (const p of pend) {
      const lvl = p.neck[0] + p.neck[2] * (t - p.neck[1]);
      if (c[t] > lvl && t <= p.exp) ev.push({ kind: p.kind, i: t + 1, stop: p.stop, sb: t, neck: p.neck, pts: p.pts });
      else if (t <= p.exp && c[t] > p.stop && !(c[t] > lvl)) keep.push(p);
    }
    pend = keep;
    // 圓弧底：48 根內收盤的二次曲線開口向上（R² ≥0.6）、最低點落在中間 50%、收盤突破左緣高點
    if (t >= 108) {
      const W = 48, i0 = t - W; let rim = -Infinity;
      for (let q = i0; q < i0 + 6; q++) rim = Math.max(rim, c[q]);
      if (c[t] > rim && c[t - 1] <= rim) {
        let mi = 0, ymin = Infinity; for (let q = 0; q <= W; q++) { if (c[i0 + q] < ymin) { ymin = c[i0 + q]; mi = q; } }
        if (mi >= 0.25 * W && mi <= 0.75 * W && rim - ymin >= 4 * a) {
          const co = quad(c, i0, t);
          if (co && co.a > 0 && co.r2 >= 0.6) {
            let lo = Infinity; for (let q = i0; q <= t; q++) lo = Math.min(lo, l[q]);
            ev.push({ kind: 'rounded_bottom', i: t + 1, stop: lo - 0.1 * a, sb: t, neck: [c[t], t, 0], pts: [[i0 + mi, l[i0 + mi]]] });
          }
        }
      }
    }
    // V 底：8 根內的急跌低點（前面 8 根高點到低點跌 ≥5ATR），收盤回升 60% 的位置
    if (t >= 70) {
      let m2 = t - 8, lm = Infinity; for (let q = t - 8; q < t; q++) if (l[q] < lm) { lm = l[q]; m2 = q; }
      let H0 = 0; if (m2 > 0) { H0 = -Infinity; for (let q = Math.max(0, m2 - 8); q < m2; q++) H0 = Math.max(H0, h[q]); }
      const drop = H0 - l[m2];
      if (drop >= 5 * a) {
        const reb = l[m2] + 0.6 * drop;
        if (c[t] >= reb && c[t - 1] < reb && t - m2 <= 8) ev.push({ kind: 'v_bottom', i: t + 1, stop: l[m2] - 0.1 * a, sb: t, neck: [c[t], t, 0], pts: [[m2, l[m2]]] });
      }
    }
    if (newp && piv.length >= 3) {
      const P = piv, vv = P.map((p) => p[2]), ix = P.map((p) => p[1]), m = P.length;
      const v = (k) => vv[m + k], x = (k) => ix[m + k];
      const eq = (p, q, pct = 0.03) => Math.abs(p - q) <= pct * (eqp / 0.03) * Math.abs(p);
      const tsym = (i1, i2, i3) => { const r = (i2 - i1) / Math.max(i3 - i2, 1); return r >= 0.4 && r <= 2.5; };
      const reg = (kind, neck, stop, i0) => { const it = { kind, neck, stop: stop - 0.1 * a, exp: t + WAIT, born: t, pts: P.slice(-8).filter((q) => q[1] >= i0).map((q) => [q[1], q[2]]) }; pend.push(it); regs.push({ ...it, i: t + 1 }); };
      if (P[m - 1][0] === -1) {
        if (eq(v(-1), v(-3)) && v(-2) - Math.min(v(-1), v(-3)) >= 2 * a && tsym(x(-3), x(-2), x(-1)))
          reg('double_bottom', [v(-2), x(-2), 0], Math.min(v(-1), v(-3)), x(-3));
        if (m >= 5) {
          const mx = Math.max(v(-1), v(-3), v(-5)), mn = Math.min(v(-1), v(-3), v(-5));
          if (mx - mn <= 0.04 * Math.abs(v(-1)) && Math.min(v(-2), v(-4)) - v(-1) >= 1.5 * a)
            reg('triple_bottom', [Math.max(v(-2), v(-4)), x(-2), 0], mn, x(-5));
          if (v(-3) < v(-1) - 0.5 * a && v(-3) < v(-5) - 0.5 * a && eq(v(-1), v(-5), 0.05) && x(-4) !== x(-2) && tsym(x(-5), x(-3), x(-1))
            && Math.abs(v(-4) - v(-2)) <= 0.4 * ((v(-4) + v(-2)) / 2 - v(-3)))
            reg('inv_HS', [v(-4), x(-4), (v(-2) - v(-4)) / (x(-2) - x(-4))], v(-1), x(-5));
          if (P[m - 4][0] === 1) {
            const H1 = v(-4), L1 = v(-3), H2 = v(-2), L2 = v(-1);
            if ((H2 - L2) <= 0.75 * (H1 - L1)) {
              if (Math.abs(H1 - H2) <= a && L2 > L1 + 0.5 * a) reg('asc_triangle', [Math.max(H1, H2), x(-2), 0], L2, x(-4));
              if (H1 > H2 + 0.5 * a && L2 > L1 + 0.5 * a) reg('sym_triangle', [H2, x(-2), (H2 - H1) / (x(-2) - x(-4))], L2, x(-4));
              if (H1 > H2 + 0.5 * a && L1 > L2 + 0.5 * a && (H1 - H2) > (L1 - L2) * 0.8 && (H1 - H2) <= 8 * a) reg('falling_wedge', [H2, x(-2), (H2 - H1) / (x(-2) - x(-4))], L2, x(-4));
            }
            if (eq(H1, H2) && eq(L1, L2) && H1 - L1 >= 2 * a) reg('rectangle', [Math.max(H1, H2), x(-2), 0], Math.min(L1, L2), x(-4));
          }
          if (P[m - 4][0] === 1 && P[m - 5][0] === -1) {
            const L1 = v(-5), H1 = v(-4), L2 = v(-3), H2 = v(-2), L3 = v(-1);
            if (H2 > H1 + 0.5 * a && L2 < L1 - 0.5 * a && L3 < L2 - 0.5 * a) reg('broadening', [H2, x(-2), 0], L3, x(-5));
          }
          // 菱形＝連續兩個收斂三角形（各自高點降、低點升，沒有擴散段）；2026-11-08 由「先擴散再收斂」改（回測 ptn13.py）
          if (m >= 8 && P[m - 8][0] === 1) {
            const H1 = v(-8), L1 = v(-7), H2 = v(-6), L2 = v(-5), H3 = v(-4), L3 = v(-3), H4 = v(-2), L4 = v(-1);
            if (H1 > H2 + 0.5 * a && L2 > L1 + 0.5 * a && H3 > H4 + 0.5 * a && L4 > L3 + 0.5 * a) reg('diamond', [H4, x(-2), 0], L4, x(-8));
          }
        }
      }
    }
  }
  return { ev, pend, regs };
}

// 全部事件（多尺度合併、同型態 12 根內只留最早的），i＝進場那根
export function patEvents(B, cfg) {
  const A = atr14(B), all = [];
  cfg.KS.forEach((K, qi) => {
    for (const e of events(B, A, K, cfg.eqp).ev) {
      if (qi === 0 && cfg.KS.length > 1 && e.kind !== 'double_bottom') continue;
      if (cfg.kinds.includes(e.kind)) all.push(e);
    }
  });
  all.sort((p, q) => p.i - q.i);
  const kept = [], last = {};
  for (const e of all) {
    if (e.kind in last && e.i - last[e.kind] <= 12) continue;
    last[e.kind] = e.i; kept.push(e);
  }
  return kept;
}

// 「底部早進場」：型態一成形（最後一個低點被之字轉折確認）就在下一根開盤進場，不等突破頸線；停損＝型態低點下 0.1 ATR。
// 與回測 ptn11.py（F=pct,tight,early；兩個尺度都收所有型態；同型態 12 根內只留最早）逐筆一致（EARLY_CFG 各組 1,617 筆 0 差異）。
export function earlyEvents(B, cfg) {
  const A = atr14(B), all = [];
  for (const K of cfg.KS) for (const e of events(B, A, K, cfg.eqp).regs) if (cfg.kinds.includes(e.kind)) all.push(e);
  all.sort((p, q) => p.i - q.i);
  const kept = [], last = {};
  for (const e of all) {
    if (e.kind in last && e.i - last[e.kind] <= 12) continue;
    last[e.kind] = e.i; kept.push(e);
  }
  return kept;
}
// 2026-11-04 逐型態、逐時區挑參數（27 組：轉折尺度 1.5/2.5、2/3、2.5 × 容錯 2/3/4% × 過濾 3 種；前 75% 挑、後 25% 驗證）
export const EARLY_CFG = {
  eTri12:  { tf: '12H', kinds: ['triple_bottom'], KS: [2, 3],     eqp: 0.02, R: 4 },
  eDia12:  { tf: '12H', kinds: ['diamond'],       KS: [1.5, 2.5], eqp: 0.02, R: 4 },
  eDbl12:  { tf: '12H', kinds: ['double_bottom'], KS: [1.5, 2.5], eqp: 0.04, R: 4 },
  eRect12: { tf: '12H', kinds: ['rectangle'],     KS: [1.5, 2.5], eqp: 0.04, R: 4 },
  eDbl1d:  { tf: '1D',  kinds: ['double_bottom'], KS: [2, 3],     eqp: 0.04, R: 4 },
  eRect1d: { tf: '1D',  kinds: ['rectangle'],     KS: [1.5, 2.5], eqp: 0.04, R: 4 },
  eTri1d:  { tf: '1D',  kinds: ['triple_bottom'], KS: [1.5, 2.5], eqp: 0.02, R: 4 },
};
// 最新收盤那根剛成形（下一根開盤就是進場點）；回測條件：前面至少 101 根、停損距離 ≤25%
export function earlySignals(B, keys) {
  if (!B || B.length < 120) return {};
  const n = B.length, out = {}, last = B[n - 1].c;
  for (const k of keys) {
    const ev = earlyEvents(B, EARLY_CFG[k]).filter((e) => e.born >= n - 2 && e.born >= 101 && last > e.stop && (last - e.stop) / last <= 0.25);
    if (!ev.length) continue;
    const e = ev[ev.length - 1];
    out[k] = { ago: n - 1 - e.born, entry: last, stop: e.stop, side: 1, neck: e.neck[0], neckLine: e.neck, kind: e.kind, pts: e.pts };
  }
  return out;
}
// 12H K 棒合成日 K（幣安日線＝UTC 00:00 開始，等於 00:00 與 12:00 兩根 12H 合併）；t 為開盤時間（毫秒）
export function dailyFrom12h(B12) {
  const out = [];
  for (let i = 0; i + 1 < B12.length; i++) {
    const a = B12[i], b = B12[i + 1];
    if (new Date(a.t).getUTCHours() !== 0 || b.t - a.t !== 12 * 3600e3) continue;
    out.push({ o: a.o, h: Math.max(a.h, b.h), l: Math.min(a.l, b.l), c: b.c, v: a.v + b.v, t: a.t }); i++;
  }
  return out;
}

// 各型態採用的時區與參數（來源：54 組網格，前 75% 挑、後 25% 驗證）
export const PAT_CFG = {
  pDbl4:  { tf: '4H',  kinds: ['double_bottom'], KS: [2, 3],   eqp: 0.02, R: 3 },
  pTri4:  { tf: '4H',  kinds: ['triple_bottom'], KS: [2, 3],   eqp: 0.02, R: 4 },
  pRect4: { tf: '4H',  kinds: ['rectangle'],     KS: [2, 3],   eqp: 0.04, R: 4 },
  pAsc4:  { tf: '4H',  kinds: ['asc_triangle'],  KS: [1.5, 2.5], eqp: 0.02, R: 4 },
  pDbl12: { tf: '12H', kinds: ['double_bottom'], KS: [2, 3],   eqp: 0.04, R: 4 },
};

// 最新一根（或前一根）收盤剛突破頸線的型態；entry 用最新收盤價近似下一根開盤
export function patSignals(B, keys) {
  if (!B || B.length < 120) return {};
  const n = B.length, out = {};
  for (const k of keys) {
    const ev = patEvents(B, PAT_CFG[k]).filter((e) => e.sb >= n - 2);
    if (!ev.length) continue;
    const e = ev[ev.length - 1];
    out[k] = { ago: n - 1 - e.sb, entry: B[n - 1].c, stop: e.stop, side: 1 };
  }
  return out;
}

// 台股／通用掃描：回傳「已經形成」（最近 6 根內收盤突破頸線、現價仍在停損之上）與「正在形成」（型態已成形、還沒突破頸線，等待中）
// cfg.kinds 內的型態；沒有經過回測挑參數，只做看圖參考
export function patScan(B, cfg) {
  if (!B || B.length < 120) return { formed: [], forming: [] };
  const n = B.length, A = atr14(B), last = B[n - 1].c;
  const evs = [], pends = [];
  cfg.KS.forEach((K, qi) => {
    const r = events(B, A, K, cfg.eqp);
    for (const e of r.ev) if (!(qi === 0 && cfg.KS.length > 1 && e.kind !== 'double_bottom') && cfg.kinds.includes(e.kind)) evs.push(e);
    for (const p of r.pend) if (!(qi === 0 && cfg.KS.length > 1 && p.kind !== 'double_bottom') && cfg.kinds.includes(p.kind)) pends.push(p);
  });
  evs.sort((p, q) => p.i - q.i);
  const kept = [], lastI = {};
  for (const e of evs) { if (e.kind in lastI && e.i - lastI[e.kind] <= 12) continue; lastI[e.kind] = e.i; kept.push(e); }
  const formed = kept.filter((e) => e.sb >= n - 6 && last > e.stop).map((e) => ({ kind: e.kind, ago: n - 1 - e.sb, stop: e.stop, last, neckLine: e.neck, pts: e.pts || [] }));
  const seen = new Set(formed.map((f) => f.kind)), forming = [];
  for (const p of pends.sort((a, b) => b.born - a.born)) {
    if (seen.has(p.kind)) continue; // 同型態已經突破就不重複列
    const neck = p.neck[0] + p.neck[2] * ((n - 1) - p.neck[1]);
    if (!(last > p.stop && last <= neck)) continue;
    seen.add(p.kind);
    forming.push({ kind: p.kind, neck, stop: p.stop, last, distPct: (neck / last - 1) * 100, bornAgo: n - 1 - p.born, left: p.exp - (n - 1), neckLine: p.neck, pts: p.pts || [] });
  }
  return { formed, forming };
}
export const PAT_UP = { double_bottom: '雙底', triple_bottom: '三重底', inv_HS: '頭肩底', rectangle: '矩形整理（向上突破）', asc_triangle: '上升三角形', sym_triangle: '對稱三角形（向上突破）', falling_wedge: '下降楔形', rounded_bottom: '圓弧底', v_bottom: 'V 型底', broadening: '擴散三角形（底部）', diamond: '菱形（底部）', conv_asc: '收斂三角形（上升）', conv_desc: '收斂三角形（下降）', conv_sym: '收斂三角形（對稱）', conv_fwedge: '下降楔形（收斂）', conv_rwedge: '上升楔形（收斂）' };
export const PAT_DN = { double_bottom: '雙頂', triple_bottom: '三重頂', inv_HS: '頭肩頂', rectangle: '矩形整理（向下跌破）', asc_triangle: '下降三角形', sym_triangle: '對稱三角形（向下跌破）', falling_wedge: '上升楔形', rounded_bottom: '圓弧頂', v_bottom: '倒 V 型頂', broadening: '擴散三角形（頂部）', diamond: '菱形（頂部）', conv_asc: '收斂三角形（向下跌破）', conv_desc: '收斂三角形（向下跌破）', conv_sym: '收斂三角形（向下跌破）', conv_fwedge: '上升楔形（向下跌破）', conv_rwedge: '下降楔形（向下跌破）' };
export const PAT_NAME = PAT_UP;
export const PAT_TW = { kinds: ['double_bottom', 'triple_bottom', 'inv_HS', 'rectangle', 'asc_triangle', 'sym_triangle', 'falling_wedge', 'rounded_bottom', 'v_bottom', 'broadening', 'diamond'], KS: [2, 3], eqp: 0.03 };
const mirrorBars = (B) => B.map((x) => ({ o: -x.o, h: -x.l, l: -x.h, c: -x.c, v: x.v }));
// 偏多（底部／向上突破）與偏空（頭部／向下跌破，用鏡像偵測）一起掃；回傳統一格式的清單
export function scanAll(B) {
  const out = [];
  if (!B || B.length < 120) return out;
  const n = B.length;
  const conv = (it, sg) => {
    const f = (v) => (v == null ? v : sg * v);
    const nl = it.neckLine ? { i: it.neckLine[1], v: f(it.neckLine[0]), s: f(it.neckLine[2]) } : null;
    return { dir: sg, kind: it.kind, name: (sg > 0 ? PAT_UP : PAT_DN)[it.kind] || it.kind, state: it.ago == null ? 'forming' : 'formed', ago: it.ago, stop: f(it.stop), last: f(it.last),
      neck: it.neck == null ? (nl ? nl.v + nl.s * (n - 1 - nl.i) : null) : f(it.neck), distPct: it.distPct == null ? null : Math.abs(it.distPct), bornAgo: it.bornAgo, left: it.left, pts: (it.pts || []).map(([i, y]) => [i, f(y)]), neckLine: nl, lines: it.lines ? { t0: it.lines.t0, u: it.lines.u.map(f), l: it.lines.l.map(f) } : null };
  };
  for (const [sg, X] of [[1, B], [-1, mirrorBars(B)]]) {
    const r = patScan(X, PAT_TW);
    for (const it of r.formed) out.push(conv(it, sg));
    for (const it of r.forming) out.push(conv(it, sg));
    const tri = triScan(X, sg < 0);
    if (tri) {
      const it = { kind: tri.type, ago: tri.status === 'formed' ? tri.ago : null, stop: tri.stop, last: tri.last, neck: tri.neck, distPct: tri.distPct, bornAgo: 0, left: null, lines: tri.lines };
      const o = conv(it, sg);
      if (tri.status === 'forming') { o.state = 'forming'; o.ago = null; if (o.lines) { /* 鏡像時線的符號已轉換 */ } }
      o.tri = true; out.push(o);
    }
  }
  // 收斂型態：已經向下跌破（偏空 formed）就不再同時列「偏多正在形成」
  if (out.some((o) => o.tri && o.dir < 0 && o.state === 'formed')) return out.filter((o) => !(o.tri && o.dir > 0 && o.state === 'forming'));
  return out;
}

// ===== 收斂三角形（看圖用，沒有回測）=====
// 上面 patScan 的轉折門檻是 2～3 倍 ATR，抓不到幅度較小的整理。這個偵測改用「小轉折」（左右各 2 根的局部高低點）：
// 在最近 20／30／40／60 根內取局部高點與低點，各自做最小平方法畫線，要求：兩條線收斂（現在的寬度 ≤ 起點的 75%）、
// 各至少碰 2 次且誤差 ≤ 0.4 ATR、整理期間收盤大多在兩線之間、現價還在線內（正在形成）或最近 3 根內收盤站上上緣（已經形成，向上）。
function fit(pts) {
  const m = pts.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = m * sxx - sx * sx; const s = den ? (m * sxy - sx * sy) / den : 0;
  return { s, b: (sy - s * sx) / m };
}
export function triScan(B, onlyFormed = false) {
  const n = B.length; if (n < 80) return null;
  const A = atr14(B), a = A[n - 1];
  const h = B.map((b, t) => Math.min(b.h, Math.max(b.o, b.c) + A[t])), l = B.map((b, t) => Math.max(b.l, Math.min(b.o, b.c) - A[t]));
  for (const W of [60, 40, 30, 20]) {
    const s0 = n - W, PH = [], PL = [];
    for (let i = s0 + 2; i <= n - 3; i++) {
      let hi = true, lo = true;
      for (let j = i - 2; j <= i + 2; j++) { if (j === i) continue; if (h[j] > h[i] || (j < i && h[j] === h[i])) hi = false; if (l[j] < l[i] || (j < i && l[j] === l[i])) lo = false; }
      if (hi) PH.push([i, h[i]]); if (lo) PL.push([i, l[i]]);
    }
    if (PH.length < 2 || PL.length < 2) continue;
    const uf = fit(PH), lf = fit(PL);
    const u = (t) => uf.s * t + uf.b, lo = (t) => lf.s * t + lf.b;
    const t0 = Math.min(PH[0][0], PL[0][0]), span = n - 1 - t0;
    if (span < 10) continue;
    const w0 = u(t0) - lo(t0), w1 = u(n - 1) - lo(n - 1);
    if (!(w0 > 0 && w1 > 0) || w1 > 0.75 * w0 || w1 < 0.4 * a || w0 > 9 * a) continue;
    if (PH.some(([i, y]) => Math.abs(y - u(i)) > 0.4 * a) || PL.some(([i, y]) => Math.abs(y - lo(i)) > 0.4 * a)) continue;
    let inside = 0, tot = 0;
    for (let i = t0; i < n - 3; i++) { tot++; if (B[i].c <= u(i) + 0.3 * a && B[i].c >= lo(i) - 0.3 * a) inside++; }
    if (tot < 8 || inside / tot < 0.85) continue;
    const su = uf.s * span, sl = lf.s * span;
    // 分類：上沿平、下沿升＝上升三角；下沿平、上沿降＝下降三角；上沿降、下沿升＝對稱三角；兩條都往下＝下降楔形；兩條都往上＝上升楔形
    const type = Math.abs(su) <= 0.6 * a && sl > 0 ? 'conv_asc' : Math.abs(sl) <= 0.6 * a && su < 0 ? 'conv_desc' : su < 0 && sl > 0 ? 'conv_sym' : su < 0 ? 'conv_fwedge' : 'conv_rwedge';
    const c = B[n - 1].c, un = u(n - 1), ln = lo(n - 1);
    let brk = -1;
    for (let k = 0; k < 3; k++) { const t = n - 1 - k; if (B[t].c > u(t) + 0.05 * a) brk = k; }
    if (brk >= 0 && c > un) return { type, status: 'formed', ago: brk, neck: un, stop: ln - 0.3 * a, last: c, W, lines: { t0, u: [uf.s, uf.b], l: [lf.s, lf.b] } };
    if (!onlyFormed && c <= un && c >= ln - 0.3 * a) return { type, status: 'forming', neck: un, stop: ln - 0.3 * a, last: c, distPct: (un / c - 1) * 100, W, convPct: (1 - w1 / w0) * 100, lines: { t0, u: [uf.s, uf.b], l: [lf.s, lf.b] } };
  }
  return null;
}
