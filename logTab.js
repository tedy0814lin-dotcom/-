// 數據記錄分頁：網站所有策略（含不計分的觀察策略）的即時訊號紀錄與追蹤結果（扣手續費後的 R）
import { CRYPTO_SIGNALS } from '/lib/cryptoCore.js';
import { STRATS } from '/lib/categories.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const sgn = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
const ST = { win: '達標', loss: '停損', timeout: '逾時結算', open: '持有中', pending: '等掛單', expired: '掛單沒成交', invalid: '無效' };
const DONE = ['win', 'loss', 'timeout'];
const MIN_N = 100, SHOW_N = 30, PASS = 0.10; // 實盤紀錄一筆賺賠的標準差約 1.5～2R，30 筆的平均誤差就有 ±0.3R，所以滿 100 筆才下結論
const GS = [1, 1.5, 2], GT = [1, 2, 3, 4, 6]; // 要跟 scripts/log.mjs 一樣
// 虧損原因（一筆可以有多個）：mkt 進場到出場 BTC 往不利方向走 ≥1%；tight 停損後 14 天內又走到原目標（停損太近）；wick 1 小時內就被停損；
// far 結算前曾賺到 ≥1R 卻沒到目標（止盈太遠）；fee 停損距離 <0.5%（手續費佔比大）；none 以上都不是且最多只賺到 0.5R（訊號本身沒走出來）
const TAGS = [['mkt', '大盤逆向'], ['tight', '停損後又到目標'], ['wick', '1 小時內被停損'], ['far', '曾賺 ≥1R 沒止盈'], ['fee', '停損不到 0.5%'], ['none', '訊號沒走出來']];
function lossTags(x) {
  const t = [];
  if (x.btc != null && x.btc * x.dir <= -1) t.push('mkt');
  if (x.recov === true) t.push('tight');
  if (x.eb != null && x.eb <= 4) t.push('wick');
  if (x.mfe != null && x.mfe >= 1) t.push('far');
  if (x.sp != null && x.sp < 0.005) t.push('fee');
  if (!t.includes('mkt') && !t.includes('tight') && !t.includes('far') && (x.mfe ?? 0) < 0.5) t.push('none');
  return t;
}

