// 台股型態頁：掃描成交量前 300 檔上市股票的日線，每個型態一張 K 線圖卡片（代號 名稱 型態 + K 線圖 + 畫出的型態）。
// 型態：底部／向上突破 7 種＋圓弧底、V 底、擴散三角形、菱形，以及它們的偏空版（頭部／向下跌破，用鏡像偵測）；另有 K 棒型態（吞噬、孕線、錘子線、射擊之星、晨星／黃昏之星、貫穿／烏雲罩頂、平頭頂／底）。
// 「確認」＝有量（突破日量 ≥1.5 倍 20 日均量）、同方向的 K 棒型態（最近 3 根內）、同方向的 MACD 柱狀體背離（最近 10 根內）、持續背離（連續 2 段以上）。
// 只做看圖參考：2026-11-03 台股 1,900 檔日線回測（扣 0.585%、前 75% 挑參數、後 25% 驗證），所有型態都沒有通過門檻，所以不計分、不推播。
const KEY = 'wr_pat_v3_';
const TOP = 300, BATCH = 15, CTOP = 120, CBATCH = 12, PAGE = 24, VOLX = 1.5, VOL5X = 1.3;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const taipeiDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const bucket = (mkt, tf) => (mkt === 'tw' ? taipeiDay() : String(Math.floor(Date.now() / ((tf === '4h' ? 10 : 30) * 60e3))));
const cacheGet = (id, stamp) => { try { const c = JSON.parse(localStorage.getItem(KEY + id)); return c && c.stamp === stamp ? c : null; } catch { return null; } };
function cacheSet(id, v) {
  try { Object.keys(localStorage).filter((k) => k.startsWith('wr_pat_') && !k.startsWith(KEY)).forEach((k) => localStorage.removeItem(k)); localStorage.setItem(KEY + id, JSON.stringify(v)); } catch {}
}
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(4) : Number(v).toPrecision(3));
const KINDS = [
  ['double_bottom', '雙底／雙頂'], ['triple_bottom', '三重底／三重頂'], ['inv_HS', '頭肩底／頭肩頂'], ['rectangle', '矩形整理'], ['asc_triangle', '上升／下降三角形'],
  ['sym_triangle', '對稱三角形'], ['falling_wedge', '下降／上升楔形'], ['rounded_bottom', '圓弧底／圓弧頂'], ['v_bottom', 'V 底／倒 V 頂'], ['broadening', '擴散三角形'], ['diamond', '菱形'],
  ['conv_asc', '收斂三角形'], ['conv_desc', '收斂三角形（下降）'], ['conv_sym', '收斂三角形（對稱）'], ['candle', '只有 K 棒型態'],
];
const KIND_OPTS = KINDS.filter(([k]) => k !== 'conv_desc' && k !== 'conv_sym');
const kindMatch = (it, k) => !k || it.kind === k || (k === 'conv_asc' && /^conv_/.test(it.kind));

// 把一檔股票拆成卡片：每個型態一張；沒有型態但有 K 棒型態的，K 棒型態自己一張
function cardsOf(code, r) {
  const out = [];
  const conf = (dir, it) => {
    const tags = [];
    if (it && it.state === 'formed' && it.volX != null && it.volX >= VOLX) tags.push({ t: `突破量 ×${it.volX.toFixed(1)}`, k: 'vol' });
    else if (it && it.state === 'forming' && r.vol5x != null && r.vol5x >= VOL5X) tags.push({ t: `近 5 日量 ×${r.vol5x.toFixed(1)}`, k: 'vol' });
    for (const c of r.candles) if (c.dir === dir && c.ago <= 2) tags.push({ t: `K 棒：${c.name}${c.ago ? '（前一根）' : ''}`, k: 'candle' });
    const d = dir > 0 ? r.div.bull : r.div.bear;
    if (d) tags.push({ t: `MACD ${dir > 0 ? '底' : '頂'}背離${d.k >= 2 ? `（持續 ×${d.k}）` : ''}`, k: d.k >= 2 ? 'div2' : 'div' });
    return tags;
  };
  for (const it of r.items) { const tags = conf(it.dir, it); out.push({ code, r, it, tags, score: tags.length + (tags.some((x) => x.k === 'div2') ? 1 : 0) }); }
  for (const dir of [1, -1]) {
    if (r.items.some((x) => x.dir === dir)) continue;
    const cs = r.candles.filter((c) => c.dir === dir);
    if (!cs.length) continue;
    const tags = conf(dir, null);
    out.push({ code, r, it: { dir, kind: 'candle', name: cs.map((c) => c.name).join('＋'), state: 'candle', pts: [], neckLine: null, lines: null }, tags, score: tags.length + (tags.some((x) => x.k === 'div2') ? 1 : 0) });
  }
  return out;
}

