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
  const st = { data: null, loading: false, error: '', open: null, scoredOnly: false, sd: null, sLoading: false, sError: '' };

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
    { id: 'fpL', label: 'Delta 階梯・做多', mk: '加密 4H', ref: '回測 +0.20R／筆', f: (x) => x.k === 'fp' && x.dir > 0 },
    { id: 'fpS', label: 'Delta 階梯・做空', mk: '加密 4H', ref: '回測 +0.11R／筆', f: (x) => x.k === 'fp' && x.dir < 0 },
    { id: 'pk', label: '大單推升', mk: '台股上櫃日線', ref: '回測 +2.45%／筆（約 +0.20R）', f: (x) => x.k === 'pk', tw: true },
  ];
  const SST = { open: '持有中', closed: '已結算', pending: '等進場', skipped: '沒進場', invalid: '無效', error: '資料缺' };
  function stratHtml() {
    if (st.sLoading && !st.sd) return '<section class="panel"><strong>主力策略實盤記錄</strong><p class="muted">載入中…</p></section>';
    if (st.sError) return `<section class="panel warn"><strong>主力策略實盤記錄</strong><p>${esc(st.sError)}</p></section>`;
    const items = st.sd?.items || [];
    const rows = SROWS.map((r) => {
      const L = items.filter(r.f), done = L.filter((x) => x.st === 'closed' && x.R != null).sort((a, b) => (a.exitT || a.exitD || '') > (b.exitT || b.exitD || '') ? 1 : -1);
      const n = done.length, mean = n ? done.reduce((a, x) => a + x.R, 0) / n : null;
      const sd = n > 1 ? Math.sqrt(done.reduce((a, x) => a + (x.R - mean) ** 2, 0) / (n - 1)) : null, se = sd != null ? sd / Math.sqrt(n) : null;
      const h = Math.floor(n / 2), m1 = h ? done.slice(0, h).reduce((a, x) => a + x.R, 0) / h : null, m2 = n - h ? done.slice(h).reduce((a, x) => a + x.R, 0) / (n - h) : null;
      const open = L.filter((x) => x.st === 'open'), pend = L.filter((x) => x.st === 'pending').length;
      const pctM = n ? done.reduce((a, x) => a + (x.pct ?? 0), 0) / n : null;
      return { r, total: L.length, n, mean, se, win: n ? done.filter((x) => x.R > 0).length / n : null, m1, m2, open: open.length, pend, pctM, openR: open.length ? open.reduce((a, x) => a + x.R, 0) / open.length : null, skipped: L.filter((x) => x.st === 'skipped').length };
    });
    const tb = rows.map((o) => {
      const v = o.n < SHOW_N ? `<span class="muted">樣本不足（${o.n}/${MIN_N}）</span>` : o.n < MIN_N ? `<span class="muted">樣本偏少（${o.n}/${MIN_N}），還不能判定</span>`
        : (o.mean >= PASS && o.m1 > 0 && o.m2 > 0 ? '<span class="up">實盤仍有效</span>' : o.mean + 1.645 * o.se < PASS ? '<span class="down">不如回測，要檢討</span>' : '<span class="muted">沒達標但區間含回測期望，繼續觀察</span>');
      return `<tr><td>${esc(o.r.label)}<div class="muted">${esc(o.r.mk)}・${esc(o.r.ref)}</div></td><td class="num">${o.total}</td><td class="num">${o.n}</td><td class="num">${o.open}${o.openR != null ? `<span class="muted">（浮動 ${sgn(o.openR)}R）</span>` : ''}</td>
        <td class="num">${o.win == null ? '—' : (o.win * 100).toFixed(0) + '%'}</td><td class="num ${o.mean > 0 ? 'up' : o.mean < 0 ? 'down' : ''}">${o.mean == null ? '—' : sgn(o.mean) + 'R' + (o.r.tw ? `<span class="muted">（${sgn(o.pctM, 1)}%）</span>` : '')}</td>
        <td class="num">${o.se != null ? '±' + (1.645 * o.se).toFixed(2) : '—'}</td><td class="num">${o.m1 == null || o.n < 6 ? '—' : sgn(o.m1) + ' / ' + sgn(o.m2)}</td><td>${v}</td></tr>`;
    }).join('');
    const nm = (x) => x.s.replace(/USDT$|\.TWO$/, '');
    const when = (x) => x.sigT ? new Date(x.sigT).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : `${x.sigD.slice(4, 6)}/${x.sigD.slice(6)}`;
    const lab = (x) => (x.k === 'cs' ? '大陽線突破' : x.k === 'fp' ? 'Delta 階梯' : '大單推升');
    const recent = [...items].sort((a, b) => (b.seen || 0) - (a.seen || 0)).slice(0, 30);
    const rt = recent.map((x) => `<tr><td>${esc(when(x))}</td><td>${esc(nm(x))}</td><td>${lab(x)}${x.k === 'fp' ? (x.dir > 0 ? '・多' : '・空') : ''}</td><td>${SST[x.st] || x.st}</td><td class="num">${x.entry != null ? px(x.entry) : '—'}</td><td class="num ${x.R > 0 ? 'up' : x.R < 0 ? 'down' : ''}">${x.R != null ? sgn(x.R) + 'R' : '—'}</td></tr>`).join('');
    const upd = st.sd?.updated ? new Date(st.sd.updated).toLocaleString('zh-TW', { hour12: false }) : null;
    return `<section class="panel"><div class="panel-head"><strong>主力策略實盤記錄（策略頁那四個）</strong><span class="muted small">${upd ? '最後記錄 ' + esc(upd) : '還沒有記錄'}</span></div>
      <p class="muted small">網站每 15 分鐘掃一次，新成立的訊號只存「策略、代號、訊號 K 棒、停損」；結果由實際 K 線依<b>回測相同規則</b>重播，不能事後改參數。加密每邊手續費 0.1%（比回測保守）；台股來回 0.585%，R＝報酬 ÷ 停損 12%。維加斯通道在下方原本的表格。累積到 ${MIN_N} 筆以上、平均 ≥ +${PASS.toFixed(2)}R、前後半都為正才算實盤驗證過。</p>
      <div style="overflow-x:auto"><table class="tbl" style="width:100%;border-collapse:collapse;font-size:13.5px"><thead><tr><th align="left">策略</th><th>記錄</th><th>已結算</th><th>持有中</th><th>勝率</th><th>平均 R</th><th>90% 誤差</th><th>前／後半</th><th align="left">判斷</th></tr></thead><tbody>${tb}</tbody></table></div>
      <h4 style="margin:12px 0 4px">最近 30 筆</h4>
      <div style="overflow-x:auto"><table class="tbl" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th align="left">訊號</th><th align="left">代號</th><th align="left">策略</th><th>狀態</th><th>進場</th><th>R</th></tr></thead><tbody>${rt || '<tr><td colspan="6" class="muted">還沒有記錄。第一批訊號會在下次排程（約 15 分鐘內）出現；台股要先累積 21 個交易日資料。</td></tr>'}</tbody></table></div></section>`;
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

  function verdict(s, scored) {
    if (s.n < SHOW_N) return `<span class="muted">樣本不足（${s.n}/${MIN_N}）</span>`;
    const lo = s.mean - 1.645 * s.se, hi = s.mean + 1.645 * s.se;
    const rng = `目前平均 ${sgn(s.mean)}R，90% 區間 ${sgn(lo)}～${sgn(hi)}R`;
    if (s.n < MIN_N) return `<span class="muted">樣本偏少（${s.n}/${MIN_N}），${rng}，還不能判定</span>`;
    const ok = s.mean >= PASS && s.first > 0 && s.second > 0;
    if (scored) return ok ? '<span class="up">仍有效</span>' : hi < PASS ? '<span class="down">即時表現不如回測，要檢討</span>' : `<span class="muted">沒達標但區間仍含回測期望（${rng}），繼續觀察</span>`;
    if (ok) return `<span class="up">達標，可考慮計分</span>${lo <= 0 ? '<span class="muted">（區間仍含 0）</span>' : ''}`;
    return hi < PASS ? '<span class="muted">未達標</span>' : `<span class="muted">尚不明確（${rng}）</span>`;
  }

  function render() {
    if (st.loading && !st.data) { el.innerHTML = '<p class="muted">載入中…</p>'; return; }
    const d = st.data, items = d?.items || [];
    const scoredKeys = new Set(Object.keys(STRATS.crypto));
    const groups = {};
    for (const x of items) (groups[x.k + '|' + x.tf] ||= []).push(x);
    const arch = d?.arch || {};
    for (const key of Object.keys(arch)) groups[key] ||= [];
    const rows = Object.entries(groups).map(([g, list]) => {
      const [k, tf] = g.split('|'); const s = stats(list, arch[g]), scored = scoredKeys.has(k);
      return { k, tf, scored, s, label: CRYPTO_SIGNALS[k]?.label || k };
    }).filter((r) => !st.scoredOnly || r.scored)
      .sort((a, b) => (b.k.startsWith('vegas') - a.k.startsWith('vegas')) || (b.s.n - a.s.n));
    const upd = d?.updated ? new Date(d.updated).toLocaleString('zh-TW', { hour12: false }) : null;
    const tbody = rows.map((r) => `<tr data-k="${esc(r.k)}"><td>${esc(r.label)}<div class="muted">${esc(r.k)}・${esc(r.tf)}</div></td>
      <td>${r.scored ? '計分中' : '<b>觀察中</b>'}</td><td class="num">${r.s.total}</td><td class="num">${r.s.n}</td><td class="num">${r.s.live}</td>
      <td class="num">${r.s.win == null ? '—' : (r.s.win * 100).toFixed(0) + '%'}</td>
      <td class="num ${r.s.mean > 0 ? 'up' : r.s.mean < 0 ? 'down' : ''}">${sgn(r.s.mean)}R</td>
      <td class="num">${r.s.se != null ? '±' + (1.645 * r.s.se).toFixed(2) : '—'}</td>
      <td class="num">${r.s.first == null ? '—' : sgn(r.s.first) + ' / ' + sgn(r.s.second)}</td><td>${verdict(r.s, r.scored)}</td></tr>`).join('');
    // 虧損原因表＋停損／止盈假設表
    const lossRows = Object.entries(groups).map(([g, list]) => {
      const L = list.filter((x) => x.st === 'loss'); if (L.length < 3) return null;
      const [k, tf] = g.split('|'), cnt = Object.fromEntries(TAGS.map(([t]) => [t, 0])); let rk = 0, rn = 0;
      for (const x of L) { for (const t of lossTags(x)) cnt[t]++; if (x.recov != null) { rn++; if (x.recov) rk++; } }
      const avg = (f) => { const v = L.map(f).filter((y) => y != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      return { k, tf, n: L.length, cnt, rk, rn, sp: avg((x) => x.sp), mfe: avg((x) => x.mfe) };
    }).filter(Boolean).sort((a, b) => b.n - a.n);
    const pc = (v, n) => (n ? (v / n * 100).toFixed(0) + '%' : '—');
    const lossHtml = lossRows.length ? `<h3 style="margin:18px 0 6px">為什麼虧（每筆停損可以同時有多個原因）</h3>
      <div style="overflow-x:auto"><table class="tbl" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th align="left">策略</th><th>虧損筆數</th>${TAGS.map(([, n]) => `<th>${n}</th>`).join('')}<th>平均停損距離</th><th>停損前平均曾賺</th></tr></thead><tbody>${lossRows.map((r) => `<tr data-k="${esc(r.k)}"><td>${esc(CRYPTO_SIGNALS[r.k]?.label || r.k)}<div class="muted">${esc(r.k)}・${esc(r.tf)}</div></td><td class="num">${r.n}</td>${TAGS.map(([t]) => `<td class="num">${t === 'tight' ? pc(r.rk, r.rn) + (r.rn < r.n ? '<span class="muted">（' + r.rn + '筆已追滿）</span>' : '') : pc(r.cnt[t], r.n)}</td>`).join('')}<td class="num">${r.sp != null ? (r.sp * 100).toFixed(1) + '%' : '—'}</td><td class="num">${r.mfe != null ? r.mfe.toFixed(2) + 'R' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">「停損後又到目標」高 ＝ 方向其實對、停損太近被洗掉；「曾賺 ≥1R 沒止盈」高 ＝ 止盈太遠；「大盤逆向」高 ＝ 受 BTC 影響；「訊號沒走出來」高 ＝ 策略本身的問題。</p>` : '';
    const gItems = items.filter((x) => Array.isArray(x.g) && (!st.open || x.k === st.open));
    let gridHtml = '';
    if (gItems.length) {
      const cell = (i) => { const v = gItems.map((x) => x.g[i]).filter((y) => y != null); return v.length ? { m: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null; };
      gridHtml = `<h3 style="margin:18px 0 6px">如果停損／止盈放別的位置（${st.open ? esc(st.open) : '全部策略合計'}，${gItems.length} 筆，扣費後平均 R）</h3>
        <div style="overflow-x:auto"><table class="tbl" style="border-collapse:collapse;font-size:13px"><thead><tr><th align="left">停損放原本的幾倍距離 ＼ 止盈放新風險的幾倍</th>${GT.map((T) => `<th>${T}R</th>`).join('')}</tr></thead><tbody>${GS.map((sm, a) => `<tr><td>${sm === 1 ? '1 倍（原本）' : sm + ' 倍'}</td>${GT.map((T, b) => { const c = cell(a * GT.length + b); return c ? `<td class="num ${c.m > 0.05 ? 'up' : c.m < -0.05 ? 'down' : ''}">${sgn(c.m)}<span class="muted"> (${c.n})</span></td>` : '<td class="muted">—</td>'; }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted">括號是已經有結果的筆數。這是「事後換設定」的模擬，從同一批訊號挑最好的格子會高估；要採用某個設定，必須再用歷史資料回測、而且新資料要也成立才行。點上面的策略列可以只看那個策略。</p>`;
    }
    const recent = [...items].filter((x) => !st.open || x.k === st.open).sort((a, b) => b.t - a.t).slice(0, 40);
    const trows = recent.map((x) => `<tr><td>${new Date(x.t).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${esc(x.s.replace(/USDT$/, ''))}</td><td>${esc(CRYPTO_SIGNALS[x.k]?.label || x.k)}</td><td>${x.dir > 0 ? '多' : '空'}</td>
      <td class="num">${px(x.fill ?? x.entry)}</td><td class="num">${px(x.stop)}</td><td class="num">${px(x.target)}</td>
      <td>${ST[x.st] || x.st}</td><td class="num ${x.R > 0 ? 'up' : x.R < 0 ? 'down' : ''}">${x.R != null ? sgn(x.R) + 'R' : '—'}</td></tr>`).join('');
    el.innerHTML = `<div class="toolbar">
        <button class="chip" data-f="scored" aria-pressed="${st.scoredOnly}">只看計分中的策略</button>
        ${st.open ? `<button class="chip" data-f="clear" aria-pressed="true">只看 ${esc(st.open)}（點此取消）</button>` : ''}
        <span class="spacer"></span><span class="muted">${upd ? '更新於 ' + esc(upd) : '還沒有資料'}</span>
        <button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '重新整理'}</button></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      ${stratHtml()}
      <p class="muted">每 15 分鐘自動記錄一次網站所有策略「成立」的訊號（含不計分的觀察策略，例如維加斯通道做多／做空），之後追到停損或目標為止，並照回測的規則計算：進場＝掃到訊號當下的價格（掛單類等價格回到掛單價）、來回手續費 0.1%、同一根 K 棒同時碰到停損與目標算停損、最多追 14 天（4H 策略 40 天、12H 與日線策略 60 天，跟回測一致）。R 是扣費後的結果。累積到 ${MIN_N} 筆以上、平均 ≥ +${PASS.toFixed(2)}R、前後半段都為正，才建議把觀察策略改成計分；這是即時（未來）資料，比回測更可信，但需要時間累積。</p>
      <div style="overflow-x:auto"><table class="tbl" style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead><tr><th align="left">策略</th><th>狀態</th><th>記錄</th><th>已結算</th><th>持有中</th><th>勝率</th><th>平均 R</th><th>90% 誤差</th><th>前／後半段</th><th align="left">判斷</th></tr></thead>
        <tbody>${tbody || '<tr><td colspan="10" class="muted">還沒有記錄。排程每 15 分鐘跑一次，過一陣子就會出現。</td></tr>'}</tbody></table></div>
      ${lossHtml}${gridHtml}
      <h3 style="margin:18px 0 6px">最近 40 筆${st.open ? '（' + esc(st.open) + '）' : ''}</h3>
      <div style="overflow-x:auto"><table class="tbl" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr><th align="left">時間</th><th align="left">幣</th><th align="left">策略</th><th>方向</th><th>進場</th><th>停損</th><th>目標</th><th align="left">狀態</th><th>R</th></tr></thead>
        <tbody>${trows || '<tr><td colspan="9" class="muted">沒有資料</td></tr>'}</tbody></table></div>
      <style>.tbl th,.tbl td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}.tbl td:first-child,.tbl td:nth-child(2),.tbl th:first-child{text-align:left}.tbl tbody tr[data-k]{cursor:pointer}</style>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) {
      if (b.dataset.f === 'scored') st.scoredOnly = !st.scoredOnly;
      else if (b.dataset.f === 'clear') st.open = null;
      else if ('reload' in b.dataset) return load();
      return render();
    }
    const tr = e.target.closest('tr[data-k]');
    if (tr) { st.open = st.open === tr.dataset.k ? null : tr.dataset.k; render(); }
  });
  return { load, render, get loaded() { return !!st.data; } };
}
