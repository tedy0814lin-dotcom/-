// 量價異常＋吞噬（使用者規則）：低位爆量（前一根成交量 ≥ 前 20 根均量 2 倍、位於近 60 根區間底部 15%、近 60 根已跌 >15%），
// 下一根陽線實體吞噬前一根 → 該根收盤進場做多；停損＝兩根最低點下 0.2ATR。
// 回測（幣安永續樣本外，4H）：見 cryptoCore 的說明。高位爆量＋空頭吞噬放空回測為負，不納入。
function atr14(B) {
  const o = new Array(B.length); let a = 0;
  for (let i = 0; i < B.length; i++) {
    const pc = i ? B[i - 1].c : B[0].c;
    const tr = Math.max(B[i].h - B[i].l, Math.abs(B[i].h - pc), Math.abs(B[i].l - pc));
    a = i ? a * (1 - 1 / 14) + tr / 14 : tr; o[i] = a;
  }
  return o;
}
export function volEngAll(B) {
  const n = B.length, A = atr14(B), out = [];
  for (let t = 262; t < n; t++) {
    const p = t - 1;
    let vs = 0; for (let q = p - 20; q < p; q++) vs += B[q].v || 0;
    const vm = vs / 20; if (!(vm > 0)) continue;
    const vr = (B[p].v || 0) / vm;
    let hi = -Infinity, lo = Infinity;
    for (let q = p - 59; q <= p; q++) { if (B[q].h > hi) hi = B[q].h; if (B[q].l < lo) lo = B[q].l; }
    if (!(hi > lo)) continue;
    const pos = (B[p].c - lo) / (hi - lo), up = B[p].c / B[p - 60].c - 1;
    const bh = Math.max(B[p].o, B[p].c), bl = Math.min(B[p].o, B[p].c);
    const bull = B[t].c > B[t].o && B[t].o <= bl && B[t].c >= bh;
    if (vr >= 2 && pos <= 0.15 && up < -0.15 && bull) out.push({ i: t, side: 1, stop: Math.min(B[t].l, B[p].l) - 0.2 * A[t] });
  }
  return out;
}
export function volEngSignals(B) {
  if (!B || B.length < 300) return {};
  const n = B.length, ev = volEngAll(B).filter((e) => e.i >= n - 2);
  if (!ev.length) return {};
  const e = ev[ev.length - 1];
  return { volEngL4: { ago: n - 1 - e.i, entry: B[n - 1].c, stop: e.stop, side: 1 } };
}