// ---- K 線圖 ----
function chart(card) {
  const { r, it } = card, bars = r.bars, N = bars.length;
  const Wd = 560, Ht = 250, Hv = 46, pl = 6, pr = 44, pt = 8, pb = 16 + Hv + 6;
  const px0 = pl, pw = Wd - pl - pr, ph = Ht - pt - 16 - Hv - 6;
  const dx = pw / N, bw = Math.max(1.2, dx * 0.62);
  const X = (i) => px0 + (i + 0.5) * dx;
  const lines = [];
  const off = r.off;
  const extra = [];
  if (it.stop) extra.push(it.stop);
  if (it.neck) extra.push(it.neck);
  for (const [, y] of it.pts || []) extra.push(y);
  let lo = Math.min(...bars.map((b) => b[2]), ...extra.filter((v) => v > 0)), hi = Math.max(...bars.map((b) => b[1]), ...extra);
  const padv = (hi - lo) * 0.04; lo -= padv; hi += padv;
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph;
  const vmax = Math.max(...bars.map((b) => b[4]), 1);
  const yv = (v) => Ht - 16 - (v / vmax) * Hv;
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" class="pc" role="img" aria-label="${esc(card.code + ' ' + it.name + ' K 線圖')}">`;
  // 價格格線
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); s += `<line x1="${px0}" x2="${Wd - pr}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="pc-g"/><text x="${Wd - pr + 4}" y="${(y + 3).toFixed(1)}" class="pc-t">${px(v)}</text>`; }
  // 日期
  for (const i of [0, Math.floor(N / 2), N - 1]) s += `<text x="${X(i).toFixed(1)}" y="${Ht - 2}" class="pc-t" text-anchor="${i === 0 ? 'start' : i === N - 1 ? 'end' : 'middle'}">${esc(r.dates[i] || '')}</text>`;
  // K 棒＋量
  bars.forEach((b, i) => {
    const up = b[3] >= b[0], cls = up ? 'pc-u' : 'pc-d', x = X(i);
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(b[1]).toFixed(1)}" y2="${Y(b[2]).toFixed(1)}" class="${cls}s"/>`;
    const y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3]));
    s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y2 - y1).toFixed(1)}" class="${cls}"/>`;
    s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${yv(b[4]).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Ht - 16 - yv(b[4])).toFixed(1)}" class="${cls} pc-v"/>`;
  });
  // 頸線／停損／收斂線／轉折點
  const xr = Wd - pr;
  if (it.neckLine) { const a = it.neckLine, i0 = Math.max(0, Math.min(a.i, N - 1)); s += `<line x1="${X(i0).toFixed(1)}" y1="${Y(a.v + a.s * (i0 - a.i)).toFixed(1)}" x2="${xr}" y2="${Y(a.v + a.s * (N - 1 - a.i)).toFixed(1)}" class="pc-neck"/>`; }
  else if (it.neck && it.state !== 'candle' && !it.lines) s += `<line x1="${px0}" x2="${xr}" y1="${Y(it.neck).toFixed(1)}" y2="${Y(it.neck).toFixed(1)}" class="pc-neck"/>`;
  if (it.lines) for (const L of [it.lines.u, it.lines.l]) { const t0 = Math.max(0, it.lines.t0); s += `<line x1="${X(t0).toFixed(1)}" y1="${Y(L[0] * (t0 + off) + L[1]).toFixed(1)}" x2="${xr}" y2="${Y(L[0] * (N - 1 + off) + L[1]).toFixed(1)}" class="pc-tri"/>`; }
  if (it.stop && it.state !== 'candle') s += `<line x1="${px0}" x2="${xr}" y1="${Y(it.stop).toFixed(1)}" y2="${Y(it.stop).toFixed(1)}" class="pc-stop"/><text x="${xr + 4}" y="${(Y(it.stop) + 3).toFixed(1)}" class="pc-t pc-ts">停損</text>`;
  if (it.pts && it.pts.length) {
    const P = it.pts.filter(([i]) => i >= 0 && i < N);
    if (P.length > 1) s += `<polyline points="${P.map(([i, y]) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" class="pc-zz"/>`;
    for (const [i, y] of P) s += `<circle cx="${X(i).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="3" class="pc-pt"/>`;
  }
  if (it.state === 'formed' && it.ago != null) { const i = N - 1 - it.ago; s += `<path d="M${X(i).toFixed(1)} ${(it.dir > 0 ? Y(bars[i][2]) + 9 : Y(bars[i][1]) - 9).toFixed(1)} l-4 ${it.dir > 0 ? 7 : -7} h8 z" class="pc-brk"/>`; }
  // K 棒型態框
  let cn = 0;
  for (const c of r.candles) {
    if (c.dir !== it.dir || c.ago > 2) continue;
    const i1 = Math.max(0, c.i), i0 = Math.max(0, c.i - c.len + 1);
    const hh = Math.max(...bars.slice(i0, i1 + 1).map((b) => b[1])), ll = Math.min(...bars.slice(i0, i1 + 1).map((b) => b[2]));
    s += `<rect x="${(X(i0) - dx * 0.6).toFixed(1)}" y="${(Y(hh) - 4).toFixed(1)}" width="${(X(i1) - X(i0) + dx * 1.2).toFixed(1)}" height="${(Y(ll) - Y(hh) + 8).toFixed(1)}" class="pc-box"/><text x="${(X(i1) + dx * 0.6).toFixed(1)}" y="${(Y(hh) - 7 - 11 * cn++).toFixed(1)}" text-anchor="end" class="pc-t pc-tb">${esc(c.name)}</text>`;
  }
  return s + '</svg>';
}

