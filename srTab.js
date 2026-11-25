// 支撐壓力檢視（維加斯頁的第三個檢視，觀察用）：自動畫轉折點／訂單塊區＋SMC 趨勢，可切 4H／1H／15 分，均線可開關。規則見 lib/sr.js
// 專案回測（2026-11-25）：在這類區掛單扣費後皆為負、不比隨機好 → 只畫參考，不給進出場、不計分、不推播
const TFS = ['4h', '1h', '15m'], TFN = { '4h': '4H', '1h': '1H', '15m': '15分' };
const COL = ['#ff9800', '#26c6da', '#ab47bc', '#8bc34a', '#f48fb1', '#5c6bc0'], EN = [12, 45, 144, 169, 288, 338];
const ZC = '#5b8cff'; // 區一律同色（不分支撐壓力，突破後角色會互換）
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtT = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const TR = { 1: ['多頭', 'up'], '-1': ['空頭', 'down'], 0: ['未定', 'muted'] };

function draw(cd, showEma) {
  const bars = cd.bars, N = bars.length; if (!N) return '';
  const Wd = 1000, Ht = 440, pt = 10, pr = 60, px0 = 6, xr = Wd - pr, ph = Ht - pt - 18, dx = (xr - px0) / (N + 4), bw = Math.max(1.4, dx * 0.6), X = (i) => px0 + (i + 0.5) * dx, f = (v) => v.toFixed(1);
  const kz = cd.z.filter((z) => !z.old); let lo = Math.min(...bars.map((b) => b[2]), ...kz.map((z) => z.lo)), hi = Math.max(...bars.map((b) => b[1]), ...kz.map((z) => z.hi));
  const pd = (hi - lo) * 0.04; lo -= pd; hi += pd;
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph, inR = (v) => v >= lo && v <= hi;
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" class="pc" role="img" aria-label="支撐壓力圖">`;
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; s += `<line x1="${px0}" x2="${xr}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="pc-g"/><text x="${xr + 4}" y="${f(Y(v) + 3)}" class="pc-t">${px(v)}</text>`; }
  const lab = []; // 文字最後一起排，互相不重疊
  for (const z0 of cd.z) { // 區：畫滿整張圖；碰過的區超出圖的價格範圍就截掉
    if (z0.hi < lo || z0.lo > hi) continue; const z = { ...z0, lo: Math.max(z0.lo, lo), hi: Math.min(z0.hi, hi) };
    const x0 = px0, y1 = Y(z.hi), y2 = Y(z.lo), col = ZC; // 區畫滿整張圖（長一點比較好看出價格曾經在哪裡碰過）
    s += `<rect x="${f(x0)}" y="${f(y1)}" width="${f(xr - x0)}" height="${f(Math.max(2, y2 - y1))}" fill="${col}" fill-opacity="${Math.min(0.12 + 0.03 * z.n, 0.4)}" stroke="${col}" stroke-opacity="0.8" stroke-width="1"/>`;

  }
  if (showEma) cd.e.forEach((e, k) => { s += `<polyline fill="none" stroke="${COL[k]}" stroke-width="1.2" points="${e.map((v, i) => (inR(v) ? `${f(X(i))},${f(Y(v))}` : '')).filter(Boolean).join(' ')}"/>`; });
  bars.forEach((b, i) => { const c = b[3] >= b[0] ? 'pc-u' : 'pc-d', x = X(i), y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3])); s += `<line x1="${f(x)}" x2="${f(x)}" y1="${f(Y(b[1]))}" y2="${f(Y(b[2]))}" class="${c}s"/><rect x="${f(x - bw / 2)}" y="${f(y1)}" width="${f(bw)}" height="${f(Math.max(1, y2 - y1))}" class="${c}"/>`; });
  for (const e of cd.ev) { // 結構：被突破的轉折價畫虛線到突破那根
    const col = e.d > 0 ? '#26a69a' : '#ef5350', x0 = X(Math.max(0, e.x0)), x1 = X(e.x1), y = Y(e.v);
    s += `<line x1="${f(x0)}" x2="${f(x1)}" y1="${f(y)}" y2="${f(y)}" stroke="${col}" stroke-dasharray="4 3" stroke-width="1.2"/>`;
    lab.push({ x: (x0 + x1) / 2, y: e.d > 0 ? y - 4 : y + 12, a: 'middle', col, t: e.type, b: 1 });
  }
  const placed = [], wd = (t) => [...t].reduce((n, ch) => n + (/[\x00-\x7f]/.test(ch) ? 6.6 : 11), 0) + 4;
  for (const L of lab) { // 跟已放的文字重疊就往下移一行
    const w = wd(L.t), xl = L.a === 'end' ? L.x - w : L.a === 'middle' ? L.x - w / 2 : L.x, hit = (y) => placed.some((p) => xl < p.xr && xl + w > p.xl && y - 11 < p.yb && y + 2 > p.yt);
    let y = L.y; for (let k = 0; k < 30 && hit(y); k++) y += 13;
    placed.push({ xl, xr: xl + w, yt: y - 11, yb: y + 2 });
    s += `<rect x="${f(xl - 1)}" y="${f(y - 11)}" width="${f(w + 2)}" height="14" rx="2" fill="var(--panel-2)" fill-opacity="0.8"/><text x="${f(L.x)}" y="${f(y)}" class="pc-t" fill="${L.col}" text-anchor="${L.a}"${L.b ? ' font-weight="700"' : ''}>${esc(L.t)}${L.tip ? `<title>${esc(L.tip)}</title>` : ''}</text>`;
  }
  for (const i of [0, 2, 4, 6].map((k) => Math.round((k * (N - 1)) / 6))) s += `<text x="${f(X(i))}" y="${Ht - 3}" class="pc-t" text-anchor="${i === 0 ? 'start' : i >= N - 1 ? 'end' : 'middle'}">${esc(fmtT(cd.t[i]))}</text>`;
  return s + '</svg>';
}

