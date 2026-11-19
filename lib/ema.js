// 均線突破（使用者規則）：EMA 12/45/144/169/288/338
// 日線背景：前一日收盤站上全部日線 EMA、EMA144/169/288/338 不糾結（最高−最低 ≥ 0.5×ATR14）、EMA169 20 日斜率 ≤ 1×ATR
// 1H：第一次收盤站上六條 EMA 最高者（突破 K：陽線、突破前 12 根曾在均線帶下 30%、均線帶寬 ≤ 5×ATR）
//     → 12 根內回踩（最低 ≤ 最高均線×1.002 且收盤 ≥ 最低均線）→ 24 根內再突破（收盤 > 最高均線且 > 突破後最高價）＝進場訊號
// 止損＝回踩最低 −0.1×ATR；止盈 2R。做空＝價格取負鏡像。只用已收盤 K 棒。
// ⚠ 專案回測：加密 15 分（12 檔、2021～2026）扣費後 −0.10～−0.13R；台股 1H（約 3 年）回踩再突破 −0.22R，皆不比隨機進場好 → 觀察用，不計分、不推播。
export const EMA_P = [12, 45, 144, 169, 288, 338];
const ema = (a, n) => { const k = 2 / (n + 1), o = [a[0]]; for (let i = 1; i < a.length; i++) o.push(o[i - 1] + k * (a[i] - o[i - 1])); return o; };
const atr14 = (B) => { const tr = B.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l)); let s = 0; return tr.map((x, i) => { s += x; if (i >= 14) s -= tr[i - 14]; return i >= 13 ? s / 14 : NaN; }); };
const flip = (B) => B.map((b) => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
const pack = (B) => { const E = EMA_P.map((n) => ema(B.map((b) => b.c), n)); return { E, top: B.map((_, i) => Math.max(...E.map((e) => e[i]))), bot: B.map((_, i) => Math.min(...E.map((e) => e[i]))), atr: atr14(B) }; };
const r6 = (x) => (x == null || x !== x ? null : +x.toPrecision(7));

// h1：1H 已收盤 K 棒；d1：日線已收盤 K 棒（舊→新）；dir：1 做多、−1 做空；cfg.risk＝[最小,最大] 止損距離（比例）
export function emaScan(h1raw, d1raw, dir = 1, cfg = { risk: [0.005, 0.06] }) {
  if (h1raw.length < 400 || d1raw.length < 350) return null;
  const H = dir > 0 ? h1raw : flip(h1raw), D = dir > 0 ? d1raw : flip(d1raw);
  const d = pack(D), k = D.length - 1, dc = D.map((b) => b.c);
  const lng = [2, 3, 4, 5].map((i) => d.E[i][k]), sp = (Math.max(...lng) - Math.min(...lng)) / d.atr[k];
  const slope = Math.abs(d.E[3][k] - d.E[3][k - 20]) / d.atr[k];
  const w = dc.slice(-250), pos = w.filter((x) => x < dc[k]).length / w.length;
  const above = dc[k] > d.top[k], dayOk = above && sp >= 0.5 && slope <= 1;
  const day = { above, sp: r6(sp), slope: r6(slope), pos: r6(dir > 0 ? pos : 1 - pos), ok: dayOk };
  if (!dayOk) return { dir, d: day, now: null };
  const h = pack(H), n = H.length, { top, bot, atr: at } = h;
  const o = H.map((b) => b.o), hi = H.map((b) => b.h), lo = H.map((b) => b.l), c = H.map((b) => b.c);
  let best = null;
  for (let b = Math.max(340, n - 30); b < n; b++) { // 突破 K 在最近 30 根內，逐一跑狀態機，取最新的有效者
    if (!(c[b] > top[b] && c[b - 1] <= top[b - 1] && c[b] > o[b])) continue;
    if ((Math.min(...c.slice(b - 12, b)) - bot[b]) / Math.max(top[b] - bot[b], 1e-9) > 0.3 || (top[b] - bot[b]) / at[b] > 5) continue;
    let p = null, pl = 0, pc = 0, hh = hi[b], res = { b, status: 'brk' };
    for (let j = b + 1; j < n; j++) {
      if (c[j] < bot[j] || j - b > 24 || (p == null && j - b > 12)) { res = null; break; }
      if (p == null) {
        if (lo[j] <= top[j] + 0.002 * Math.abs(top[j]) && c[j] >= bot[j]) { p = j; pl = lo[j]; pc = h.E.filter((e) => Math.abs(e[j] - lo[j]) <= 0.25 * at[j]).length; res = { b, p, pc, status: 'pb' }; }
        else hh = Math.max(hh, hi[j]);
      } else {
        pl = Math.min(pl, lo[j]);
        if (c[j] > top[j] && c[j] > hh) { res = { b, p, pc, r: j, pl, stop: pl - 0.1 * at[j], status: n - 1 - j === 0 ? 'entry' : n - 1 - j <= 3 ? 'late' : null }; break; }
        hh = Math.max(hh, hi[j]); res = { b, p, pc, status: 'pb' };
      }
    }
    const rk = { entry: 3, pb: 2, brk: 1, late: 0 };
    if (res?.status && (!best || rk[res.status] >= rk[best.status])) best = { ...res, pl: res.pl ?? (p == null ? null : pl), ah: at[n - 1] };
  }
  if (!best) return { dir, d: day, now: null };
  const px = c[n - 1], stop = best.stop ?? (best.pl != null ? best.pl - 0.1 * best.ah : lo[best.b]), risk = (px - stop) / Math.abs(px);
  const [rmin, rmax] = cfg.risk, bad = risk < rmin ? '止損太近' : risk > rmax ? '止損太遠' : null;
  const S = (v) => r6(dir > 0 ? v : -v); // 還原成原價格
  const keep = 120, s0 = n - keep, T = h1raw.map((x) => x.t);
  const chart = { bars: h1raw.slice(s0).map((x) => [r6(x.o), r6(x.h), r6(x.l), r6(x.c)]), t: T.slice(s0), e: h.E.map((e) => e.slice(s0).map((v) => S(v))), marks: { b: best.b - s0, p: best.p == null ? null : best.p - s0, r: best.r == null ? null : best.r - s0 } };
  const now = { status: best.status, pc: best.pc ?? null, ageB: n - 1 - best.b, price: S(px), stop: S(stop), tgt: S(px + 2 * (px - stop)), stPct: r6(risk * 100), why: bad };
  return { dir, d: day, now, chart };
}
