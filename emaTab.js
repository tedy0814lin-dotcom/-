// 均線突破檢視（維加斯頁的第二個檢視，觀察用）：EMA 12/45/144/169/288/338。規則與回測見 lib/ema.js
// 專案回測：加密 15 分（12 檔、2021～2026）扣費後 −0.10～−0.13R；台股 1H 回踩再突破 −0.22R；都不比隨機進場好 → 不計分、不推播
const ST = { entry: '進場訊號：1H 剛收盤再突破', pb: '回踩中，等再突破', brk: '1H 剛突破，等回踩', late: '再突破已過 1～3 根' };
const GO = { entry: 0, pb: 1, brk: 2, late: 3 };
const COL = ['#ff9800', '#26c6da', '#ab47bc', '#8bc34a', '#f48fb1', '#5c6bc0'], EN = [12, 45, 144, 169, 288, 338];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtT = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function draw(cd, now, dir) {
  const bars = cd.bars, N = bars.length; if (!N) return '';
  const Wd = 1000, Ht = 420, pt = 10, pr = 56, px0 = 6, xr = Wd - pr, ph = Ht - pt - 18, dx = (xr - px0) / (N + 6), bw = Math.max(1.4, dx * 0.6), X = (i) => px0 + (i + 0.5) * dx, f = (v) => v.toFixed(1);
  const lv = [now.stop, now.tgt].filter((v) => v > 0);
  let lo = Math.min(...bars.map((b) => b[2]), ...lv, ...cd.e.map((e) => e[N - 1])), hi = Math.max(...bars.map((b) => b[1]), ...lv); const pd = (hi - lo) * 0.05; lo -= pd; hi += pd;
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph;
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" class="pc" role="img" aria-label="均線突破圖">`;
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; s += `<line x1="${px0}" x2="${xr}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="pc-g"/><text x="${xr + 4}" y="${f(Y(v) + 3)}" class="pc-t">${px(v)}</text>`; }
  cd.e.forEach((e, k) => { s += `<polyline fill="none" stroke="${COL[k]}" stroke-width="1.3" points="${e.map((v, i) => `${f(X(i))},${f(Y(v))}`).join(' ')}"/>`; });
  bars.forEach((b, i) => { const c = b[3] >= b[0] ? 'pc-u' : 'pc-d', x = X(i), y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3])); s += `<line x1="${f(x)}" x2="${f(x)}" y1="${f(Y(b[1]))}" y2="${f(Y(b[2]))}" class="${c}s"/><rect x="${f(x - bw / 2)}" y="${f(y1)}" width="${f(bw)}" height="${f(Math.max(1, y2 - y1))}" class="${c}"/>`; });
  const up = dir > 0, lab = (i, t, col) => (i == null || i < 0 || i >= N ? '' : `<text x="${f(X(i))}" y="${f(up ? Y(bars[i][1]) - 5 : Y(bars[i][2]) + 13)}" class="pc-t" fill="${col}" text-anchor="middle" font-weight="700">${t}</text>`);
  s += lab(cd.marks.b, '突破K', '#ffeb3b') + lab(cd.marks.p, '回踩', '#4fc3f7') + lab(cd.marks.r, '再突破', '#ff5252');
  const ln = (v, t, col) => `<line x1="${f(X(N - 8))}" x2="${xr}" y1="${f(Y(v))}" y2="${f(Y(v))}" stroke="${col}" stroke-dasharray="4 3"/><text x="${xr - 3}" y="${f(Y(v) - 3)}" class="pc-t" fill="${col}" text-anchor="end">${t} ${px(v)}</text>`;
  s += ln(now.stop, '止損', '#ef5350') + ln(now.tgt, '2R', '#26a69a');
  for (const i of [0, 2, 4, 6].map((k) => Math.round((k * (N - 1)) / 6))) s += `<text x="${f(X(i))}" y="${Ht - 3}" class="pc-t" text-anchor="${i === 0 ? 'start' : i >= N - 1 ? 'end' : 'middle'}">${esc(fmtT(cd.t[i]))}</text>`;
  return s + '</svg>';
}