export function createLogTab({ api, el }) {
  const st = { data: null, loading: false, error: '', open: null, scoredOnly: false, filter: 'all', more: false, adv: false, how: false, sd: null, sLoading: false, sError: '' };

  async function load() {
    st.loading = true; st.error = ''; render();
    try { st.data = await api('/api/log'); } catch (e) { st.error = e.message; }
    st.loading = false; render();
    loadStrat();
  }
  async function loadStrat() {
    st.sLoading = true; st.sError = ''; render();
    try { st.sd = await api('/api/log?strat=1'); } catch (e) { st.sError = e.message; }
    st.sLoading = false; render();
  }
  // 主力策略（上線在「策略」頁的）實盤記錄：只存訊號，結果用實際 K 線依回測規則重播
  const SROWS = [
    { id: 'cs', label: '大陽線突破新高', mk: '加密日線・多', ref: '回測年化 +49%、勝率 24%（賺大賠小）', f: (x) => x.k === 'cs', cur: '$' },
    { id: 'fpL', label: 'Delta 階梯・做多', mk: '加密 4H', ref: '回測 +0.26R／筆（4R 目標）', f: (x) => x.k === 'fp' && x.dir > 0 },
    { id: 'fpS', label: 'Delta 階梯・做空', mk: '加密 4H', ref: '回測 +0.13R／筆（4R 目標）', f: (x) => x.k === 'fp' && x.dir < 0 },
    { id: 'pk', label: '大單推升', mk: '台股上櫃日線', ref: '回測 +2.45%／筆（約 +0.20R）', f: (x) => x.k === 'pk', tw: true },
  ];
  const SST = { open: '持有中', closed: '已結算', pending: '等進場', skipped: '沒進場', invalid: '無效', error: '資料缺' };
  const pct = (v, d = 0) => (v == null ? '—' : (v * 100).toFixed(d) + '%');
  const fmtT = (t) => new Date(t).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  // 白話狀態：{cls, txt, hint}
  function status(s, scored, ok2) {
    if (s.n < SHOW_N) return { cls: 'lg-s-wait', txt: '累積資料中', hint: `還差 ${MIN_N - s.n} 筆才能判定` };
    const lo = s.mean - 1.645 * s.se, hi = s.mean + 1.645 * s.se;
    if (s.n < MIN_N) return { cls: 'lg-s-wait', txt: '驗證中（樣本還少）', hint: `還差 ${MIN_N - s.n} 筆；目前平均可能落在 ${sgn(lo)}～${sgn(hi)}R` };
    const ok = s.mean >= PASS && s.first > 0 && s.second > 0;
    if (ok) return { cls: 'lg-s-ok', txt: scored ? '實盤仍有效' : '達標，可考慮計分', hint: lo <= 0 ? '但誤差區間仍含 0' : '' };
    if (hi < PASS) return { cls: 'lg-s-bad', txt: '不如預期', hint: scored ? '即時表現低於回測，要檢討' : '未達標' };
    return { cls: 'lg-s-wait', txt: '持續觀察', hint: `沒達標，但區間仍含回測期望（${sgn(lo)}～${sgn(hi)}R）` };
  }
  const meanHtml = (m, tw, pctM) => (m == null ? '<span class="lg-big muted">—</span>' : `<span class="lg-big num ${m > 0 ? 'up' : m < 0 ? 'down' : ''}">${sgn(m)}R</span>${tw && pctM != null ? `<span class="muted small"> （${sgn(pctM, 1)}%）</span>` : ''}`);
  const prog = (n) => `<div class="lg-prog" role="img" aria-label="已結算 ${n} 筆，目標 ${MIN_N} 筆"><i style="width:${Math.min(100, n / MIN_N * 100).toFixed(0)}%"></i></div>`;

  // 主力策略（策略頁那四個）
  function mainRows() {
    const items = st.sd?.items || [];
    return SROWS.map((r) => {
      const L = items.filter(r.f), done = L.filter((x) => x.st === 'closed' && x.R != null).sort((a, b) => (a.exitT || a.exitD || '') > (b.exitT || b.exitD || '') ? 1 : -1);
      const n = done.length, mean = n ? done.reduce((a, x) => a + x.R, 0) / n : null;
      const sd = n > 1 ? Math.sqrt(done.reduce((a, x) => a + (x.R - mean) ** 2, 0) / (n - 1)) : null, se = sd != null ? sd / Math.sqrt(n) : null;
      const h = Math.floor(n / 2), m1 = h ? done.slice(0, h).reduce((a, x) => a + x.R, 0) / h : null, m2 = n - h ? done.slice(h).reduce((a, x) => a + x.R, 0) / (n - h) : null;
      const open = L.filter((x) => x.st === 'open'), pend = L.filter((x) => x.st === 'pending').length;
      const pctM = n ? done.reduce((a, x) => a + (x.pct ?? 0), 0) / n : null;
      return { r, total: L.length, n, mean, se, win: n ? done.filter((x) => x.R > 0).length / n : null, first: n >= 6 ? m1 : null, second: n >= 6 ? m2 : null, live: open.length, pend, pctM, openR: open.length ? open.reduce((a, x) => a + x.R, 0) / open.length : null };
    });
  }
  function mainHtml() {
    if (st.sLoading && !st.sd) return '<p class="muted">主力策略載入中…</p>';
    if (st.sError) return `<div class="panel warn">主力策略記錄讀取失敗：${esc(st.sError)}</div>`;
    return `<div class="lg-grid">${mainRows().map((o) => {
      const s = status(o, true), tw = o.r.tw;
      return `<article class="lg-card">
        <header><b>${esc(o.r.label)}</b><span class="lg-tag">${esc(o.r.mk)}</span></header>
        <div class="lg-badge ${s.cls}">${s.txt}</div>
        <div class="lg-mean">${meanHtml(o.mean, tw, o.pctM)}<div class="muted small">每筆平均（扣費後）</div></div>
        ${prog(o.n)}<div class="muted small">已結算 <b class="num">${o.n}</b> / ${MIN_N} 筆${s.hint ? '・' + esc(s.hint) : ''}</div>
        <dl class="lg-kv">
          <div><dt>勝率</dt><dd class="num">${pct(o.win)}</dd></div>
          <div><dt>持有中</dt><dd class="num">${o.live}${o.pend ? `<span class="muted small">＋${o.pend} 等進場</span>` : ''}</dd></div>
          <div><dt>前／後半</dt><dd class="num">${o.first == null ? '—' : sgn(o.first, 1) + ' / ' + sgn(o.second, 1)}</dd></div>
        </dl>
        <div class="lg-ref muted small">回測參考：${esc(o.r.ref)}</div>
      </article>`;
    }).join('')}</div>`;
  }

  function stats(list, ab) {
    const done = list.filter((x) => DONE.includes(x.st) && x.R != null);
    // 近 180 天的明細＋更早的月彙總（記錄不設上限，舊的只留 n／賺的筆數／R 總和／R 平方和）
    const units = done.map((x) => ({ t: x.tEnd || x.t, n: 1, s: x.R, q: x.R * x.R, w: x.R > 0 ? 1 : 0 }));
    for (const [mo, bk] of Object.entries(ab || {})) units.push({ t: Date.parse(mo + '-15'), n: bk.n, s: bk.s, q: bk.q, w: bk.w });
    units.sort((a, b) => a.t - b.t);
    const sum = (f) => units.reduce((a, u) => a + u[f], 0);
    const n = sum('n'), S = sum('s'), Q = sum('q'), W = sum('w');
    const mean = n ? S / n : null;
    const sd = n > 1 ? Math.sqrt(Math.max(0, (Q - n * mean * mean) / (n - 1))) : null;
    let acc = 0, fs = 0; const target = n / 2;
    for (const u of units) { if (acc >= target) break; const take = Math.min(u.n, target - acc); fs += u.s * (take / u.n); acc += take; }
    return {
      total: list.length + Object.values(ab || {}).reduce((a, bk) => a + bk.n, 0), n, mean, se: sd != null ? sd / Math.sqrt(n) : null,
      win: n ? W / n : null,
      first: n >= 6 ? fs / acc : null, second: n >= 6 ? (S - fs) / (n - acc) : null,
      live: list.filter((x) => x.st === 'open' || x.st === 'pending').length,
      skipped: list.filter((x) => x.st === 'expired' || x.st === 'invalid').length,
    };
  }

  function render() {
    if (st.loading && !st.data) { el.innerHTML = '<p class="muted">載入中…</p>'; return; }
    const d = st.data, items = d?.items || [], mItems = st.sd?.items || [];
    const scoredKeys = new Set(Object.keys(STRATS.crypto));
    const groups = {};
    for (const x of items) (groups[x.k + '|' + x.tf] ||= []).push(x);
    const arch = d?.arch || {};
    for (const key of Object.keys(arch)) groups[key] ||= [];
    const rows = Object.entries(groups).map(([g, list]) => {
      const [k, tf] = g.split('|'); const s = stats(list, arch[g]), scored = scoredKeys.has(k);
      return { k, tf, scored, s, label: CRYPTO_SIGNALS[k]?.label || k };
    }).filter((r) => st.filter === 'all' || (st.filter === 'scored' ? r.scored : !r.scored))
      .sort((a, b) => (b.k.startsWith('vegas') - a.k.startsWith('vegas')) || (b.s.n - a.s.n));
    const upd = d?.updated ? new Date(d.updated).toLocaleString('zh-TW', { hour12: false }) : null;
    // 總覽數字
    const allRows = Object.entries(groups).map(([g, list]) => stats(list, arch[g]));
    const mR = mItems.length ? mainRows() : [];
    const kpi = [
      ['總記錄', allRows.reduce((a, s) => a + s.total, 0) + mItems.length],
      ['已結算', allRows.reduce((a, s) => a + s.n, 0) + mR.reduce((a, o) => a + o.n, 0)],
      ['持有中', allRows.reduce((a, s) => a + s.live, 0) + mR.reduce((a, o) => a + o.live, 0)],
    ];
    // 其他策略：精簡列
    const list = rows.map((r) => {
      const s = status(r.s, r.scored);
      return `<div class="lg-row${st.open === r.k ? ' on' : ''}" data-k="${esc(r.k)}" role="button" tabindex="0">
        <div class="lg-r-name"><b>${esc(r.label)}</b><span class="muted small">${esc(r.k)}・${esc(r.tf)}</span></div>
        <span class="lg-tag ${r.scored ? 'lg-tag-on' : ''}">${r.scored ? '計分中' : '觀察中'}</span>
        <div class="lg-r-mean">${meanHtml(r.s.mean)}</div>
        <div class="lg-r-prog">${prog(r.s.n)}<span class="muted small">${r.s.n}/${MIN_N} 筆・勝率 ${pct(r.s.win)}・持有 ${r.s.live}</span></div>
        <div class="lg-badge ${s.cls}">${s.txt}</div></div>`;
    }).join('');
    // 最近訊號（兩邊合併）
    const feed = [
      ...items.filter((x) => !st.open || x.k === st.open).map((x) => ({ ts: x.t, sym: x.s.replace(/USDT$/, ''), lab: CRYPTO_SIGNALS[x.k]?.label || x.k, dir: x.dir, st: ST[x.st] || x.st, R: x.R })),
      ...(!st.open ? mItems.map((x) => ({ ts: x.seen, sym: x.s.replace(/USDT$|\.TWO$/, ''), lab: x.k === 'cs' ? '大陽線突破' : x.k === 'fp' ? 'Delta 階梯' : '大單推升', dir: x.k === 'pk' ? 1 : x.dir, st: SST[x.st] || x.st, R: x.R })) : []),
    ].sort((a, b) => b.ts - a.ts);
    const shown = feed.slice(0, st.more ? 60 : 12);
    const feedHtml = shown.length ? shown.map((f) => `<div class="lg-feed"><span class="muted small num">${fmtT(f.ts)}</span><b>${esc(f.sym)}</b><span class="lg-f-lab">${esc(f.lab)}</span>
      <span class="lg-dir ${f.dir > 0 ? 'up' : 'down'}">${f.dir > 0 ? '做多' : '做空'}</span><span class="lg-st">${esc(f.st)}</span>
      <span class="num ${f.R > 0 ? 'up' : f.R < 0 ? 'down' : 'muted'}">${f.R != null ? sgn(f.R) + 'R' : '—'}</span></div>`).join('')
      + (feed.length > 12 ? `<button class="ghost" data-f="more">${st.more ? '收合' : `看更多（共 ${feed.length} 筆，顯示 60）`}</button>` : '') : '<p class="muted">還沒有記錄。</p>';
    // 進階：虧損原因＋停損止盈假設
    const lossRows = Object.entries(groups).map(([g, l]) => {
      const L = l.filter((x) => x.st === 'loss'); if (L.length < 3) return null;
      const [k, tf] = g.split('|'), cnt = Object.fromEntries(TAGS.map(([t]) => [t, 0])); let rk = 0, rn = 0;
      for (const x of L) { for (const t of lossTags(x)) cnt[t]++; if (x.recov != null) { rn++; if (x.recov) rk++; } }
      const avg = (f) => { const v = L.map(f).filter((y) => y != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      return { k, tf, n: L.length, cnt, rk, rn, sp: avg((x) => x.sp), mfe: avg((x) => x.mfe) };
    }).filter(Boolean).sort((a, b) => b.n - a.n);
    const pc = (v, n) => (n ? (v / n * 100).toFixed(0) + '%' : '—');
    const lossHtml = lossRows.length ? `<h3 style="margin:18px 0 6px">為什麼虧（每筆停損可以同時有多個原因）</h3>
      <div style="overflow-x:auto"><table class="tbl" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th align="left">策略</th><th>虧損筆數</th>${TAGS.map(([, n]) => `<th>${n}</th>`).join('')}<th>平均停損距離</th><th>停損前平均曾賺</th></tr></thead><tbody>${lossRows.map((r) => `<tr data-k="${esc(r.k)}"><td>${esc(CRYPTO_SIGNALS[r.k]?.label || r.k)}<div class="muted">${esc(r.k)}・${esc(r.tf)}</div></td><td class="num">${r.n}</td>${TAGS.map(([t]) => `<td class="num">${t === 'tight' ? (r.rn < 10 ? '<span class="muted">樣本不足</span>' : pc(r.rk, r.rn)) + '<div class="muted small">' + r.rk + '/' + r.rn + ' 筆有追蹤（共虧 ' + r.n + '）</div>' : pc(r.cnt[t], r.n)}</td>`).join('')}<td class="num">${r.sp != null ? (r.sp * 100).toFixed(1) + '%' : '—'}</td><td class="num">${r.mfe != null ? r.mfe.toFixed(2) + 'R' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">「停損後又到目標」高 ＝ 方向其實對、停損太近被洗掉；「曾賺 ≥1R 沒止盈」高 ＝ 止盈太遠；「大盤逆向」高 ＝ 受 BTC 影響；「訊號沒走出來」高 ＝ 策略本身的問題。</p>` : '';
    const gItems = items.filter((x) => Array.isArray(x.g) && (!st.open || x.k === st.open));
    let gridHtml = '';
    if (gItems.length) {
      const cell = (i) => { const v = gItems.map((x) => x.g[i]).filter((y) => y != null); return v.length ? { m: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null; };
      gridHtml = `<h3 style="margin:18px 0 6px">如果停損／止盈放別的位置（${st.open ? esc(st.open) : '全部策略合計'}，${gItems.length} 筆，扣費後平均 R）</h3>
        <div style="overflow-x:auto"><table class="tbl" style="border-collapse:collapse;font-size:13px"><thead><tr><th align="left">停損放原本的幾倍距離 ＼ 止盈放新風險的幾倍</th>${GT.map((T) => `<th>${T}R</th>`).join('')}</tr></thead><tbody>${GS.map((sm, a) => `<tr><td>${sm === 1 ? '1 倍（原本）' : sm + ' 倍'}</td>${GT.map((T, b) => { const c = cell(a * GT.length + b); return c ? `<td class="num ${c.m > 0.05 ? 'up' : c.m < -0.05 ? 'down' : ''}">${sgn(c.m)}<span class="muted"> (${c.n})</span></td>` : '<td class="muted">—</td>'; }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted">括號是已經有結果的筆數。這是「事後換設定」的模擬，從同一批訊號挑最好的格子會高估；要採用某個設定，必須再用歷史資料回測、而且新資料要也成立才行。點上面的策略列可以只看那個策略。</p>`;
    }
    el.innerHTML = `<div class="lg-top"><div><h2 class="lg-h">數據記錄</h2><p class="muted small">網站每 15 分鐘自動記下新成立的訊號，之後追到停損／目標，用回測相同規則算扣費後的結果。這是「未來」的真實資料，比回測更可信，但要累積到 ${MIN_N} 筆才下結論。</p></div>
        <div class="lg-top-r"><span class="muted small">${upd ? '更新於 ' + esc(upd) : '還沒有資料'}</span><button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '重新整理'}</button></div></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      <div class="lg-kpis">${kpi.map(([k, v]) => `<div class="lg-kpi"><div class="muted small">${k}</div><div class="lg-kv-big num">${v}</div></div>`).join('')}</div>
      <h3 class="lg-sec">主力策略 <span class="muted small">策略頁那四個，各自累積實盤成績</span></h3>
      ${mainHtml()}
      <h3 class="lg-sec">其他策略 <span class="muted small">點一列可只看該策略的訊號與進階分析</span></h3>
      <div class="toolbar">${[['all', '全部'], ['scored', '計分中'], ['watch', '觀察中']].map(([k, n]) => `<button class="chip" data-f="${k}" aria-pressed="${st.filter === k}">${n}</button>`).join('')}
        ${st.open ? `<button class="chip" data-f="clear" aria-pressed="true">只看 ${esc(st.open)}（取消）</button>` : ''}</div>
      <div class="lg-rows">${list || '<p class="muted">還沒有記錄。</p>'}</div>
      <h3 class="lg-sec">最近訊號${st.open ? ' · ' + esc(st.open) : ''}</h3>
      <div class="lg-feeds">${feedHtml}</div>
      <details class="lg-det" data-d="adv"${st.adv ? ' open' : ''}><summary>進階分析（為什麼虧、停損／止盈放別處會怎樣）</summary><div style="overflow-x:auto">${lossHtml}${gridHtml || '<p class="muted">資料還不夠。</p>'}</div></details>
      <details class="lg-det" data-d="how"${st.how ? ' open' : ''}><summary>怎麼記錄、怎麼判斷</summary>
        <p class="muted small">記錄：新成立的訊號才會記（含不計分的觀察策略）。加密策略進場＝掃到訊號當下的價格（掛單類等價格回到掛單價），來回手續費 0.1%，同一根 K 棒同時碰到停損與目標算停損，最多追 14 天（4H 策略 40 天、12H 與日線 60 天，與回測一致）。主力策略只存訊號，結果用實際 K 線依回測規則重播，不能事後改參數；台股來回成本 0.585%，R＝報酬 ÷ 停損 12%。</p>
        <p class="muted small">判斷：平均 ≥ +0.10R、前後半段都為正、且滿 ${MIN_N} 筆才算實盤驗證；觀察策略達標才建議改成計分。單筆賺賠標準差約 1.5～2R，30 筆的誤差就有 ±0.3R，所以樣本少時不要下結論。維加斯通道做多／做空屬於觀察策略。</p></details>`;
  }

  el.addEventListener('toggle', (e) => { const d = e.target.dataset?.d; if (d) st[d] = e.target.open; }, true);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) {
      const f = b.dataset.f;
      if (f === 'all' || f === 'scored' || f === 'watch') st.filter = f;
      else if (f === 'clear') st.open = null;
      else if (f === 'more') st.more = !st.more;
      else if ('reload' in b.dataset) return load();
      return render();
    }
    const tr = e.target.closest('[data-k]');
    if (tr) { st.open = st.open === tr.dataset.k ? null : tr.dataset.k; render(); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const tr = e.target.closest('.lg-row'); if (tr) { e.preventDefault(); tr.click(); } } });
  return { load, render, get loaded() { return !!st.data; } };
}
