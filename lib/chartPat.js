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

// 單一轉折尺度 K 的事件：回傳 [{kind, i（進場那根）, stop, sb（突破收盤那根）}]
function events(B, A, K, eqp) {
  const n = B.length, ev = [], piv = [];
  const h = B.map((b, t) => Math.min(b.h, Math.max(b.o, b.c) + A[t]));
  const l = B.map((b, t) => Math.max(b.l, Math.min(b.o, b.c) - A[t]));
  const c = B.map((b) => b.c);
  let d = 0, ei = 0, ext = h[0], pend = [];
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
      if (c[t] > lvl && t <= p.exp) ev.push({ kind: p.kind, i: t + 1, stop: p.stop, sb: t });
      else if (t <= p.exp && c[t] > p.stop && !(c[t] > lvl)) keep.push(p);
    }
    pend = keep;
    if (newp && piv.length >= 3) {
      const P = piv, vv = P.map((p) => p[2]), ix = P.map((p) => p[1]), m = P.length;
      const v = (k) => vv[m + k], x = (k) => ix[m + k];
      const eq = (p, q, pct = 0.03) => Math.abs(p - q) <= pct * (eqp / 0.03) * Math.abs(p);
      const tsym = (i1, i2, i3) => { const r = (i2 - i1) / Math.max(i3 - i2, 1); return r >= 0.4 && r <= 2.5; };
      const reg = (kind, neck, stop) => pend.push({ kind, neck, stop: stop - 0.1 * a, exp: t + WAIT });
      if (P[m - 1][0] === -1) {
        if (eq(v(-1), v(-3)) && v(-2) - Math.min(v(-1), v(-3)) >= 2 * a && tsym(x(-3), x(-2), x(-1)))
          reg('double_bottom', [v(-2), x(-2), 0], Math.min(v(-1), v(-3)));
        if (m >= 5) {
          const mx = Math.max(v(-1), v(-3), v(-5)), mn = Math.min(v(-1), v(-3), v(-5));
          if (mx - mn <= 0.04 * Math.abs(v(-1)) && Math.min(v(-2), v(-4)) - v(-1) >= 1.5 * a)
            reg('triple_bottom', [Math.max(v(-2), v(-4)), x(-2), 0], mn);
          if (P[m - 4][0] === 1) {
            const H1 = v(-4), L1 = v(-3), H2 = v(-2), L2 = v(-1);
            if ((H2 - L2) <= 0.75 * (H1 - L1)) {
              if (Math.abs(H1 - H2) <= a && L2 > L1 + 0.5 * a) reg('asc_triangle', [Math.max(H1, H2), x(-2), 0], L2);
            }
            if (eq(H1, H2) && eq(L1, L2) && H1 - L1 >= 2 * a) reg('rectangle', [Math.max(H1, H2), x(-2), 0], Math.min(L1, L2));
          }
        }
      }
    }
  }
  return ev;
}

// 全部事件（多尺度合併、同型態 12 根內只留最早的），i＝進場那根
export function patEvents(B, cfg) {
  const A = atr14(B), all = [];
  cfg.KS.forEach((K, qi) => {
    for (const e of events(B, A, K, cfg.eqp)) {
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