export function createPatTab({ api, el }) {
  const st = { market: 'tw', tf: '4h', loading: false, progress: '', error: '', loaded: false, results: {}, names: {}, scanned: 0, total: 0, miss: 0, day: '', kind: '', dir: 0, state: '', need: '', page: 1 };

  async function load(force = false) {
    if (st.loading && !st.switching) return;
    const seq = (st.seq = (st.seq || 0) + 1); st.switching = false;
    const mkt = st.market, tf = st.tf, id = mkt === 'tw' ? 'tw' : 'cx_' + tf, stamp = bucket(mkt, tf);
    const c = !force && cacheGet(id, stamp);
    if (c) { Object.assign(st, c, { loaded: true, error: '', progress: '' }); render(); return; }
    st.loading = true; st.error = ''; st.results = {}; st.miss = 0; st.loaded = false; render();
    try {
      let codes, batch;
      if (mkt === 'tw') {
        st.progress = '正在取得台股清單…'; render();
        const tw = await api('/api/twstock');
        const rows = (tw.rows || []).filter((r) => r.volume >= 1000 && r.close >= 10 && /^\d{4}$/.test(r.code)).sort((a, b) => b.volume - a.volume).slice(0, TOP);
        st.names = Object.fromEntries(rows.map((r) => [r.code, r.name])); codes = rows.map((r) => r.code); batch = BATCH;
      } else {
        st.progress = '正在取得幣安永續合約清單…'; render();
        const l = await api('/api/twhist?pat=1&market=crypto&list=1&top=' + CTOP);
        codes = l.symbols || []; st.names = Object.fromEntries(codes.map((x) => [x, ''])); batch = CBATCH;
      }
      st.total = codes.length; st.scanned = 0;
      for (let i = 0; i < codes.length; i += batch) {
        st.progress = `掃描${mkt === 'tw' ? '日線' : tf.toUpperCase()}型態 ${Math.min(i + batch, codes.length)}/${codes.length}…第一次約 1～2 分鐘，之後用快取`; render();
        const q = mkt === 'tw' ? `/api/twhist?pat=1&codes=${codes.slice(i, i + batch).join(',')}` : `/api/twhist?pat=1&market=crypto&tf=${tf}&symbols=${codes.slice(i, i + batch).join(',')}`;
        const j = await api(q);
        if (seq !== st.seq) return; // 中途切換市場：丟掉這次結果
        Object.assign(st.results, j.results); st.miss += (j.miss || []).length; st.scanned = Math.min(i + batch, codes.length);
      }
      st.day = mkt === 'tw' ? stamp : new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' }); st.loaded = true; st.progress = '';
      cacheSet(id, { stamp, results: st.results, names: st.names, scanned: st.scanned, total: st.total, miss: st.miss, day: st.day });
    } catch (e) {
      st.error = `更新失敗：${e.message}`; st.progress = '';
    } finally { if (seq === st.seq) { st.loading = false; render(); } }
  }
  function switchTo(mkt, tf) { st.switching = true; st.market = mkt; st.tf = tf; st.page = 1; st.kind = ''; st.results = {}; st.loaded = false; load(); }

  function list() {
    let cards = [];
    for (const [code, r] of Object.entries(st.results)) if (r && r.items) cards.push(...cardsOf(code, r));
    const total = cards.length;
    cards = cards.filter((c) => {
      if (st.dir && c.it.dir !== st.dir) return false;
      if (st.state && c.it.state !== st.state) return false;
      if (st.kind === 'candle' ? c.it.kind !== 'candle' : !kindMatch(c.it, st.kind)) return false;
      const has = (k) => c.tags.some((t) => t.k === k);
      if (st.need === 'vol' && !has('vol')) return false;
      if (st.need === 'candle' && !has('candle')) return false;
      if (st.need === 'div' && !has('div') && !has('div2')) return false;
      if (st.need === 'div2' && !has('div2')) return false;
      if (st.need === 'any' && !c.tags.length) return false;
      return true;
    });
    const stOrd = { formed: 0, forming: 1, candle: 2 };
    cards.sort((a, b) => b.score - a.score || stOrd[a.it.state] - stOrd[b.it.state] || (a.it.distPct ?? a.it.ago ?? 0) - (b.it.distPct ?? b.it.ago ?? 0));
    return { cards, total };
  }

  function cardHtml(c) {
    const { it, r, code } = c, bull = it.dir > 0;
    const stTxt = it.state === 'formed' ? (it.ago === 0 ? '剛突破' : `${it.ago} 根前${bull ? '突破' : '跌破'}`) : it.state === 'forming' ? `正在形成・距${bull ? '頸線' : '頸線（跌破價）'} ${it.distPct == null ? '—' : it.distPct.toFixed(1) + '%'}` : 'K 棒型態';
    const info = it.state === 'candle' ? '' : `<div class="pc-info muted small">頸線 <b class="num">${px(it.neck)}</b>・停損參考 <b class="num">${px(it.stop)}</b>（${(Math.abs(1 - it.stop / r.close) * 100).toFixed(1)}%）・收盤 <b class="num">${px(r.close)}</b></div>`;
    return `<article class="pc-card">
      <header><div><b class="num">${esc(st.market === 'tw' ? code : code.replace(/USDT$/, ''))}</b> ${esc(st.names[code] || (st.market === 'tw' ? '' : 'USDT 永續・' + st.tf.toUpperCase()))}</div>
        <div class="pc-tags"><span class="pc-k ${bull ? 'up' : 'down'}">${bull ? '偏多' : '偏空'}</span><span class="pc-name">${esc(it.name)}</span><span class="muted small">${esc(stTxt)}</span></div></header>
      ${chart(c)}
      <div class="pc-conf">${c.tags.length ? c.tags.map((t) => `<span class="pc-c ${t.k}">${esc(t.t)}</span>`).join('') : '<span class="muted small">沒有量、K 棒或 MACD 背離確認</span>'}</div>
      ${info}</article>`;
  }

  function render() {
    if (!el.isConnected) return;
    const status = st.error ? `<div class="status err">${esc(st.error)}</div>` : '';
    if (!st.loaded) {
      const o = (v, t) => `<option value="${v}" ${st.market === v ? 'selected' : ''}>${t}</option>`;
      el.innerHTML = `<div class="toolbar"><select id="pat-mkt" class="sort" aria-label="市場">${o('tw', '台股（日線）')}${o('cx', '加密貨幣')}</select>${st.market === 'cx' ? `<select id="pat-tf" class="sort" aria-label="時區">${['4h', '12h', '1d'].map((v) => `<option value="${v}" ${st.tf === v ? 'selected' : ''}>${v === '1d' ? '日線' : v.toUpperCase()}</option>`).join('')}</select>` : ''}<button class="refresh" id="pat-refresh" type="button" ${st.loading ? 'disabled' : ''}>重新掃描</button></div><div class="status">${esc(st.progress || (st.loading ? '準備中…' : ''))}</div>${status}`;
      el.querySelector('#pat-refresh').onclick = () => load(true);
      el.querySelector('#pat-mkt').onchange = (e) => { st.market = e.target.value; switchTo(e.target.value, st.tf); };
      const t0 = el.querySelector('#pat-tf'); if (t0) t0.onchange = (e) => { switchTo('cx', e.target.value); };
      return;
    }
    const { cards, total } = list();
    const sel = (id, val, opts, label) => `<select id="${id}" class="sort" aria-label="${label}">${opts.map(([v, t]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const shown = cards.slice(0, st.page * PAGE);
    el.innerHTML = `
      <div class="toolbar">
        ${sel('pat-mkt', st.market, [['tw', '台股（日線）'], ['cx', '加密貨幣']], '市場')}
        ${st.market === 'cx' ? sel('pat-tf', st.tf, [['4h', '4H'], ['12h', '12H'], ['1d', '日線']], '時區') : ''}
        <div class="status" style="width:auto;flex:1">${st.market === 'tw' ? `掃描成交量前 ${st.total} 檔上市股票（日線）` : `幣安 USDT 永續成交額前 ${st.total} 名（${esc(st.tf.toUpperCase())}）`}・${esc(st.day)}・共 ${total} 張，符合 ${cards.length} 張${st.miss ? `・${st.miss} 檔沒抓到` : ''}${st.loading ? '・' + esc(st.progress) : ''}</div>
        <button class="refresh" id="pat-refresh" type="button" ${st.loading ? 'disabled' : ''}>${st.loading ? '掃描中…' : '重新掃描'}</button></div>
      <div class="toolbar">
        ${sel('pat-dir', st.dir, [[0, '偏多＋偏空'], [1, '只看偏多'], [-1, '只看偏空']], '方向')}
        ${sel('pat-state', st.state, [['', '全部狀態'], ['formed', '已經形成'], ['forming', '正在形成'], ['candle', '只有 K 棒']], '狀態')}
        ${sel('pat-kind', st.kind, [['', '全部型態'], ...KIND_OPTS], '型態')}
        ${sel('pat-need', st.need, [['', '不限確認'], ['any', '至少一項確認'], ['vol', '有量'], ['candle', '有 K 棒型態'], ['div', '有 MACD 背離'], ['div2', '持續背離（連續 2 段以上）']], '確認條件')}
      </div>
      ${status}
      <div class="status err" style="border:1px solid var(--down)">${st.market === 'cx' ? '只供看圖參考：加密貨幣只有 4H 的雙底、收斂三角形、矩形、上升三角形與 12H 雙底通過回測（已在「加密貨幣」頁計分）；其他型態與 K 棒型態都沒有回測，' : ''}台股日線型態回測（約 1,900 檔、2020–2026，扣 0.585%、只做多）沒有任何一個型態通過門檻，K 棒型態也沒有逐一回測，所以這裡<b>不計分、不推播</b>，不要當作進場訊號。排序＝確認越多越前面（有量、同方向 K 棒型態、同方向 MACD 背離、持續背離）。</div>
      <div class="pc-grid">${shown.map(cardHtml).join('') || '<div class="muted small">目前沒有符合的型態。</div>'}</div>
      ${shown.length < cards.length ? `<div style="text-align:center;margin:12px"><button class="refresh" id="pat-more" type="button">再顯示 ${Math.min(PAGE, cards.length - shown.length)} 張（還有 ${cards.length - shown.length} 張）</button></div>` : ''}
      <details class="guide">
        <summary>怎麼判斷的、圖上的線是什麼</summary>
        <dl>
          <dt>圖上畫的</dt><dd>K 棒（綠漲紅跌，跟網站其他頁一致）＋成交量；折線與圓點＝型態的高低轉折點；金色虛線＝頸線（突破／跌破價）；紅色點線＝停損參考；收斂／擴散三角形畫上下兩條趨勢線；三角箭頭＝突破（跌破）那一根；方框＝K 棒型態。</dd>
          <dt>找高低點</dt><dd>用 ATR 之字轉折：價格反向走超過 2～3 倍 ATR 才確認一個高點或低點，反轉後才確認，不會偷看未來。偏空型態是把價格上下翻轉後用同一套偵測。</dd>
          <dt>正在形成／已經形成</dt><dd>型態成形後最多等 15 根日線；收盤站上（跌破）頸線就算突破。「已經形成」只列最近 6 根內突破的。收斂三角形另外用趨勢線擬合（上下線收斂、至少 85% 收盤在兩線內）。</dd>
          <dt>確認</dt><dd>量＝突破（跌破）那天成交量 ≥ 前 20 日均量 ${VOLX} 倍（正在形成則看近 5 日均量 ≥ ${VOL5X} 倍）。K 棒型態＝最近 2 根內、方向相同。MACD 背離＝柱狀體「一段一段的波峰」比較（價格更高／低、柱狀體更低／高），最近 10 根內確認；連續 2 段以上才標「持續」。</dd>
          <dt>限制</dt><dd>只掃成交量前 ${TOP} 檔上市股票；Yahoo 資料偶爾缺漏。偵測邏輯與加密貨幣頁同一套（已和 Python 回測逐根對照）；加密貨幣 4H／12H 有部分型態通過回測，台股日線沒有。</dd>
        </dl>
      </details>`;
    el.querySelector('#pat-refresh').onclick = () => load(true);
    el.querySelector('#pat-mkt').onchange = (e) => switchTo(e.target.value, st.tf);
    const tfs = el.querySelector('#pat-tf'); if (tfs) tfs.onchange = (e) => switchTo('cx', e.target.value);
    const bind = (id, key, num) => { el.querySelector('#' + id).onchange = (e) => { st[key] = num ? +e.target.value : e.target.value; st.page = 1; render(); }; };
    bind('pat-dir', 'dir', true); bind('pat-state', 'state'); bind('pat-kind', 'kind'); bind('pat-need', 'need');
    const more = el.querySelector('#pat-more'); if (more) more.onclick = () => { st.page++; render(); };
  }

  return { load, render, get loaded() { return st.loaded; }, get loading() { return st.loading; } };
}
