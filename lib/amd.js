// AMD 操縱模型（使用者規則）：水平累積區 → 假突破掃針後收回（操縱）→ 確認（吞噬／IFVG／位移＋FVG）。台股 1H、多空。
// 累積區＝掃針前 W 根（12/16/20/24/30，取最大且符合者）實體 P10～P90，高 0.8～4.5 ATR，首尾收盤差 ≤1.2 倍高、迴歸總漲跌 ≤0.5 倍高（水平）。
// 掃針：低於區間下緣 0.5～4 倍區間高，5 根內收盤收回。關鍵位：區間下緣 ±0.7 ATR 內，區間之前 250 根內有擺動高低點（左右各 3 根）。
// 確認（掃針後 5 根內第一次）：E 吞噬（多頭K收盤 > 前一根實體上緣）、I IFVG（首次收盤站上空方FVG上緣）、F 位移（實體≥0.8ATR）＋FVG。
// 未派發：現價沒有超過區間上緣 1 倍區間高，也沒跌破止損。止損＝掃針極值 −0.05ATR，風險須 0.3～3 ATR。做空＝價格取負鏡像。只用已收盤 K 棒。
// ⚠ 專案回測（台股 1H 443 檔、2R／24 根、扣費）−0.30R、持有到 120 根 −0.09R，做多長持有的正報酬是大盤漂移（隨機進場同樣為正）→ 觀察用，不計分、不推播。
const WS = [30, 24, 20, 16, 12];
const atr14 = (B) => { const tr = B.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l)); let s = 0; return tr.map((x, i) => { s += x; if (i >= 14) s -= tr[i - 14]; return i >= 13 ? s / 14 : NaN; }); };
const flip = (B) => B.map((b) => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y), k = ((s.length - 1) * p) / 100, f = Math.floor(k), c = Math.ceil(k); return s[f] + (s[c] - s[f]) * (k - f); };
const r6 = (x) => (x == null || x !== x ? null : +x.toPrecision(7));
const slope = (y) => { const n = y.length, mx = (n - 1) / 2, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0; y.forEach((v, i) => { sxy += (i - mx) * (v - my); sxx += (i - mx) ** 2; }); return sxy / sxx; };

export function amdScan(h1raw, dir = 1) {
  const n = h1raw.length; if (n < 400) return null;
  const H = dir > 0 ? h1raw : flip(h1raw), S = (v) => r6(dir > 0 ? v : -v);
  const o = H.map((b) => b.o), h = H.map((b) => b.h), l = H.map((b) => b.l), c = H.map((b) => b.c), A = atr14(H);
  const top = H.map((b) => Math.max(b.o, b.c)), bot = H.map((b) => Math.min(b.o, b.c));
  const pv = [], pi = []; // 擺動高低點（左右各 3 根）
  for (let i = 3; i < n - 3; i++) { let mx = -Infinity, mn = Infinity; for (let j = i - 3; j <= i + 3; j++) { mx = Math.max(mx, h[j]); mn = Math.min(mn, l[j]); } if (h[i] === mx) { pv.push(h[i]); pi.push(i); } if (l[i] === mn) { pv.push(l[i]); pi.push(i); } }
  const price = r6(h1raw[n - 1].c); let best = null;
  for (let m = n - 8; m < n; m++) {
    const a = A[m - 1]; if (!(a > 0)) continue;
    let pick = null;
    for (const W of WS) {
      const lo = pct(bot.slice(m - W, m), 10), hi = pct(top.slice(m - W, m), 90), bh = hi - lo;
      if (!(bh / a >= 0.8 && bh / a <= 4.5) || Math.abs(c[m - 1] - c[m - W]) > 1.2 * bh) continue;
      const dep = lo - l[m]; if (dep < 0.5 * bh || dep > 4 * bh) continue;
      pick = { W, lo, hi, bh }; break;
    }
    if (!pick) continue;
    const { W, lo, hi, bh } = pick;
    if (Math.abs(slope(c.slice(m - W, m))) * (W - 1) / bh > 0.5) continue; // 水平
    let k = -1; for (let j = m; j < Math.min(m + 5, n); j++) if (c[j] >= lo) { k = j; break; } if (k < 0) continue;
    let ent = null;
    for (let t = k; t < Math.min(m + 6, n); t++) {
      const E = c[t] > o[t] && c[t] > Math.max(o[t - 1], c[t - 1]);
      let I = false; for (let d = Math.max(1, m - 8); d <= t - 2; d++) if (h[d + 1] < l[d - 1] && c[t] > l[d - 1] && c[t - 1] <= l[d - 1]) { I = true; break; }
      const F = t - 1 >= k && c[t - 1] > o[t - 1] && c[t - 1] - o[t - 1] >= 0.8 * a && l[t] > h[t - 2];
      if (E || I || F) { ent = { t, conf: (E ? 'E' : '') + (I ? 'I' : '') + (F ? 'F' : '') }; break; }
    }
    if (!ent) continue;
    const t = ent.t, sw = Math.min(...l.slice(m, t + 1)), stop = sw - 0.05 * a, risk = c[t] - stop;
    if (!(risk >= 0.3 * a && risk <= 3 * a)) continue;
    if (!pi.some((p, q) => p < m - W - 3 && p >= m - 250 && Math.abs(pv[q] - lo) <= 0.7 * a)) continue; // 關鍵位
    if (c[n - 1] - hi > bh || c[n - 1] <= stop) continue; // 已派發走遠／已破止損
    if (!best || t > best.t || (t === best.t && W > best.W)) best = { m, t, W, lo, hi, bh, sw, stop, risk, a, conf: ent.conf };
  }
  if (!best) return { dir, price, now: null };
  const b = best, w120 = (v) => { const L = Math.min(...l.slice(b.m - 120, b.m)), Hh = Math.max(...h.slice(b.m - 120, b.m)); return (v - L) / (Hh - L); };
  const s0 = n - 140, T = h1raw.map((x) => x.t);
  return {
    dir, price,
    now: { age: n - 1 - b.t, conf: b.conf, W: b.W, ref: r6(h1raw[b.t].c), stop: S(b.stop), stPct: r6((b.risk / Math.abs(c[b.t])) * 100), bh: r6(b.bh / b.a), pos: r6(dir > 0 ? w120(b.lo) : 1 - w120(b.lo)) },
    chart: { bars: h1raw.slice(s0).map((x) => [r6(x.o), r6(x.h), r6(x.l), r6(x.c)]), t: T.slice(s0), marks: { x0: b.m - b.W - s0, x1: b.m - 1 - s0, lo: S(dir > 0 ? b.lo : b.hi), hi: S(dir > 0 ? b.hi : b.lo), m: b.m - s0, t: b.t - s0 } },
  };
}
