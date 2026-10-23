// 諧波型態偵測（加密 4H、台股日線共用），參考「多層諧波掃描器」（TradingView 指標）
// 1) 多層級：同時用小／中／大三種轉折尺度（轉折點左右各 5、13、34 根）找型態，大諧波、小諧波都抓
// 2) 已完成：X-A-B-C 是轉折點，D = C 之後的最極端價（剛進入反轉區 PRZ），比例都對上、D 有反應才算
// 3) 未成形：X-A-B-C 已成形，先算出 D 的入場區（PRZ），價格還沒到就是「等待 D 點」，到了是「已進入入場區」
// 看漲：X 低、A 高、B 低、C 高、D 低（D 附近做多）；看跌把價格上下翻轉後用同一套邏輯
//
// 比例（長度相除）：b = AB/XA、c = BC/AB、d = CD/BC、xd = AD/XA；Cypher 用 xc = XC/XA、dx = CD/XC
// t1 / t2：止盈在 AD 段的比例（1.0 = 回到 A 點）
//
// 回測（幣安前 100 檔、約 250 天；到止盈 1 先出一半、停損移到進場價）：
//   時間框架：15 分 −0.11R、1 小時 −0.03R、2 小時 −0.02R、4 小時 +0.07R、日線 −0.09R → 只用 4H（台股用日線）
//   級別：4H 小級別 +0.10R、中級別 +0.07R、大級別 −0.08R → 用小＋中
//   停損放 D 外 2 倍 ATR 比 1 倍好（勝率 49% → 59%）；比例誤差 ±10% 比 ±5% 好（樣本多 3 倍、平均也較好）
//   Alt Bat（勝率 24%）、Cypher（勝率 70% 但平均 −0.05R，止盈太近）只當參考
//   → 採用設定：793 次、勝率 59%、平均每筆 +0.14R（前半段 +0.04R、後半段 +0.25R）
//   未成形入場區直接掛單：1436 次、平均只有 +0.04R → 只當預告，等 D 點有反應（變成已完成）再進

export const HARMONICS = [
  { name: 'Gartley', b: [0.618, 0.618], c: [0.382, 0.886], d: [1.272, 1.618], xd: [0.786, 0.786], t1: 0.382, t2: 0.618 },
  { name: 'Bat', b: [0.382, 0.5], c: [0.382, 0.886], d: [1.618, 2.618], xd: [0.886, 0.886], t1: 0.382, t2: 0.618 },
  { name: 'Alt Bat', b: [0.3, 0.382], c: [0.382, 0.886], d: [2.0, 3.618], xd: [1.13, 1.13], t1: 0.5, t2: 0.786 },
  { name: 'Butterfly', b: [0.786, 0.786], c: [0.382, 0.886], d: [1.618, 2.618], xd: [1.27, 1.618], t1: 0.618, t2: 1.0 },
  { name: 'Crab', b: [0.382, 0.618], c: [0.382, 0.886], d: [2.24, 3.618], xd: [1.618, 1.618], t1: 0.618, t2: 1.272 },
  { name: 'Deep Crab', b: [0.886, 0.886], c: [0.382, 0.886], d: [2.0, 3.618], xd: [1.618, 1.618], t1: 0.618, t2: 1.272 },
  { name: 'Cypher', b: [0.382, 0.618], xc: [1.272, 1.414], dx: [0.786, 0.786], t1: 0.382, t2: 0.618 },
];
const LEVEL_NAME = { 5: '小', 13: '中', 34: '大' };

export const HARM_DEFAULT = {
  levels: [5, 13], // 轉折尺度（轉折點左右各幾根）：小／中（大級別 34 回測是賠的，不用）
  tol: 0.1,       // 比例容許誤差（0.10 = ±10%）
  recent: 3,      // 已完成：D 點要在最近幾根內
  minXaAtr: 3,    // XA 至少幾倍 ATR（太小的型態不算）
  confirm: 0.3,   // 已完成：D 之後收盤要從 D 反彈至少幾倍 ATR 才算確認
  stopAtr: 2,     // 停損：D（或入場區）外面幾倍 ATR
  ema: 0,         // 逆勢過濾用的均線長度；0 = 不過濾
  weakNames: ['Alt Bat', 'Cypher'], // 回測不賺錢、只當參考的型態
};

function atr(bars, n = 14) {
  const m = bars.length;
  let s = 0, k = 0;
  for (let i = Math.max(1, m - n); i < m; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    s += Math.max(b.h, pc) - Math.min(b.l, pc); k++;
  }
  return k ? Math.abs(s / k) : 0;
}

