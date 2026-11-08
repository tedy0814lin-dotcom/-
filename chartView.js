// 籌碼圖表（仿 Coinglass 排法）：K 線＋成交量、持倉、持倉變化、爆倉、主動買賣量差、資金費率、大戶多空比、散戶多空比
// 資料與來源標示見 lib/chartData.js；每層標題右邊會寫來源，抓不到的層寫原因。
import { loadChart } from '/lib/chartData.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}, parent) => { const e = document.createElementNS(NS, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (d != null) return v.toFixed(d);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  if (a >= 100) return v.toFixed(1); if (a >= 1) return v.toFixed(3); return v.toPrecision(3);
};
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const bis = (a, t) => { let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }; // 最後一個 t' ≤ t
const TFS = [['5m', '5分'], ['15m', '15分'], ['1h', '1小時'], ['4h', '4小時']];

export function openChart({ sym, base, inst, tf = '15m' }) {
  const ov = document.createElement('div'); ov.className = 'chart-ov';
  ov.innerHTML = `<div class="chart-box" role="dialog" aria-label="${esc(base)} 籌碼圖表">
    <div class="chart-head"><b>${esc(base)}</b><span class="muted" id="ch-src"></span>
      <div class="chart-tf">${TFS.map(([k, n]) => `<button type="button" data-tf="${k}">${n}</button>`).join('')}</div>
      <button type="button" class="chart-x" aria-label="關閉">✕</button></div>
    <div class="chart-note" id="ch-note"></div><div class="chart-body" id="ch-body"><div class="muted" style="padding:20px">載入中…</div></div></div>`;
  document.body.appendChild(ov); document.body.style.overflow = 'hidden';
  const close = () => { ov.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.chart-x')) close(); });
  const body = ov.querySelector('#ch-body'); let cur = null, seq = 0;
  const proxy = (p) => fetch('/api/okxr?p=' + encodeURIComponent(p), { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  const load = async (t) => {
    const my = ++seq; tf = t;
    ov.querySelectorAll('.chart-tf button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tf === t)));
    body.innerHTML = '<div class="muted" style="padding:20px">載入中…（OKX 備援時約需 10 秒）</div>';
    try { const d = await loadChart({ sym, inst, tf: t, proxy }); if (my !== seq) return; cur = d; draw(); }
    catch (e) { if (my !== seq) return; cur = null; body.innerHTML = `<div class="muted" style="padding:20px">⚠ 圖表資料抓不到：${esc(e.message)}</div>`; }
  };
  const onResize = () => { if (cur) draw(); };
  window.addEventListener('resize', onResize);
  ov.querySelector('.chart-tf').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) load(b.dataset.tf); });

  function draw() {
    const d = cur, W = Math.max(320, body.clientWidth || 800), padL = 8, padR = 58, gap = 6, ms = d.ms;
    const t0 = d.candles[0].t, t1 = d.candles[d.candles.length - 1].t + ms, X = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
    ov.querySelector('#ch-src').textContent = `　資料來源：${d.src}　共 ${d.candles.length} 根`;
    ov.querySelector('#ch-note').innerHTML = d.notes.length ? d.notes.map((n) => `⚠ ${esc(n)}`).join('　') : '';
    const pAt = (t) => { const i = bis(d.candles, t); const c = d.candles[Math.max(0, i)]; return c ? c.c : null; };
    const inR = (a) => a.filter((x) => x.t >= t0 - ms && x.t <= t1);
    const panels = [];
    const P = (key, title, src, h, build, read) => panels.push({ key, title, src, h, build, read });
    // 價格
    P('price', 'K 線', d.srcs.price, 230, (g, H) => {
      const lo = Math.min(...d.candles.map((c) => c.l)), hi = Math.max(...d.candles.map((c) => c.h)), pad = (hi - lo) * 0.06 || 1, y0 = lo - pad, y1 = hi + pad;
      const Y = (v) => H - ((v - y0) / (y1 - y0)) * H, bw = Math.max(1, ((W - padL - padR) / d.candles.length) * 0.7);
      for (const c of d.candles) { const x = X(c.t + ms / 2), col = c.c >= c.o ? 'var(--up)' : 'var(--down)'; el('line', { x1: x, x2: x, y1: Y(c.h), y2: Y(c.l), stroke: col }, g); el('rect', { x: x - bw / 2, y: Math.min(Y(c.o), Y(c.c)), width: bw, height: Math.max(1, Math.abs(Y(c.o) - Y(c.c))), fill: col }, g); }
      return { ticks: [y0 + pad, (y0 + y1) / 2, y1 - pad].map((v) => [Y(v), px(v)]) };
    }, (t) => { const c = d.candles[bis(d.candles, t)]; return c ? `開${px(c.o)} 高${px(c.h)} 低${px(c.l)} 收${px(c.c)}` : ''; });
    P('vol', '成交量（幣數）', d.srcs.price, 56, (g, H) => {
      const mx = Math.max(...d.candles.map((c) => c.v)) || 1, bw = Math.max(1, ((W - padL - padR) / d.candles.length) * 0.7);
      for (const c of d.candles) { const h = (c.v / mx) * H; el('rect', { x: X(c.t + ms / 2) - bw / 2, y: H - h, width: bw, height: h, fill: c.c >= c.o ? 'var(--up)' : 'var(--down)', opacity: 0.55 }, g); }
      return { ticks: [[2, fmt(mx)]] };
    }, (t) => { const c = d.candles[bis(d.candles, t)]; return c ? fmt(c.v) : ''; });
    // 持倉
    const oi = inR(d.oi);
    P('oi', '持倉量（幣數）', d.srcs.oi, 90, (g, H) => lineChart(g, H, oi, 'var(--accent)', true), (t) => { const i = bis(d.oi, t); return i >= 0 ? fmt(d.oi[i].v) : ''; });
    // 持倉變化（依價格方向上色）
    P('doi', '持倉變化（依價格方向上色：實心＝新倉、淡色＝平倉）', d.srcs.oi, 80, (g, H) => {
      const rows = []; for (let i = 1; i < oi.length; i++) rows.push({ a: oi[i - 1].t, b: oi[i].t, d: oi[i].v - oi[i - 1].v, dp: (pAt(oi[i].t) ?? 0) - (pAt(oi[i - 1].t) ?? 0) });
      if (!rows.length) return { empty: '沒有持倉資料' };
      const mx = Math.max(...rows.map((r) => Math.abs(r.d))) || 1, mid = H / 2;
      for (const r of rows) {
        const up = r.dp > 0, dn = r.dp < 0, open = r.d > 0, col = up ? 'var(--up)' : dn ? 'var(--down)' : 'var(--muted)', h = (Math.abs(r.d) / mx) * (H / 2 - 2), x = X(r.a), w = Math.max(1, X(r.b) - X(r.a) - 0.6);
        el('rect', { x, y: open ? mid - h : mid, width: w, height: Math.max(0.5, h), fill: col, opacity: (up || dn) && !open ? 0.4 : 0.9 }, g);
      }
      el('line', { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: 'var(--line)' }, g);
      return { ticks: [[4, '+' + fmt(mx)], [H - 2, '−' + fmt(mx)]] };
    }, (t) => { const i = bis(d.oi, t); if (i < 1) return ''; const dd = d.oi[i].v - d.oi[i - 1].v, dp = (pAt(d.oi[i].t) ?? 0) - (pAt(d.oi[i - 1].t) ?? 0); const k = dp > 0 ? (dd > 0 ? '價漲＋持倉增＝新多單' : '價漲＋持倉減＝空單回補') : dp < 0 ? (dd > 0 ? '價跌＋持倉增＝新空單' : '價跌＋持倉減＝多單平倉') : '價平'; return `${dd >= 0 ? '+' : ''}${fmt(dd)}　${k}`; });
    // 爆倉
    const lq = d.liq;
    P('liq', '爆倉（金額 USD：▲ 多單被爆　▼ 空單被爆）', lq ? `OKX 近 ${lq.n} 筆，只含 OKX` + (lq.from ? `，起 ${new Date(lq.from).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '') : '', 80, (g, H) => {
      if (!lq || !lq.bins.length) return { empty: lq ? 'OKX 近期沒有爆倉單' : '爆倉資料抓不到' };
      const mx = Math.max(...lq.bins.map((b) => Math.max(b.long, b.short))) || 1, mid = H / 2, bw = Math.max(1.5, ((W - padL - padR) / d.candles.length) * 0.8);
      for (const b of lq.bins) { const x = X(b.t + ms / 2) - bw / 2, hl = (b.long / mx) * (H / 2 - 2), hs = (b.short / mx) * (H / 2 - 2); if (hl) el('rect', { x, y: mid - hl, width: bw, height: hl, fill: 'var(--down)' }, g); if (hs) el('rect', { x, y: mid, width: bw, height: hs, fill: 'var(--up)' }, g); }
      el('line', { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: 'var(--line)' }, g);
      return { ticks: [[4, fmt(mx)], [H - 2, fmt(mx)]] };
    }, (t) => { if (!lq) return ''; const b = lq.bins.find((x) => t >= x.t && t < x.t + ms); return b ? `多單 $${fmt(b.long)}　空單 $${fmt(b.short)}` : '這根沒有爆倉'; });
    // 主動買賣量差
    const cv = inR(d.cvd);
    P('cvd', '主動買賣量差（買 − 賣）', d.srcs.cvd, 80, (g, H) => {
      if (!cv.length) return { empty: '沒有主動買賣量資料' };
      const mx = Math.max(...cv.map((c) => Math.abs(c.v))) || 1, mid = H / 2, st = cv.length > 1 ? cv[1].t - cv[0].t : ms, bw = Math.max(1, ((W - padL - padR) * st) / (t1 - t0) * 0.8);
      for (const c of cv) { const h = (Math.abs(c.v) / mx) * (H / 2 - 2); el('rect', { x: X(c.t + st / 2) - bw / 2, y: c.v >= 0 ? mid - h : mid, width: bw, height: Math.max(0.5, h), fill: c.v >= 0 ? 'var(--up)' : 'var(--down)' }, g); }
      el('line', { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: 'var(--line)' }, g);
      return { ticks: [[4, '+' + fmt(mx)], [H - 2, '−' + fmt(mx)]] };
    }, (t) => { const i = bis(d.cvd, t); return i >= 0 ? `${d.cvd[i].v >= 0 ? '+' : ''}${fmt(d.cvd[i].v)}` : ''; });
    // 資金費率
    const fu = d.fund;
    P('fund', '資金費率（%／結算）', d.srcs.fund, 70, (g, H) => {
      const f = fu.filter((x) => x.t >= t0 - 8 * 3600e3 && x.t <= t1);
      if (!f.length) return { empty: '範圍內沒有資金費率資料' };
      const mx = Math.max(...f.map((c) => Math.abs(c.v)), 0.005), mid = H / 2, st = fu.length > 1 ? fu[fu.length - 1].t - fu[fu.length - 2].t : 8 * 3600e3, bw = Math.max(2, ((W - padL - padR) * st) / (t1 - t0) * 0.8);
      for (const c of f) { const h = (Math.abs(c.v) / mx) * (H / 2 - 2); el('rect', { x: X(c.t) - bw / 2, y: c.v >= 0 ? mid - h : mid, width: bw, height: Math.max(0.5, h), fill: c.v >= 0 ? 'var(--up)' : 'var(--down)' }, g); }
      el('line', { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: 'var(--line)' }, g);
      return { ticks: [[4, '+' + mx.toFixed(3)], [H - 2, '−' + mx.toFixed(3)]] };
    }, (t) => { const i = bis(fu, t); return i >= 0 ? `${fu[i].v.toFixed(4)}%` : ''; });
    // 多空比
    for (const [key, title, arr] of [['top', '大戶持倉量多空比', d.top], ['glob', '散戶帳戶多空比', d.glob]]) {
      const a = inR(arr);
      P(key, title, d.srcs[key], 80, (g, H) => lineChart(g, H, a, 'var(--accent)', false, 1), (t) => { const i = bis(arr, t); return i >= 0 ? arr[i].v.toFixed(3) : ''; });
    }
    // ---- 組版 ----
    function lineChart(g, H, a, col, area, ref) {
      if (a.length < 2) return { empty: '沒有資料' };
      let lo = Math.min(...a.map((x) => x.v)), hi = Math.max(...a.map((x) => x.v));
      const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1, y0 = lo - pad, y1 = hi + pad, Y = (v) => H - ((v - y0) / (y1 - y0)) * H;
      const pts = a.map((x) => `${X(x.t).toFixed(1)},${Y(x.v).toFixed(1)}`).join(' ');
      if (area) el('polygon', { points: `${X(a[0].t).toFixed(1)},${H} ${pts} ${X(a[a.length - 1].t).toFixed(1)},${H}`, fill: col, opacity: 0.12 }, g);
      if (ref != null && ref > y0 && ref < y1) el('line', { x1: padL, x2: W - padR, y1: Y(ref), y2: Y(ref), stroke: 'var(--line)', 'stroke-dasharray': '3 3' }, g);
      el('polyline', { points: pts, fill: 'none', stroke: col, 'stroke-width': 1.5 }, g);
      return { ticks: [[Y(hi), fmt(hi, hi >= 10 ? 1 : 3)], [Y(lo), fmt(lo, lo >= 10 ? 1 : 3)]] };
    }
    const titleH = 18, axisH = 22, total = panels.reduce((s, p) => s + titleH + p.h + gap, 0) + axisH;
    body.innerHTML = ''; const svg = el('svg', { width: W, height: total, viewBox: `0 0 ${W} ${total}`, class: 'chart-svg' }); body.appendChild(svg);
    let y = 0; const reads = [], cross = [];
    for (const p of panels) {
      const head = el('text', { x: padL, y: y + 13, class: 'ch-title' }, svg);
      head.innerHTML = `<tspan class="ch-t">${esc(p.title)}</tspan><tspan class="ch-s" dx="8">${esc(p.src || '')}</tspan><tspan class="ch-r" dx="10"></tspan>`;
      reads.push({ p, node: head.lastChild }); y += titleH;
      const g = el('g', { transform: `translate(0,${y})` }, svg);
      el('rect', { x: padL, y: 0, width: W - padL - padR, height: p.h, fill: 'none', stroke: 'var(--line)' }, g);
      const cid = 'chc' + p.key; const defs = el('clipPath', { id: cid }, g); el('rect', { x: padL, y: 0, width: W - padL - padR, height: p.h }, defs);
      const gg = el('g', { 'clip-path': `url(#${cid})` }, g), r = p.build(gg, p.h) || {};
      if (r.empty) { const t = el('text', { x: padL + 8, y: p.h / 2 + 4, class: 'ch-empty' }, g); t.textContent = '⚠ ' + r.empty; }
      for (const [ty, tx] of r.ticks || []) { const t = el('text', { x: W - padR + 4, y: Math.min(p.h - 2, Math.max(9, ty + 3)), class: 'ch-tick' }, g); t.textContent = tx; }
      const cl = el('line', { y1: 0, y2: p.h, stroke: 'var(--muted)', 'stroke-dasharray': '2 3', visibility: 'hidden' }, g); cross.push(cl);
      y += p.h + gap;
    }
    // 時間軸
    const nt = Math.max(3, Math.floor((W - padL - padR) / 110));
    for (let i = 0; i <= nt; i++) { const t = t0 + ((t1 - t0) * i) / nt, dd = new Date(t); const t_ = el('text', { x: X(t), y: y + 14, class: 'ch-tick', 'text-anchor': i === 0 ? 'start' : i === nt ? 'end' : 'middle' }, svg); t_.textContent = dd.toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    const move = (e) => {
      const r = svg.getBoundingClientRect(), x = e.clientX - r.left; if (x < padL || x > W - padR) return;
      const t = t0 + ((x - padL) / (W - padL - padR)) * (t1 - t0);
      for (const c of cross) { c.setAttribute('x1', x); c.setAttribute('x2', x); c.setAttribute('visibility', 'visible'); }
      for (const { p, node } of reads) node.textContent = p.read(t);
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { for (const c of cross) c.setAttribute('visibility', 'hidden'); });
  }
  load(tf);
}