export function createSrTab({ api, el }) {
  const st = { ctf: {}, m: 'crypto', tf: '1h', ema: false, data: {}, loading: false, error: '', loaded: {}, charts: {}, f: null, q: '', by: {} };
  try { const o = JSON.parse(localStorage.getItem('sr_ui') || '{}'); if (TFS.includes(o.tf)) st.tf = o.tf; st.ema = !!o.ema; } catch {}
  const saveUi = () => { try { localStorage.setItem('sr_ui', JSON.stringify({ tf: st.tf, ema: st.ema })); } catch {} };
  const items = (m) => { const D = st.data[m]?.d || {}, names = st.data[m]?.names || {}; return Object.entries(D).filter(([, v]) => v && !v.error).map(([s, v]) => ({ key: s, s, name: names[s] || s, v })); };
  const tline = (v, cur) => TFS.map((tf) => { const r = v[tf]; if (!r) return `<span class="muted">${TFN[tf]} —</span>`; const [t, c] = TR[r.trend]; return `<span class="${tf === cur ? '' : 'muted'}">${TFN[tf]} <b class="${c}">${t}</b>${r.ev ? `（${r.ev.type}${r.ev.dir > 0 ? '↑' : '↓'} ${r.ev.ago} 根前）` : ''}${r.inZone ? ' <b>在區內</b>' : ''}</span>`; }).join('　');
  const tfOf = (it) => st.ctf[it.key] || st.tf;
  function near(it) {
    const tf = tfOf(it), r = it.v[tf];
    return r ? `<span class="k">${TFN[tf]} 現價</span>對 4H 區：${r.res != null ? `距壓力 ${r.res.toFixed(1)}×ATR` : '上方無區'} ・ ${r.sup != null ? `距支撐 ${r.sup.toFixed(1)}×ATR` : '下方無區'}${r.inZone ? ' ・ <b>現價在區內</b>' : ''}` : '';
  }
  function card(it) {
    const r = it.v[tfOf(it)];

    return `<article class="card" data-ck="${esc(it.key)}"><div class="card-head"><span class="sym num">${esc(it.name)}</span><div class="price"><span class="p num">${px(r?.price)}</span></div></div>
      <div class="vg-row sr-tl" style="flex-wrap:wrap">${tline(it.v, tfOf(it))}</div><div class="vg-row sr-near">${near(it)}</div><div class="vg-cwrap">${chartHtml(it)}</div></article>`;
  }
  function chartHtml(it) {
    const ex = st.charts[it.key], tf = tfOf(it), cd = ex?.data?.[tf];
    const bar = `<div class="vg-tfbar">${TFS.map((t) => `<button class="chip vg-tf" data-ctf="${esc(it.key)}|${t}" aria-pressed="${tf === t}">${TFN[t]}</button>`).join('')}</div>`;
    if (!ex || ex.loading) return '<div class="muted small" style="padding:10px">載入圖中…</div>';
    if (ex.err || !cd) return `<div class="vg-chart">${bar}<div class="muted small" style="padding:10px">沒有圖：${esc(ex.err || '這個週期資料不足')}</div></div>`;
    return `<div class="vg-chart">${bar}${draw(cd, st.ema)}<div class="muted small" style="padding:4px 2px">藍色＝4H 支撐壓力區（各時區都畫同一組；價格最常轉折＋均線重疊處，顏色越深越強，含這段期間價格碰過的強區）；虛線＋BOS／CHoCH＝被突破的結構（綠向上、紅向下）${st.ema ? `<br>${EN.map((e, k) => `<span style="color:${COL[k]}">EMA${e}</span>`).join('・')}` : ''}</div></div>`;
  }
  const paint = (key) => { const a = el.querySelector(`[data-ck="${CSS.escape(key)}"]`), it = st.by[key]; if (!a || !it) return; a.querySelector('.vg-cwrap').innerHTML = chartHtml(it); a.querySelector('.sr-tl').innerHTML = tline(it.v, tfOf(it)); a.querySelector('.sr-near').innerHTML = near(it); a.querySelector('.p').textContent = px(it.v[tfOf(it)]?.price); };
  let io;
  function observe() {
    io?.disconnect();
    io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return; io.unobserve(e.target);
      const it = st.by[e.target.dataset.ck]; if (it && !st.charts[it.key]) loadChart(it);
    }), { rootMargin: '700px 0px' });
    el.querySelectorAll('article[data-ck]').forEach((a) => io.observe(a));
  }
  function render() {
    const m = st.m, all = items(m), tr = (x) => { const t = TFS.map((f) => x.v[f]?.trend); return t.every((v) => v === 1) ? 1 : t.every((v) => v === -1) ? -1 : 0; }, inz = (x) => TFS.some((f) => x.v[f]?.inZone);
    const cnt = { up: all.filter((x) => tr(x) === 1).length, dn: all.filter((x) => tr(x) === -1).length, z: all.filter(inz).length };
    const q = st.q.toUpperCase();
    const shown = all.filter((x) => (q ? x.name.toUpperCase().includes(q) || x.s.toUpperCase().startsWith(q) : true) && (!st.f || (st.f === 'up' ? tr(x) === 1 : st.f === 'dn' ? tr(x) === -1 : inz(x))))
      .sort((a, b) => inz(b) - inz(a) || a.name.localeCompare(b.name));
    st.by = Object.fromEntries(shown.map((x) => [x.key, x]));
    const chip = (k, t) => `<button class="chip" data-f="${k}" aria-pressed="${st.f === k}">${t} <b>${cnt[k]}</b></button>`, at = st.data[m]?.at;
    el.innerHTML = `<div class="toolbar"><button class="chip" data-m="crypto" aria-pressed="${m === 'crypto'}">加密</button><button class="chip" data-m="tw" aria-pressed="${m === 'tw'}">台股</button>
        <span class="spacer"></span><button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '重新整理'}</button></div>
      <div class="toolbar">${chip('up', '三週期都多頭')}${chip('dn', '三週期都空頭')}${chip('z', '現價在區內')}<button class="chip" data-ema aria-pressed="${st.ema}">均線 ${st.ema ? '開' : '關'}</button><input id="sr-q" class="search" type="search" placeholder="搜尋代號或名稱" value="${esc(st.q)}" style="max-width:170px"></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      <p class="muted">${m === 'tw' ? '股價 10–200 元、成交值前 120 名；Yahoo 財經，4H 由 1H 合成。' : 'BingX 成交額前 80 名永續合約。'}${at ? `快照更新 ${fmtT(at)}。` : ''}自動畫的區只當參考，不給進出場。</p>
      ${shown.length ? `<p class="muted">共 ${shown.length} 檔，往下滑看下一檔</p>` + shown.map((it, i) => `<div class="muted small" style="margin:14px 0 4px">${i + 1} / ${shown.length}</div>${card(it)}`).join('') : st.loading ? '' : '<p class="muted">目前沒有符合的標的。</p>'}`;
    observe();
  }
  async function load(force = false) {
    const m = st.m; if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try { if (!st.data[m] || force) st.data[m] = await api(`/api/sr?m=${m}`); st.loaded[m] = true; } catch (e) { st.error = e.message; }
    st.loading = false; render();
  }
  async function loadChart(it) {
    st.charts[it.key] = { loading: true }; paint(it.key);
    try { st.charts[it.key] = { data: await api(`/api/sr?chart=1&m=${st.m}&s=${encodeURIComponent(it.s)}`) }; } catch (e) { st.charts[it.key] = { err: e.message }; }
    paint(it.key);
  }
  el.addEventListener('keydown', (e) => { if (e.target.id === 'sr-q' && e.key === 'Enter') { st.q = e.target.value.trim(); render(); el.querySelector('#sr-q')?.focus(); } });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ctf) { const [k, t] = b.dataset.ctf.split('|'); st.ctf[k] = t; paint(k); return; }
    if (b.dataset.m) { st.m = b.dataset.m; st.charts = {}; st.ctf = {}; render(); if (!st.loaded[st.m]) load(); }
    else if ('ema' in b.dataset) { st.ema = !st.ema; saveUi(); render(); }
    else if (b.dataset.f) { st.f = st.f === b.dataset.f ? null : b.dataset.f; render(); }
    else if ('reload' in b.dataset) load(true);
  });
  return { load, render, get loaded() { return !!st.loaded[st.m]; }, get loading() { return st.loading; } };
}