function emaLast(bars, n) {
  const k = 2 / (n + 1);
  let e = bars[0].c;
  for (let i = 1; i < bars.length; i++) e = bars[i].c * k + e * (1 - k);
  return e;
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

// 最後四個轉折是 X 低、A 高、B 低、C 高（C 之後可能還有更低的點，就是候選 D）
function lastXABC(z) {
  let k = z.length - 1;
  if (k >= 0 && z[k].t === 'L') k--;
  if (k < 3) return null;
  const [X, A, B, C] = [z[k - 3], z[k - 2], z[k - 1], z[k]];
  return X.t === 'L' && A.t === 'H' && B.t === 'L' && C.t === 'H' ? { X, A, B, C } : null;
}

// ---- 已完成（看漲視角） ----
function doneBull(bars, w, P) {
  const n = bars.length, a = atr(bars);
  const p = lastXABC(zigzag(bars, w));
  if (!p) return null;
  const { X, A, B, C } = p;
  const XA = A.v - X.v;
  if (!(XA >= P.minXaAtr * a)) return null;
  let iD = -1, D = Infinity;
  for (let i = C.i + 1; i < n; i++) if (bars[i].l < D) { D = bars[i].l; iD = i; }
  if (iD < 0 || iD < n - P.recent) return null;
  const AB = A.v - B.v, BC = C.v - B.v, CD = C.v - D, XC = C.v - X.v;
  if (!(AB > 0 && BC > 0 && CD > 0)) return null;
  const r = { b: AB / XA, c: BC / AB, xd: (A.v - D) / XA, d: CD / BC, xc: XC / XA, dx: CD / XC };
  const H = HARMONICS.find((h) => ['b', 'c', 'd', 'xd', 'xc', 'dx'].every((key) => inR(r[key], h[key], P.tol)));
  if (!H) return null;
  const last = bars[n - 1];
  if (!(last.c - D >= P.confirm * a)) return null;
  if (P.ema && !(last.c < emaLast(bars, Math.min(P.ema, n - 1)))) return null;
  const AD = A.v - D, entry = last.c, stop = D - P.stopAtr * a;
  const t1 = D + H.t1 * AD, t2 = D + H.t2 * AD;
  if (!(entry > stop) || !(t1 > entry)) return null;
  return { name: H.name, level: LEVEL_NAME[w] || String(w), w, X: X.v, A: A.v, B: B.v, C: C.v, D, ...r, ago: n - 1 - iD, plan: { entry, stop, t1, t2 } };
}

// ---- 未成形（看漲視角）：XABC 已成形，算出 D 的入場區 ----
function pendBull(bars, w, P) {
  const n = bars.length, a = atr(bars);
  const p = lastXABC(zigzag(bars, w));
  if (!p) return [];
  const { X, A, B, C } = p;
  const XA = A.v - X.v, AB = A.v - B.v, BC = C.v - B.v;
  if (!(XA >= P.minXaAtr * a && AB > 0 && BC > 0)) return [];
  let lo = Infinity;
  for (let i = C.i + 1; i < n; i++) lo = Math.min(lo, bars[i].l);
  const out = [];
  for (const h of HARMONICS) {
    if (!h.xd || !inR(AB / XA, h.b, P.tol) || !inR(BC / AB, h.c, P.tol)) continue;
    // 入場區 = AD 比例區間 與 CD 比例區間 重疊的部分
    const adNear = A.v - h.xd[0] * XA * (1 - P.tol), adFar = A.v - h.xd[1] * XA * (1 + P.tol);
    const cdNear = C.v - h.d[0] * BC * (1 - P.tol), cdFar = C.v - h.d[1] * BC * (1 + P.tol);
    const top = Math.min(adNear, cdNear), bot = Math.max(adFar, cdFar);
    if (!(top > bot)) continue;
    const stop = bot - P.stopAtr * a, mid = (top + bot) / 2, adM = A.v - mid;
    const state = lo < stop ? 'dead' : lo <= top ? 'in' : 'wait';
    if (state === 'dead') continue;
    out.push({ name: h.name, level: LEVEL_NAME[w] || String(w), w, X: X.v, A: A.v, B: B.v, C: C.v, top, bot, stop,
      t1: mid + h.t1 * adM, t2: mid + h.t2 * adM, state, dist: (bars[n - 1].c - top) / bars[n - 1].c * 100 });
  }
  return out;
}

const flipBars = (bars) => bars.map((b) => ({ o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
const neg = (o, keys) => { const r = { ...o }; for (const k of keys) if (r[k] != null) r[k] = -r[k]; return r; };

// 已完成的型態：大級別優先
export function harmonic(bars, opts = {}) {
  if (!bars || bars.length < 60) return null;
  const P = { ...HARM_DEFAULT, ...opts };
  const fl = flipBars(bars);
  for (const w of [...P.levels].sort((x, y) => y - x)) {
    const up = doneBull(bars, w, P);
    if (up) return { dir: 1, ...up, weak: P.weakNames.includes(up.name) };
    const dn = doneBull(fl, w, P);
    if (dn) return { dir: -1, ...neg(dn, ['X', 'A', 'B', 'C', 'D']), plan: neg(dn.plan, ['entry', 'stop', 't1', 't2']), weak: P.weakNames.includes(dn.name) };
  }
  return null;
}

// 未成形的型態（等待 D 點／已進入入場區）
export function harmonicPending(bars, opts = {}) {
  if (!bars || bars.length < 60) return [];
  const P = { ...HARM_DEFAULT, ...opts };
  const fl = flipBars(bars), out = [];
  for (const w of P.levels) {
    for (const p of pendBull(bars, w, P)) out.push({ dir: 1, ...p });
    for (const p of pendBull(fl, w, P)) out.push({ dir: -1, ...neg(p, ['X', 'A', 'B', 'C', 'top', 'bot', 'stop', 't1', 't2']), dist: -p.dist });
  }
  const c = bars[bars.length - 1].c;
  for (const p of out) {
    if (p.dir < 0) [p.top, p.bot] = [p.bot, p.top]; // 翻轉回來後讓 top 永遠是入場區上緣
    // 離入場區還有多遠（%）：看漲＝現價在入場區上緣之上多少；看跌＝在下緣之下多少
    p.dist = p.dir > 0 ? (c - p.top) / c * 100 : (p.bot - c) / c * 100;
    p.weak = P.weakNames.includes(p.name);
  }
  return out;
}
