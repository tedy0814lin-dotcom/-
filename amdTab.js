// AMD 操縱模型檢視（維加斯頁的第三個檢視，觀察用，只有台股 1H）。規則與回測見 lib/amd.js
// 專案回測：台股 1H 2R／24 根扣費 −0.30R、持有到 120 根 −0.09R，不比隨機進場好 → 不計分、不推播
const CF = { E: '吞噬', I: 'IFVG', F: '位移＋FVG' }, TR = { 順: '順勢', 逆: '逆勢', 盤: '盤整' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(4));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtT = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function draw(cd, now, dir) {
  const bars = cd.bars, N = bars.length, mk = cd.marks; if (!N) return '';
  const Wd = 1000, Ht = 420, pt = 10, pr = 56, px0 = 6, xr = Wd - pr, ph = Ht - pt - 18, dx = (xr - px0) / (N + 6), bw = Math.max(1.4, dx * 0.6), X = (i) => px0 + (i + 0.5) * dx, f = (v) => v.toFixed(1);
  let lo = Math.min(...bars.map((b) => b[2]), now.stop, mk.lo), hi = Math.max(...bars.map((b) => b[1]), mk.hi); const pd = (hi - lo) * 0.05; lo -= pd; hi += pd;
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph, up = dir > 0;
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" class="pc" role="img" aria-label="AMD 操縱圖">`;
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; s += `<line x1="${px0}" x2="${xr}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="pc-g"/><text x="${xr + 4}" y="${f(Y(v) + 3)}" class="pc-t">${px(v)}</text>`; }
  s += `<rect x="${f(X(mk.x0) - dx / 2)}" y="${f(Y(mk.hi))}" width="${f(X(mk.x1) - X(mk.x0) + dx)}" height="${f(Y(mk.lo) - Y(mk.hi))}" fill="#ff9800" fill-opacity=".12" stroke="#ff9800" stroke-dasharray="4 3"/><text x="${f(X(mk.x0))}" y="${f(Y(mk.hi) - 4)}" class="pc-t" fill="#ff9800">累積區</text>`;
  bars.forEach((b, i) => { const c = b[3] >= b[0] ? 'pc-u' : 'pc-d', x = X(i), y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3])); s += `<line x1="${f(x)}" x2="${f(x)}" y1="${f(Y(b[1]))}" y2="${f(Y(b[2]))}" class="${c}s"/><rect x="${f(x - bw / 2)}" y="${f(y1)}" width="${f(bw)}" height="${f(Math.max(1, y2 - y1))}" class="${c}"/>`; });
  const lab = (i, t, col) => `<text x="${f(X(i))}" y="${f(up ? Y(bars[i][2]) + 14 : Y(bars[i][1]) - 6)}" class="pc-t" fill="${col}" text-anchor="middle" font-weight="700">${t}</text>`;
  s += lab(mk.m, up ? '▲掃針' : '▼掃針', '#ffeb3b') + lab(mk.t, '確認', '#ff5252');
  s += `<line x1="${f(X(mk.m - 2))}" x2="${xr}" y1="${f(Y(now.stop))}" y2="${f(Y(now.stop))}" stroke="#ef5350" stroke-dasharray="4 3"/><text x="${xr - 3}" y="${f(Y(now.stop) - 3)}" class="pc-t" fill="#ef5350" text-anchor="end">止損 ${px(now.stop)}</text>`;
  for (const i of [0, 2, 4, 6].map((k) => Math.round((k * (N - 1)) / 6))) s += `<text x="${f(X(i))}" y="${Ht - 3}" class="pc-t" text-anchor="${i === 0 ? 'start' : i >= N - 1 ? 'end' : 'middle'}">${esc(fmtT(cd.t[i]))}</text>`;
  return s + '</svg>';
}

