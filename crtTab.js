// CRT 分頁（觀察用）：Yuki CRT 教室規則。加密 1H CRT（5 分進場）、4H CRT（15 分進場）；台股日線 CRT（15 分進場，只做多）
// 專案回測（加密 60 檔 4H CRT＋KL＋15 分進場）扣費後約 −0.12R、贏不過隨機進場 → 不計分、不推播，只拿來看圖與前向觀察
const TFS = { crypto: ['1h', '4h'], tw: ['1d'] };
const TFN = { '1h': '1H CRT（5分進場）', '4h': '4H CRT（15分進場）', '1d': '日線 CRT（15分進場）' };
const ST = {
  entry: ['進場訊號', 'entry'], ready: ['MSS 完成，等 CISD 進場', 'ready'], mss: ['TBS 完成，等 MSS', 'wait'], tbs: ['掃到 KL，等 LTF 掃低高（TBS）', 'wait'],
  swept: ['C2 掃到 KL，等收盤確認收回', 'far'], blocked: ['已被過濾', 'far'],
};
const GROUPS = { entry: '進場訊號', ready: '等進場（MSS 完成）', wait: '等 TBS／MSS', far: '其他' };
const GO = { entry: 0, ready: 1, wait: 2, far: 3 };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtT = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const grp = (n) => ST[n.status][1];
const outTxt = (o) => !o ? '' : o.res === 'sl' ? '止損' : o.res === 'be' ? 'TP1 後回到入場價（保本）' : o.h3 ? 'TP3 ✅' : o.h2 ? 'TP2 ✅' : o.h1 ? 'TP1 ✅' : o.over ? '時間到未達標' : '進行中';

