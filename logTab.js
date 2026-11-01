// 數據記錄分頁：網站所有策略（含不計分的觀察策略）的即時訊號紀錄與追蹤結果（扣手續費後的 R）
import { CRYPTO_SIGNALS } from '/lib/cryptoCore.js';
import { STRATS } from '/lib/categories.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const sgn = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
const ST = { win: '達標', loss: '停損', timeout: '逾時結算', open: '持有中', pending: '等掛單', expired: '掛單沒成交', invalid: '無效' };
const DONE = ['win', 'loss', 'timeout'];
const MIN_N = 30, PASS = 0.10;
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
  const st = { data: null, loading: false, error: '', open: null, scoredOnly: false };

  async function load() {
    st.loading = true; st.error = ''; render();
    try { st.data = await api('/api/log'); } catch (e) { st.error = e.message; }
    st.loading = false; render();
  }

  function stats(list) {
    const done = list.filter((x) => DONE.includes(x.st) && x.R != null);
    const n = done.length, rs = done.map((x) => x.R);
    const mean = n ? rs.reduce((a, b) => a + b, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    const half = Math.floor(n / 2);
    const byT = [...done].sort((a, b) => a.tEnd - b.tEnd);
    const m = (a) => (a.length ? a.reduce((s, x) => s + x.R, 0) / a.length : null);
    return {
      total: list.length, n, mean, se: sd != null ? sd / Math.sqrt(n) : null,
      win: n ? done.filter((x) => x.R > 0).length / n : null,
      first: n >= 6 ? m(byT.slice(0, half)) : null, second: n >= 6 ? m(byT.slice(half)) : null,
      live: list.filter((x) => x.st === 'open' || x.st === 'pending').length,
      skipped: list.filter((x) => x.st === 'expired' || x.st === 'invalid').length,
    };
  }

  function verdict(s, scored) {
    if (s.n < MIN_N) return `<span class="muted">樣本不足（${s.n}/${MIN_N}）</span>`;
    const lo = s.mean - 1.645 * s.se;
    const ok = s.mean >= PASS && s.first > 0 && s.second > 0;
    if (scored) return ok ? '<span class="up">仍有效</span>' : '<span class="down">即時表現不如回測，要檢討</span>';
    return ok ? `<span class="up">達標，可考慮計分</span>${lo <= 0 ? '<span class="muted">（區間仍含 0）</span>' : ''}` : '<span class="muted">未達標</span>';
  }

  function render() {
    if (st.loading && !st.data) { el.innerHTML = '<p class="muted">載入中…</p>'; return; }
    const d = st.data, items = d?.items || [];
    const scoredKeys = new Set(Object.keys(STRATS.crypto));
    const groups = {};
    for (const x of items) (groups[x.k + '|' + x.tf] ||= []).push(x);
    const rows = Object.entries(groups).map(([g, list]) => {
      const [k, tf] = g.split('|'); const s = stats(list), scored = scoredKeys.has(k);
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
