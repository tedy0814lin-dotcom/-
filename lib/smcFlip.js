// 結構訂單塊策略（使用者規則：收盤確認 CHoCH／BOS，插針不算）
//   結構：擺動點（左右各 3 根）被「收盤」突破才算 BOS／CHoCH；突破那一段最後一根反向 K 棒＝訂單塊
//   FLIP（翻轉）：訂單塊被收盤突破，而且突破當根的 K 棒碰到訂單塊、收出順勢方向 → 該根收盤進場
//   OB：價格回測訂單塊、收盤守住並收出順勢方向 → 進場
// 確認旗標：cvd＝這根 CVD 動能 > 近 50 根標準差 1.5 倍（同方向）；macd＝20 根內有 MACD 柱狀體背離；vegas＝回測維加斯通道（144／169 EMA）
// 回測（幣安永續樣本外 119 檔，扣 0.1%，下根開盤進場，停損＝訂單塊外側 0.1ATR，3R 全出）：見 categories.js 的 STRATS
const pnan = (x) => x == null || Number.isNaN(x);
function ema(x, n) { const k = 2 / (n + 1), o = new Array(x.length); let e = x[0]; for (let i = 0; i < x.length; i++) { e = i ? x[i] * k + e * (1 - k) : x[0]; o[i] = e; } return o; }
function atr14(B) {
  const o = new Array(B.length); let a = 0;
  for (let i = 0; i < B.length; i++) {
    const pc = i ? B[i - 1].c : B[0].c;
    const tr = Math.max(B[i].h - B[i].l, Math.abs(B[i].h - pc), Math.abs(B[i].l - pc));
    a = i ? a * (1 - 1 / 14) + tr / 14 : tr; o[i] = a;
  }
  return o;
}
function pivotIdx(x, k, low) {
  const out = [];
  for (let i = k; i < x.length - k; i++) {
    let m = x[i], cnt = 0;
    for (let j = i - k; j <= i + k; j++) { if (low ? x[j] < m : x[j] > m) { m = x[j]; } }
    if (low ? x[i] !== m : x[i] !== m) continue;
    for (let j = i - k; j <= i + k; j++) if (x[j] === x[i]) cnt++;
    if (cnt === 1) out.push(i);
  }
  return out;
}
// 結構事件（逐根往前跑，跟 Python 回測同一套）
export function smcEvents(B, k = 3) {
  const n = B.length, ev = [];
  let trend = 0, SH = null, SL = null, obs = [];
  for (let t = k + 1; t < n; t++) {
    const j = t - k;
    if (j - k >= 0) {
      let mx = -Infinity, mn = Infinity;
      for (let q = j - k; q <= j + k; q++) { if (B[q].h > mx) mx = B[q].h; if (B[q].l < mn) mn = B[q].l; }
      if (B[j].h === mx) SH = { p: B[j].h, i: j };
      if (B[j].l === mn) SL = { p: B[j].l, i: j };
    }
    if (SH && B[t].c > SH.p) {
      const kind = trend > 0 ? 'BOS' : 'CHoCH'; trend = 1;
      const s = SL ? SL.i : Math.max(0, t - 30);
      for (let b = t - 1; b >= Math.max(s, t - 40); b--) if (B[b].c < B[b].o) { obs.push({ side: 1, lo: B[b].l, hi: B[b].h, born: t, kind, used: false }); break; }
      SH = null;
    }
    if (SL && B[t].c < SL.p) {
      const kind = trend < 0 ? 'BOS' : 'CHoCH'; trend = -1;
      const s = SH ? SH.i : Math.max(0, t - 30);
      for (let b = t - 1; b >= Math.max(s, t - 40); b--) if (B[b].c > B[b].o) { obs.push({ side: -1, lo: B[b].l, hi: B[b].h, born: t, kind, used: false }); break; }
      SL = null;
    }
    const keep = [];
    for (const ob of obs) {
      if (t - ob.born > 250) continue;
      if (ob.born < t && !ob.used) {
        if (ob.side > 0) {
          if (B[t].c < ob.lo) { if (trend < 0) keep.push({ side: -1, lo: ob.lo, hi: ob.hi, born: t, kind: 'flip', used: false }); continue; }
          if (trend > 0 && B[t].l <= ob.hi && B[t].c > ob.lo && B[t].c > B[t].o) { ev.push({ i: t, side: 1, kind: ob.kind === 'flip' ? 'flip' : ob.kind, zlo: ob.lo, zhi: ob.hi }); ob.used = true; continue; }
        } else {
          if (B[t].c > ob.hi) { if (trend > 0) keep.push({ side: 1, lo: ob.lo, hi: ob.hi, born: t, kind: 'flip', used: false }); continue; }
          if (trend < 0 && B[t].h >= ob.lo && B[t].c < ob.hi && B[t].c < B[t].o) { ev.push({ i: t, side: -1, kind: ob.kind === 'flip' ? 'flip' : ob.kind, zlo: ob.lo, zhi: ob.hi }); ob.used = true; continue; }
        }
      }
      if (!ob.used) keep.push(ob);
    }
    obs = keep;
    for (const ob of obs) {
      if (ob.kind === 'flip' && !ob.used) {
        if (ob.side < 0 && trend < 0 && B[t].h >= ob.lo && B[t].c < ob.hi && B[t].c < B[t].o) { ev.push({ i: t, side: -1, kind: 'FLIP', zlo: ob.lo, zhi: ob.hi }); ob.used = true; }
        if (ob.side > 0 && trend > 0 && B[t].l <= ob.hi && B[t].c > ob.lo && B[t].c > B[t].o) { ev.push({ i: t, side: 1, kind: 'FLIP', zlo: ob.lo, zhi: ob.hi }); ob.used = true; }
      }
    }
    obs = obs.filter((x) => !x.used);
  }
  return ev;
}
// 旗標需要的序列
function flagSeries(B) {
  const n = B.length, c = B.map((b) => b.c), A = atr14(B);
  const dl = B.map((b) => ((b.v || 0) * (b.c - b.o)) / Math.abs(b.h - b.l + 1e-6));
  const sd = new Array(n).fill(NaN);
  for (let i = 50; i < n; i++) { let m = 0; for (let q = i - 50; q < i; q++) m += dl[q]; m /= 50; let s = 0; for (let q = i - 50; q < i; q++) s += (dl[q] - m) ** 2; sd[i] = Math.sqrt(s / 49); }
  const e144 = ema(c, 144), e169 = ema(c, 169);
  const hi = e144.map((x, i) => Math.max(x, e169[i])), lo = e144.map((x, i) => Math.min(x, e169[i]));
  const ef = ema(c, 12), es = ema(c, 26), m = ef.map((x, i) => x - es[i]), sg = ema(m, 9), hist = m.map((x, i) => x - sg[i]);
  const L = B.map((b) => b.l), H = B.map((b) => b.h), mdL = new Array(n).fill(false), mdS = new Array(n).fill(false), K = 5;
  const pl = pivotIdx(L, K, true), ph = pivotIdx(H, K, false);
  for (let q = 0; q + 1 < pl.length; q++) { const a = pl[q], b = pl[q + 1]; if (b - a >= 8 && b - a <= 60 && L[b] < L[a] && hist[b] > hist[a] && hist[b] < 0 && b + K + 1 < n) for (let x = b + K; x < Math.min(n, b + K + 20); x++) mdL[x] = true; }
  for (let q = 0; q + 1 < ph.length; q++) { const a = ph[q], b = ph[q + 1]; if (b - a >= 8 && b - a <= 60 && H[b] > H[a] && hist[b] < hist[a] && hist[b] > 0 && b + K + 1 < n) for (let x = b + K; x < Math.min(n, b + K + 20); x++) mdS[x] = true; }
  return { A, dl, sd, hi, lo, mdL, mdS };
}
export function smcFlags(B, F, e) {
  const i = e.i, a = F.A[i], side = e.side, b = B[i];
  const cvd = !pnan(F.sd[i]) && F.sd[i] > 0 && F.dl[i] * side > 1.5 * F.sd[i];
  const macd = side > 0 ? F.mdL[i] : F.mdS[i];
  const vegas = side > 0
    ? (b.l <= F.hi[i] + 0.5 * a && b.c > F.lo[i] && b.c >= F.hi[i] - 0.5 * a)
    : (b.h >= F.lo[i] - 0.5 * a && b.c < F.hi[i] && b.c <= F.lo[i] + 0.5 * a);
  return { cvd, macd, vegas };
}
// 掃描全部歷史（給對照測試用）
export function smcAll(B) {
  const ev = smcEvents(B), F = flagSeries(B);
  return ev.map((e) => ({ ...e, a: F.A[e.i], ...smcFlags(B, F, e) }));
}
// 即時：最近 2 根內的訊號（ago 0 或 1），每個策略只取最新一個
//   SMC_RULES: [key, tf 標籤, 條件] —— 條件只認回測通過的那幾組
export function smcSignals(B, rules) {
  if (!B || B.length < 260) return {};
  const n = B.length, all = smcAll(B), out = {};
  for (const [key, test] of rules) {
    let hit = null;
    for (const e of all) { if (e.i >= n - 2 && test(e)) hit = e; }
    if (!hit) continue;
    const stop = hit.side > 0 ? hit.zlo - 0.1 * hit.a : hit.zhi + 0.1 * hit.a;
    out[key] = { ago: n - 1 - hit.i, entry: B[n - 1].c, stop, side: hit.side, kind: hit.kind };
  }
  return out;
}