// 圖：K 線＋C1 區間（CRH/CRL/50%）＋$$$（掃點）＋TBS／MSS＋缺口＋進場 #1＋止損（紅）／止盈（綠）區塊
function draw(cd, now) {
  if (!cd.bars.length) return '';
  const s0 = Math.max(0, Math.min(now.c1i ?? 0, cd.bars.length - 1) - 24), bars = cd.bars.slice(s0), T = cd.t.slice(s0), N = bars.length; // 只看 C1 前 24 根之後，放大看細節
  const o = (i) => (i == null ? null : i - s0);
  const Wd = 1000, Ht = 430, pt = 10, pr = 56, px0 = 6, xr = Wd - pr, ph = Ht - pt - 18, pw = xr - px0, dx = pw / (N + 14), bw = Math.max(1.4, dx * 0.6); // 右側留 14 格給止盈區
  const X = (i) => px0 + (i + 0.5) * dx;
  const tr = now.trade, pl = now.plan, e = tr || pl;
  const lv = [now.rH, now.rL, e?.entry, e?.sl, e?.t1, e?.t2].filter((v) => v > 0);
  let lo = Math.min(...bars.map((b) => b[2]), ...lv), hi = Math.max(...bars.map((b) => b[1]), ...lv);
  const rng = hi - lo; if (e?.t3 > 0 && e.t3 <= hi + rng * 0.5 && e.t3 >= lo - rng * 0.5) { lo = Math.min(lo, e.t3); hi = Math.max(hi, e.t3); }
  const pd = (hi - lo) * 0.05; lo -= pd; hi += pd;
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph;
  const f = (v) => v.toFixed(1);
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" class="pc" role="img" aria-label="CRT 圖">`;
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; s += `<line x1="${px0}" x2="${xr}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="pc-g"/><text x="${xr + 4}" y="${f(Y(v) + 3)}" class="pc-t">${px(v)}</text>`; }
  // C1 區間
  const c0 = Math.max(0, o(now.c1i) ?? 0), xa = X(c0) - dx / 2;
  s += `<rect x="${f(xa)}" y="${f(Y(now.rH))}" width="${f(xr - xa)}" height="${f(Y(now.rL) - Y(now.rH))}" fill="rgba(100,140,255,.10)"/>`;
  const hl = (v, t, dash, col) => `<line x1="${f(xa)}" x2="${xr}" y1="${f(Y(v))}" y2="${f(Y(v))}" stroke="${col}" stroke-width="1.2" ${dash ? 'stroke-dasharray="5 4"' : ''}/><text x="${f(xa + 3)}" y="${f(Y(v) - 3)}" class="pc-t" fill="${col}">${t}</text>`;
  s += hl(now.rH, 'CRH', false, '#6a8dff') + hl(now.rL, 'CRL', false, '#6a8dff') + hl(now.rM, '50%', true, '#8aa0d8');
  // 止損／止盈區塊
  if (e && e.entry > 0) {
    const i0 = tr ? Math.max(0, o(tr.i) ?? N - 1) : N - 1, xs = X(i0), live = !!tr, dash = live ? '' : 'stroke-dasharray="4 3"';
    const box = (a, b, col) => `<rect x="${f(xs)}" y="${f(Math.min(Y(a), Y(b)))}" width="${f(xr - xs)}" height="${f(Math.abs(Y(a) - Y(b)))}" fill="${col}" fill-opacity=".16" stroke="${col}" stroke-width="1" ${dash}/>`;
    s += box(e.entry, e.sl, '#ef5350') + box(e.entry, e.t2, '#26a69a');
    const ln = (v, t, col, d) => `<line x1="${f(xs)}" x2="${xr}" y1="${f(Y(v))}" y2="${f(Y(v))}" stroke="${col}" stroke-width="1" ${d ? 'stroke-dasharray="3 3"' : ''}/><text x="${xr - 3}" y="${f(Y(v) - 3)}" class="pc-t" fill="${col}" text-anchor="end">${t}</text>`;
    const hit = (k) => (tr && (k === 1 ? tr.h1 : k === 2 ? tr.h2 : tr.h3) ? ' ✅' : '');
    s += ln(e.entry, (live ? '進場 ' : '預計進場 ') + px(e.entry), '#e0e0e0', false) + ln(e.sl, '止損 ' + px(e.sl), '#ef5350', false)
      + ln(e.t1, 'TP1 ' + px(e.t1) + hit(1), '#26a69a', true) + ln(e.t2, 'TP2 ' + px(e.t2) + hit(2), '#26a69a', false);
    if (e.t3 > 0 && Y(e.t3) > 0 && Y(e.t3) < Ht) s += ln(e.t3, 'TP3 ' + px(e.t3) + hit(3), '#26a69a', true);
  }
  // 缺口（FVG）
  if (now.gap && o(now.gap[0]) >= 0) { const gi = o(now.gap[0]), [, gl, gh] = now.gap; s += `<rect x="${f(X(gi) - dx * 1.5)}" y="${f(Y(gh))}" width="${f(dx * 6)}" height="${f(Math.abs(Y(gl) - Y(gh)))}" fill="rgba(255,193,7,.22)" stroke="rgba(255,193,7,.6)"/><text x="${f(X(gi) - dx * 1.5)}" y="${f(Y(gh) - 2)}" class="pc-t" fill="#d9a400">FVG</text>`; }
  // K 棒
  bars.forEach((b, i) => {
    const up = b[3] >= b[0], c = up ? 'pc-u' : 'pc-d', x = X(i), y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3]));
    s += `<line x1="${f(x)}" x2="${f(x)}" y1="${f(Y(b[1]))}" y2="${f(Y(b[2]))}" class="${c}s"/><rect x="${f(x - bw / 2)}" y="${f(y1)}" width="${f(bw)}" height="${f(Math.max(1, y2 - y1))}" class="${c}"/>`;
  });
  // 標記：$$$ 掃點、TBS、MSS、#1
  const lab = (i, t, col, up) => (i == null || i < 0 || i >= N ? '' : `<text x="${f(X(i))}" y="${f(up ? Y(bars[i][1]) - 5 : Y(bars[i][2]) + 12)}" class="pc-t" fill="${col}" text-anchor="middle" font-weight="700">${t}</text>`);
  const dir = now.dir, sw = now.sweepI, sweepUp = dir === -1; // 做空＝掃上方高點
  s += lab(o(sw), '$$$', '#ffb300', sweepUp) + lab(o(now.tsI), 'TBS', '#c28bff', dir === -1) + lab(o(now.mssI), 'MSS', '#4db6ff', dir === -1);
  if (tr && o(tr.i) >= 0) s += lab(o(tr.i), '#1 ' + (dir === 1 ? '▲' : '▼'), '#e0e0e0', dir === -1);
  const ti = [0, 2, 4, 6].map((k) => Math.round((k * (N - 1)) / 6));
  for (const i of ti) s += `<text x="${f(X(i))}" y="${Ht - 3}" class="pc-t" text-anchor="${i === 0 ? 'start' : i >= N - 1 ? 'end' : 'middle'}">${esc(fmtT(T[i]))}</text>`;
  return s + '</svg>';
}

