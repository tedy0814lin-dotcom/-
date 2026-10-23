// 諧波型態偵測（加密 4H、台股日線共用）
// 用轉折點找 X-A-B-C，D = C 之後的最極端價（剛進入反轉區 PRZ），各段費氏比例都要對上
// 看漲：X 低、A 高、B 低、C 高、D 低（D 附近做多）；看跌把價格上下翻轉後用同一套邏輯
//
// 比例的意思（都是長度相除）：
//   b  = AB / XA      B 點回撤 XA 多少
//   c  = BC / AB      C 點回撤 AB 多少（> 1 代表 C 超過 A，例如 Shark、Cypher）
//   xd = AD / XA      D 點相對 XA 的位置（< 1 在 X 之上，> 1 跌破 X）
//   d  = CD / BC      CD 段是 BC 的幾倍
//   xc = XC / XA      只有 Cypher 用：C 超過 A 多少
//   dx = CD / XC      只有 Cypher / Shark 用：D 回撤 XC 多少

export const HARMONICS = [
  { name: 'Gartley', b: [0.58, 0.66], c: [0.382, 0.886], xd: [0.75, 0.82], d: [1.13, 1.618], stopX: true },
  { name: 'Bat', b: [0.382, 0.5], c: [0.382, 0.886], xd: [0.86, 0.91], d: [1.618, 2.618], stopX: true },
  { name: 'Alt Bat', b: [0.3, 0.382], c: [0.382, 0.886], xd: [1.1, 1.16], d: [2.0, 3.618], stopX: false },
  { name: 'Butterfly', b: [0.76, 0.81], c: [0.382, 0.886], xd: [1.25, 1.42], d: [1.618, 2.24], stopX: false },
  { name: 'Cypher', b: [0.382, 0.618], xc: [1.272, 1.414], dx: [0.76, 0.81], stopX: true },
  // 下面三種回測勝率偏低（加密 4H、前 100 檔、約 250 天：Shark 39%、Crab 20%、Deep Crab 38%），只當參考
  { name: 'Crab', b: [0.382, 0.618], c: [0.382, 0.886], xd: [1.58, 1.66], d: [2.24, 3.618], stopX: false, weak: true },
  { name: 'Deep Crab', b: [0.85, 0.92], c: [0.382, 0.886], xd: [1.58, 1.66], d: [2.0, 3.618], stopX: false, weak: true },
  { name: 'Shark', b: [0.3, 0.9], c: [1.13, 1.618], dx: [0.886, 1.13], stopX: false, weak: true },
];

// 平均真實波幅（價格單位）
function atr(bars, n = 14) {
  const m = bars.length;
  let s = 0, k = 0;
  for (let i = Math.max(1, m - n); i < m; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    s += Math.max(b.h, pc) - Math.min(b.l, pc); k++;
  }
  return k ? Math.abs(s / k) : 0;
}

// 轉折點：左右各 w 根都沒有更高（更低），連續同方向只留最極端的，變成高低交替
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
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && q.t === p.t) { if ((p.t === 'H' && p.v > q.v) || (p.t === 'L' && p.v < q.v)) out[out.length - 1] = p; }
    else out.push(p);
  }
  return out;
}

const inR = (v, r, tol) => !r || (v >= r[0] * (1 - tol) && v <= r[1] * (1 + tol));

// 參數是用回測調出來的（幣安前 100 檔、4H、約 250 天）：
//   比例放寬 5%、D 點收盤反彈 0.3 倍 ATR 確認、停損放 D 外 2 倍 ATR、目標 AD 的 0.382 / 0.618、
//   只做「逆 EMA200」的反轉（價格在 EMA200 下方才做看漲、上方才做看跌）、到目標 1 先出一半並把停損移到進場價
//   → 好的 5 種型態：70 次、勝率 72%、平均每筆 +0.13R（調整前 43%、−0.26R）
export const HARM_DEFAULT = {
  w: 3,          // 轉折點左右各幾根
  recent: 3,     // D 點要在最近幾根內
  minXaAtr: 5,   // XA 至少幾倍 ATR（太小的型態不算）
  tol: 0.05,     // 比例容許誤差（0.05 = 放寬 5%）
  confirm: 0.3,  // D 之後收盤要從 D 反彈至少幾倍 ATR 才算確認
  revBar: false, // 最後一根要不要是反轉 K（回測：會砍掉太多好訊號，關掉）
  stopAtr: 2,    // 停損放在 D 外面幾倍 ATR
  ema: 200,      // 逆勢過濾用的均線（K 棒不夠長就用能算的最長）；0 = 不過濾
  only: null,    // 只用哪些型態（名稱陣列），null = 全部
};

