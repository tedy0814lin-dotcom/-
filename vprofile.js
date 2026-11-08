// 共用：成交量分布（VPVR）。bars = [[o,h,l,c,v], ...]（舊→新）。型態頁與維加斯通道頁都用這個。
export const VP_ROWS = 50;
export function volumeProfile(bars, lo, hi, rows = VP_ROWS, va = 0.70) {
  if (!(hi > lo)) return null;
  const up = new Float64Array(rows), dn = new Float64Array(rows), step = (hi - lo) / rows;
  let tot = 0;
  for (const b of bars) {
    const v = b[4]; if (!(v > 0)) continue;
    const bl = Math.max(lo, b[2]), bh = Math.min(hi, b[1]);
    if (bh <= bl) { const k = Math.min(rows - 1, Math.max(0, Math.floor((b[3] - lo) / step))); (b[3] >= b[0] ? up : dn)[k] += v; tot += v; continue; }
    const span = bh - bl, a = b[3] >= b[0] ? up : dn;
    const k0 = Math.max(0, Math.floor((bl - lo) / step)), k1 = Math.min(rows - 1, Math.floor((bh - lo) / step));
    for (let k = k0; k <= k1; k++) { const cl = lo + k * step, ov = Math.min(cl + step, bh) - Math.max(cl, bl); if (ov > 0) { const w = v * ov / span; a[k] += w; tot += w; } }
  }
  if (tot <= 0) return null;
  const vol = Array.from({ length: rows }, (_, k) => up[k] + dn[k]);
  let poc = 0; for (let k = 1; k < rows; k++) if (vol[k] > vol[poc]) poc = k;
  let loI = poc, hiI = poc, acc = vol[poc];
  while (acc < va * tot && (loI > 0 || hiI < rows - 1)) { const L = loI > 0 ? vol[loI - 1] : -1, H = hiI < rows - 1 ? vol[hiI + 1] : -1; if (H >= L) acc += vol[++hiI]; else acc += vol[--loI]; }
  const vmax = Math.max(...vol);
  return { rows, up, dn, vol, vmax, step, lo, poc, pocP: lo + (poc + 0.5) * step, val: lo + loI * step, vah: lo + (hiI + 1) * step,
    hvn: vol.map((v) => v >= 0.7 * vmax), lvn: vol.map((v) => v > 0 && v <= 0.3 * vmax) };
}
// POC 價位文字：>=1000 一位小數、>=1 兩位、其餘 4 位有效數字
const pocPx = (v) => (v >= 1000 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(4));
// 畫出 VPVR：量條在 side（預設左）、價值區底色與 POC／VAH／VAL 橫線滿版，價位標籤在另一側
export function vpSVG(vp, g) {
  const { left, right, yOf, rowPix, pw = 180, side = 'left' } = g;
  const bh = Math.max(1, rowPix * 0.86); let s = '';
  s += `<rect x="${left}" y="${yOf(vp.vah).toFixed(1)}" width="${(right - left).toFixed(1)}" height="${Math.max(0, yOf(vp.val) - yOf(vp.vah)).toFixed(1)}" class="vp-va"/>`;
  for (let k = 0; k < vp.rows; k++) {
    const t = vp.vol[k]; if (!(t > 0)) continue;
    const yc = yOf(vp.lo + (k + 0.5) * vp.step), y = (yc - bh / 2).toFixed(1);
    const wTot = (t / vp.vmax) * pw, wUp = (vp.up[k] / vp.vmax) * pw, wDn = (vp.dn[k] / vp.vmax) * pw, hi = vp.hvn[k] ? ' vp-hi' : '';
    if (side === 'left') {
      if (vp.dn[k] > 0) s += `<rect x="${left}" y="${y}" width="${wDn.toFixed(1)}" height="${bh.toFixed(1)}" class="vp-dn${hi}"/>`;
      if (vp.up[k] > 0) s += `<rect x="${(left + wDn).toFixed(1)}" y="${y}" width="${wUp.toFixed(1)}" height="${bh.toFixed(1)}" class="vp-up${hi}"/>`;
      if (vp.lvn[k]) s += `<line x1="${left}" x2="${(left + pw).toFixed(1)}" y1="${yc.toFixed(1)}" y2="${yc.toFixed(1)}" class="vp-lvn"/>`;
    } else {
      if (vp.dn[k] > 0) s += `<rect x="${(right - wDn).toFixed(1)}" y="${y}" width="${wDn.toFixed(1)}" height="${bh.toFixed(1)}" class="vp-dn${hi}"/>`;
      if (vp.up[k] > 0) s += `<rect x="${(right - wTot).toFixed(1)}" y="${y}" width="${wUp.toFixed(1)}" height="${bh.toFixed(1)}" class="vp-up${hi}"/>`;
      if (vp.lvn[k]) s += `<line x1="${(right - pw).toFixed(1)}" x2="${right}" y1="${yc.toFixed(1)}" y2="${yc.toFixed(1)}" class="vp-lvn"/>`;
    }
  }
  // 線只畫到量條長度，價格直接寫在線尾（成交量的峰旁邊），避免整條橫線擋住 K 棒
  const x1 = side === 'left' ? left : right - pw, x2 = side === 'left' ? left + pw : right;
  const lblX = side === 'left' ? x2 + 4 : x1 - 4, anc = side === 'left' ? 'start' : 'end';
  const ty = (v) => (yOf(v) + 3.5).toFixed(1);
  s += `<line x1="${x1}" x2="${x2}" y1="${yOf(vp.pocP).toFixed(1)}" y2="${yOf(vp.pocP).toFixed(1)}" class="vp-poc"/><text x="${lblX}" y="${ty(vp.pocP)}" text-anchor="${anc}" class="vp-t vp-poc-t">${pocPx(vp.pocP)}</text>`;
  for (const [v, lab] of [[vp.vah, 'VAH'], [vp.val, 'VAL']]) s += `<line x1="${x1}" x2="${x2}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}" class="vp-val-ln"/><text x="${lblX}" y="${ty(v)}" text-anchor="${anc}" class="vp-t vp-val-t">${lab}</text>`;
  return s;
}