export function createEmaTab({ api, el }) {
  const st = { m: 'crypto', data: {}, loading: false, error: '', loaded: {}, charts: {}, group: null, dir: 0 };
  const items = (m) => {
    const D = st.data[m]?.d || {}, names = st.data[m]?.names || {}, out = [];
    for (const [s, v] of Object.entries(D)) for (const k of ['L', 'S']) { const r = v?.[k]; if (r?.now) out.push({ key: s + '|' + r.dir, s, name: names[s] || s, r, n: r.now, g: r.now.status }); }
    return out;
  };
  function card(it) {
    const { r, n } = it, d = r.d, up = r.dir > 0, ex = st.charts[it.key];
    const rows = `<div class="vg-row"><span class="k">狀態</span><b>${esc(ST[n.status])}</b> ・ 突破 K 在 ${n.ageB} 根 1H 前${n.pc != null ? ` ・ 回踩處 ${n.pc} 條均線疊合` : ''}</div>
      <div class="vg-row"><span class="k">日線</span>${up ? '站上' : '跌破'}全部均線 ・ 位置 ${(d.pos * 100).toFixed(0)}%（250 日）・ 長均線寬度 ${d.sp.toFixed(1)}×ATR ・ 斜率 ${d.slope.toFixed(2)}</div>
      <div class="vg-row"><span class="k">${n.status === 'entry' ? '進場' : '預計'}</span>進 <b>${px(n.price)}</b> ・ 止損 <span class="down">${px(n.stop)}</span>（${n.stPct.toFixed(2)}%） ・ 2R ${px(n.tgt)}${n.why ? `<br><span class="muted">不符合風險範圍：${esc(n.why)}</span>` : ''}</div>`;
    const body = ex ? (ex.loading ? '<div class="muted small" style="padding:10px">載入中…</div>' : ex.err ? `<div class="muted small" style="padding:10px">沒有圖：${esc(ex.err)}</div>` : `<div class="vg-chart">${draw(ex.data, n, r.dir)}<div class="muted small" style="padding:4px 2px">${EN.map((e, k) => `<span style="color:${COL[k]}">EMA${e}</span>`).join('・')}　紅＝止損、綠＝2R 止盈（回踩最低 −0.1×ATR）</div></div>`) : '';
    return `<article class="card"><div class="card-head"><span class="sym num">${esc(it.name)}</span><span class="cat ${up ? 'cat-long' : 'cat-short'}">${up ? '做多' : '做空'}</span><div class="price"><span class="p num">${px(n.price)}</span></div></div>${rows}
      <div class="vg-cwrap"><button class="ghost vg-cbtn" data-chart="${esc(it.key)}">${ex ? '收起圖' : '展開看圖（1H K 線＋六條均線）'}</button>${body}</div></article>`;
  }
  function render() {
    const m = st.m, all = items(m), cnt = { entry: 0, pb: 0, brk: 0, late: 0 }; all.forEach((x) => cnt[x.g]++);
    const shown = all.filter((x) => (st.group ? x.g === st.group : x.g !== 'late') && (!st.dir || x.r.dir === st.dir)).sort((a, b) => GO[a.g] - GO[b.g] || a.name.localeCompare(b.name));
    let html = '', cur = null;
    for (const x of shown) { if (x.g !== cur) { cur = x.g; html += `<h3 class="vg-h">${ST[cur]}（${cnt[cur]}）</h3>`; } html += card(x); }
    const chip = (k) => `<button class="chip" data-g="${k}" aria-pressed="${st.group === k}">${ST[k]} <b>${cnt[k]}</b></button>`, at = st.data[m]?.at;
    el.innerHTML = `<div class="toolbar"><button class="chip" data-m="crypto" aria-pressed="${m === 'crypto'}">加密（多空）</button><button class="chip" data-m="tw" aria-pressed="${m === 'tw'}">台股（只做多）</button>
        <span class="spacer"></span><button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '重新整理'}</button></div>
      <div class="toolbar">${['entry', 'pb', 'brk', 'late'].map(chip).join('')}<button class="chip chip-long" data-d="1" aria-pressed="${st.dir === 1}">只看做多</button><button class="chip chip-short" data-d="-1" aria-pressed="${st.dir === -1}">只看做空</button></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      <p class="muted">${m === 'tw' ? '股價 10–200 元、成交值前 120 名；分時資料來自 Yahoo 財經。' : 'BingX 成交額前 80 名永續合約（資料用幣安合約）。'}${at ? `快照更新 ${fmtT(at)}。` : ''}日線以前一個已收盤日判斷。</p>
      <style>.vg-h{grid-column:1/-1;font-size:15px;margin:14px 0 0}</style><div class="vg-grid">${html || (st.loading ? '' : '<p class="muted">目前沒有符合的標的。</p>')}</div>`;
  }
  async function load(force = false) {
    const m = st.m; if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try { if (!st.data[m] || force) st.data[m] = await api(`/api/ema?m=${m}`); st.loaded[m] = true; } catch (e) { st.error = e.message; }
    st.loading = false; render();
  }
  async function loadChart(it) {
    st.charts[it.key] = { loading: true }; render();
    try { st.charts[it.key] = { data: await api(`/api/ema?chart=1&m=${st.m}&s=${encodeURIComponent(it.s)}&dir=${it.r.dir}`) }; } catch (e) { st.charts[it.key] = { err: e.message }; }
    render();
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.chart) { const k = b.dataset.chart; if (st.charts[k]) { delete st.charts[k]; render(); } else { const it = items(st.m).find((x) => x.key === k); if (it) loadChart(it); } }
    else if (b.dataset.m) { st.m = b.dataset.m; render(); if (!st.loaded[st.m]) load(); }
    else if (b.dataset.g) { st.group = st.group === b.dataset.g ? null : b.dataset.g; render(); }
    else if (b.dataset.d) { const d = +b.dataset.d; st.dir = st.dir === d ? 0 : d; render(); }
    else if ('reload' in b.dataset) load(true);
  });
  return { load, render, get loaded() { return !!st.loaded[st.m]; }, get loading() { return st.loading; } };
}