export function createAmdTab({ api, el }) {
  const st = { data: null, loading: false, error: '', loaded: false, charts: {}, dir: 0, tr: '', q: '', by: {} };
  const items = () => {
    const D = st.data?.d || {}, names = st.data?.names || {}, out = [];
    for (const [s, v] of Object.entries(D)) for (const r of [v?.L, v?.S]) if (r?.now) out.push({ key: s + '|' + r.dir, s, name: names[s] || s, r, n: r.now });
    return out;
  };
  function card(it) {
    const { r, n } = it, up = r.dir > 0;
    return `<article class="card" data-ck="${esc(it.key)}"><div class="card-head"><span class="sym num">${esc(it.name)}</span><span class="cat ${up ? 'cat-long' : 'cat-short'}">${up ? '做多 掃低收回' : '做空 掃高收回'}</span>${n.tr ? `<span class="cat">${TR[n.tr]}</span>` : ''}<div class="price"><span class="p num">${px(r.price)}</span></div></div>
      <div class="vg-row"><span class="k">狀態</span><b>${n.age === 0 ? '剛收盤確認' : `確認 ${n.age} 根 1H 前`}</b>（${n.conf.split('').map((c) => CF[c]).join('＋')}）・ 累積 ${n.W} 根 ・ 區間 ${n.bh.toFixed(1)}×ATR</div>
      <div class="vg-row"><span class="k">位置</span>${up ? '低' : '高'}位 ${(n.pos * 100).toFixed(0)}%（120 根，0＝最${up ? '低' : '高'}）</div>
      <div class="vg-row"><span class="k">參考</span>確認棒收 <b>${px(n.ref)}</b> ・ 止損 <span class="down">${px(n.stop)}</span>（${n.stPct.toFixed(2)}%）</div><div class="vg-cwrap">${chartHtml(it)}</div></article>`;
  }
  function chartHtml(it) {
    const ex = st.charts[it.key];
    return !ex || ex.loading ? '<div class="muted small" style="padding:10px">載入圖中…</div>' : ex.err ? `<div class="muted small" style="padding:10px">沒有圖：${esc(ex.err)}</div>` : `<div class="vg-chart">${draw(ex.data, it.n, it.r.dir)}</div>`;
  }
  const paint = (key) => { const w = el.querySelector(`[data-ck="${CSS.escape(key)}"] .vg-cwrap`), it = st.by[key]; if (w && it) w.innerHTML = chartHtml(it); };
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
    const all = items(), q = st.q.toUpperCase(), at = st.data?.at;
    const shown = all.filter((x) => (!q || x.name.toUpperCase().includes(q) || x.s.toUpperCase().startsWith(q)) && (!st.dir || x.r.dir === st.dir) && (!st.tr || x.n.tr === st.tr)).sort((a, b) => a.n.age - b.n.age || a.name.localeCompare(b.name));
    st.by = Object.fromEntries(shown.map((x) => [x.key, x]));
    const html = shown.length ? `<p class="muted">共 ${shown.length} 張，往下滑看下一檔</p>` + shown.map((it, i) => `<div class="muted small" style="margin:14px 0 4px">${i + 1} / ${shown.length}</div>${card(it)}`).join('') : '';
    el.innerHTML = `<div class="toolbar"><input id="amd-q" class="search" type="search" placeholder="搜尋代號或名稱" value="${esc(st.q)}" style="max-width:170px"><button class="chip chip-long" data-d="1" aria-pressed="${st.dir === 1}">只看做多</button><button class="chip chip-short" data-d="-1" aria-pressed="${st.dir === -1}">只看做空</button><button class="chip" data-t="順" aria-pressed="${st.tr === '順'}">只看順勢</button><button class="chip" data-t="逆" aria-pressed="${st.tr === '逆'}">只看逆勢</button><span class="spacer"></span><button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '重新整理'}</button></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      <p class="muted">台股 1H（股價 10–200 元、成交值前 120 名；分時資料來自 Yahoo 財經）。只列還沒派發、確認在最近 6 根內的標的。${at ? `快照更新 ${fmtT(at)}。` : ''}</p>
      ${html || (st.loading ? '' : '<p class="muted">目前沒有符合的標的。</p>')}`;
    observe();
  }
  async function load(force = false) {
    if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try { if (!st.data || force) st.data = await api('/api/amd?m=tw'); st.loaded = true; } catch (e) { st.error = e.message; }
    st.loading = false; render();
  }
  async function loadChart(it) {
    st.charts[it.key] = { loading: true }; paint(it.key);
    try { st.charts[it.key] = { data: await api(`/api/amd?chart=1&m=tw&s=${encodeURIComponent(it.s)}&dir=${it.r.dir}`) }; } catch (e) { st.charts[it.key] = { err: e.message }; }
    paint(it.key);
  }
  el.addEventListener('keydown', (e) => { if (e.target.id === 'amd-q' && e.key === 'Enter') { st.q = e.target.value.trim(); render(); el.querySelector('#amd-q')?.focus(); } });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) { st.tr = st.tr === b.dataset.t ? '' : b.dataset.t; render(); }
    else if (b.dataset.d) { const d = +b.dataset.d; st.dir = st.dir === d ? 0 : d; render(); }
    else if ('reload' in b.dataset) load(true);
  });
  return { load, render, get loaded() { return st.loaded; }, get loading() { return st.loading; } };
}