export function createCrtTab({ api, el }) {
  const st = { m: 'crypto', data: {}, loading: false, error: '', loaded: {}, charts: {}, group: null, dir: 0 };

  function items(m) {
    const D = st.data[m]?.d || {}, names = st.data[m]?.names || {}, out = [];
    for (const [s, v] of Object.entries(D)) for (const tf of TFS[m]) { const r = v?.[tf]; if (r?.now) out.push({ key: s + '|' + tf, s, tf, name: names[s] || s, r, n: r.now, g: grp(r.now) }); }
    return out;
  }

  function chartBlock(it) {
    const ex = st.charts[it.key];
    const body = ex.loading ? '<div class="muted small" style="padding:10px">載入中…</div>' : ex.err ? `<div class="muted small" style="padding:10px">沒有圖：${esc(ex.err)}</div>` : draw(ex.data.chart, { ...ex.data.now });
    return `<div class="vg-chart">${body}<div class="muted small" style="padding:4px 2px">藍框＝C1 區間（CRH／CRL，虛線 50%＝TP1）・$$$＝掃蕩點・黃框＝缺口・紅＝止損區・綠＝止盈區（TP2 為區間另一端，TP3 為外側流動性）</div></div>`;
  }
  async function loadChart(it) {
    st.charts[it.key] = { loading: true }; render();
    try { st.charts[it.key] = { data: await api(`/api/crt?chart=1&m=${st.m}&s=${encodeURIComponent(it.s)}&tf=${it.tf}`) }; }
    catch (e) { st.charts[it.key] = { err: e.message }; }
    render();
  }

  function card(it) {
    const { r, n } = it, up = n.dir > 0, e = n.trade || n.plan, tr = n.trade;
    const badge = `<span class="cat ${up ? 'cat-long' : 'cat-short'}">${up ? '做多' : '做空'} <b>${esc(TFN[it.tf])}・${esc(n.mode)}</b></span>`;
    const stTxt = n.status === 'blocked' && n.why ? `已被過濾：${n.why}` : ST[n.status][0];
    let rows = `<div class="vg-row"><span class="k">狀態</span><b>${esc(stTxt)}</b>${n.kl?.length ? ` ・ 掃到 KL：${esc(n.kl.join('、'))}` : ''}${n.depth != null ? ` ・ 掃蕩深度 ${(n.depth * 100).toFixed(0)}% 區間` : ''}</div>`;
    rows += `<div class="vg-row"><span class="k">區間</span>CRH ${px(n.rH)} ／ CRL ${px(n.rL)}（50% ${px(n.rM)}）</div>`;
    if (e) {
      const rr = (v) => (v == null ? '—' : '1:' + v.toFixed(1));
      rows += `<div class="vg-row"><span class="k">${tr ? '進場' : '預計'}</span>進 <b>${px(e.entry)}</b> ・ 止損 <span class="down">${px(e.sl)}</span>（${e.stPct != null ? e.stPct.toFixed(2) : '—'}%） ・ TP1 ${px(e.t1)}（${rr(e.rr1)}） ・ TP2 ${px(e.t2)}（${rr(e.rr2)}）${e.t3 ? ` ・ TP3 ${px(e.t3)}` : ''}${!tr && n.plan?.why ? `<br><span class="muted">計畫不成立：${esc(n.plan.why)}</span>` : ''}</div>`;
      if (tr) rows += `<div class="vg-row"><span class="k">進度</span>${fmtT(tr.t)} 進場 → ${esc(outTxt(tr))}</div>`;
      if (n.vp) rows += `<div class="vg-row"><span class="k">VP 參考</span>POC ${px(n.vp.poc)}・價值區 ${px(n.vp.val)}～${px(n.vp.vah)}${n.vp.inVA ? '（進場在價值區內）' : '（進場在價值區外）'}</div>`;
    }
    const rc = r.recent?.[0];
    if (rc && !tr) rows += `<div class="vg-row"><span class="k">上一筆</span>${esc(rc.mode)}${rc.dir > 0 ? '做多' : '做空'} ${fmtT(rc.t)} 進 ${px(rc.entry)} → ${esc(outTxt(rc.out))}</div>`;
    const ex = st.charts[it.key];
    return `<article class="card"><div class="card-head"><span class="sym num">${esc(it.name)}</span>${badge}<div class="price"><span class="p num">${px(r.price)}</span></div></div>${rows}
      <div class="vg-cwrap"><button class="ghost vg-cbtn" data-chart="${esc(it.key)}">${ex ? '收起圖' : '展開看圖（CRT 區間＋進場／止損／止盈）'}</button>${ex ? chartBlock(it) : ''}</div></article>`;
  }

  function render() {
    const m = st.m, all = items(m), cnt = { entry: 0, ready: 0, wait: 0, far: 0 };
    all.forEach((x) => cnt[x.g]++);
    const shown = all.filter((x) => (st.group ? x.g === st.group : x.g !== 'far') && (!st.dir || x.n.dir === st.dir))
      .sort((a, b) => GO[a.g] - GO[b.g] || a.name.localeCompare(b.name));
    let html = '', cur = null;
    for (const x of shown) { if (x.g !== cur) { cur = x.g; html += `<h3 class="vg-h">${GROUPS[cur]}（${cnt[cur]}）</h3>`; } html += card(x); }
    const chip = (k) => `<button class="chip" data-g="${k}" aria-pressed="${st.group === k}">${GROUPS[k]} <b>${cnt[k]}</b></button>`;
    const at = st.data[m]?.at;
    el.innerHTML = `<div class="toolbar"><button class="chip" data-m="crypto" aria-pressed="${m === 'crypto'}">加密（1H／4H）</button><button class="chip" data-m="tw" aria-pressed="${m === 'tw'}">台股（日線）</button>
        <span class="spacer"></span><button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '重新整理'}</button></div>
      <div class="panel warn">觀察用，不計分、不推播。專案回測（Yuki CRT 教室規則：4H CRT＋關鍵區＋15 分進場，加密 60 檔、2023～2026）扣費後約 −0.12R，各年份、各關鍵區類型都為負，且不比隨機進場好。1H CRT＋5 分進場沒有 5 分資料可回測。這裡只用來看圖和前向記錄，請勿單獨當進場依據。</div>
      <div class="toolbar">${['entry', 'ready', 'wait', 'far'].map(chip).join('')}<button class="chip chip-long" data-d="1" aria-pressed="${st.dir === 1}">只看做多</button><button class="chip chip-short" data-d="-1" aria-pressed="${st.dir === -1}">只看做空</button></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      <p class="muted">${m === 'tw' ? '股價 10–200 元、成交值前 120 名，只做多；分時資料來自 Yahoo 財經。' : 'BingX 成交額前 80 名永續合約。'}${at ? `快照更新 ${fmtT(at)}，約每 20 分鐘一次。` : ''}只列出目前有狀態的標的（掃到關鍵區後才會出現）。</p>
      <style>.vg-h{grid-column:1/-1;font-size:15px;margin:14px 0 0}</style><div class="vg-grid">${html || (st.loading ? '' : '<p class="muted">目前沒有符合的標的。</p>')}</div>`;
  }

  async function load(force = false) {
    const m = st.m; if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try { if (!st.data[m] || force) st.data[m] = await api(`/api/crt?m=${m}`); st.loaded[m] = true; }
    catch (e) { st.error = e.message; }
    st.loading = false; render();
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.chart) {
      const key = b.dataset.chart;
      if (st.charts[key]) { delete st.charts[key]; render(); } else { const it = items(st.m).find((x) => x.key === key); if (it) loadChart(it); }
    } else if (b.dataset.m) { st.m = b.dataset.m; render(); if (!st.loaded[st.m]) load(); }
    else if (b.dataset.g) { st.group = st.group === b.dataset.g ? null : b.dataset.g; render(); }
    else if (b.dataset.d) { const d = +b.dataset.d; st.dir = st.dir === d ? 0 : d; render(); }
    else if ('reload' in b.dataset) load(true);
  });
  return { load, render, get loaded() { return !!st.loaded[st.m]; }, get loading() { return st.loading; } };
}