function emaLast(bars, n) {
  const k = 2 / (n + 1);
  let e = bars[0].c;
  for (let i = 1; i < bars.length; i++) e = bars[i].c * k + e * (1 - k);
  return e;
}

function harmBull(bars, P) {
  const n = bars.length;
  const z = zigzag(bars, P.w);
  const a = atr(bars);
  let k = z.length - 1;
  if (k >= 0 && z[k].t === 'L') k--;
  if (k < 3) return null;
  const C = z[k], B = z[k - 1], A = z[k - 2], X = z[k - 3];
  if (!(X.t === 'L' && A.t === 'H' && B.t === 'L' && C.t === 'H')) return null;
  const XA = A.v - X.v;
  if (!(XA >= P.minXaAtr * a)) return null;
  let iD = -1, D = Infinity;
  for (let i = C.i + 1; i < n; i++) if (bars[i].l < D) { D = bars[i].l; iD = i; }
  if (iD < 0 || iD < n - P.recent || iD === n - 1 && P.revBar) return null;
  const AB = A.v - B.v, BC = C.v - B.v, CD = C.v - D, XC = C.v - X.v;
  if (!(AB > 0 && BC > 0 && CD > 0)) return null;
  const r = { b: AB / XA, c: BC / AB, xd: (A.v - D) / XA, d: CD / BC, xc: XC / XA, dx: CD / XC };
  const list = P.only ? HARMONICS.filter((h) => P.only.includes(h.name)) : HARMONICS;
  const H = list.find((h) => ['b', 'c', 'xd', 'd', 'xc', 'dx'].every((key) => inR(r[key], h[key], P.tol)));
  if (!H) return null;
  // D 點反應：收盤從 D 反彈夠多，必要時最後一根要是反轉 K
  const last = bars[n - 1], prev = bars[n - 2];
  if (!(last.c - D >= P.confirm * a)) return null;
  if (P.revBar && !(last.c > last.o && last.c > prev.h)) return null;
  // 逆勢過濾：看漲型態要出現在均線下方（跌深反彈），否則容易只是趨勢中的小整理
  if (P.ema && !(last.c < emaLast(bars, Math.min(P.ema, n - 1)))) return null;
  const AD = A.v - D;
  const stop = D - P.stopAtr * a;
  const entry = last.c;
  if (!(entry > stop)) return null;
  // 目標：AD 段 0.382 與 0.618（Shark 用 C 點附近的 0.5 XC）
  const t1 = D + 0.382 * AD, t2 = H.name === 'Shark' ? D + 0.5 * (C.v - D) : D + 0.618 * AD;
  if (!(t1 > entry)) return null;
  return { name: H.name, weak: !!H.weak, X: X.v, A: A.v, B: B.v, C: C.v, D, ...r, ago: n - 1 - iD, plan: { entry, stop, t1, t2 } };
}

export function harmonic(bars, opts = {}) {
  if (!bars || bars.length < 60) return null;
  const P = { ...HARM_DEFAULT, ...opts };
  const up = harmBull(bars, P);
  if (up) return { dir: 1, ...up };
  const flip = bars.map((b) => ({ o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
  const dn = harmBull(flip, P);
  if (!dn) return null;
  return { dir: -1, ...dn, X: -dn.X, A: -dn.A, B: -dn.B, C: -dn.C, D: -dn.D,
    plan: { entry: -dn.plan.entry, stop: -dn.plan.stop, t1: -dn.plan.t1, t2: -dn.plan.t2 } };
}
