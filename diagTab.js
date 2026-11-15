// 診斷頁（階段 1：台股持股診斷）。輸入代號、股數、成本價（成本可留空）→ 顯示弱勢／強勢旗標、趨勢分數百分位、
// 三因子分數（來自策略頁名單，前 300 大才有）、同條件股票的歷史機率，以及三種做法（換強勢股／買 0050／續抱）的歷史統計。
// 只描述歷史統計，不給買賣指令；成本價只用來算損益與回本幅度。持股只存在你的瀏覽器，可匯出備份。規格：專案文件《持股診斷頁規格》。
import { FLAG_TEXT, rowObj, diagnose, summarize, statRow, baseRow, upsertHolding, exportHoldings, parseHoldings, ACTION_STATS } from '/lib/diagHold.js';
import { DIAG_STATS } from '/lib/diagStats.js';

const LSK = 'wr_diag_v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = (v) => v != null && Number.isFinite(v);
const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString('en-US') : '—');
const px = (v) => (!ok(v) ? '—' : v >= 100 ? v.toFixed(1) : v.toFixed(2));
const pc = (v, d = 1) => (!ok(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const pn = (v, d = 1) => (!ok(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%'); // 已是百分數
const cls = (v) => (!ok(v) ? '' : v >= 0 ? 'up' : 'down');
const WEAK_ORDER = ['A', 'B', 'C', 'D'];

export function createDiagTab({ api, el }) {
  const S = { loading: false, error: '', data: null, s6: null, holdings: [], msg: '', msgBad: false, storeOk: true, openStats: false, openAct: false };
  try { const raw = localStorage.getItem(LSK); if (raw) { const r = parseHoldings(raw); if (r.list) S.holdings = r.list; } } catch { /* 無痕模式或被封鎖：頁面照常運作，只是不保存 */ }
  const save = () => { try { localStorage.setItem(LSK, JSON.stringify({ v: 1, kind: 'wr_diag', holdings: S.holdings })); S.storeOk = true; } catch { S.storeOk = false; } };
  el.addEventListener('toggle', (e) => { const t = e.target; if (t.matches?.('details[data-k]')) S[t.dataset.k] = t.open; }, true);

  async function load() {
    if (S.loading) return;
    S.loading = true; S.error = ''; render();
    try {
      S.data = await api('/api/diag');
      try { S.s6 = await api('/api/s6u'); } catch { S.s6 = null; } // 三因子名單讀不到不影響旗標診斷
    } catch (e) { S.error = e.message || String(e); }
    finally { S.loading = false; render(); }
  }
  const rowOf = (code) => (S.data?.rows?.[code] ? rowObj(S.data.rows[code], S.data.cols) : null);
  const s6Of = (code) => S.s6?.list?.find((x) => x.code === code) || null;
  const results = () => S.holdings.map((h) => diagnose(h, rowOf(h.code), s6Of(h.code)));

  function say(msg, bad) { S.msg = msg; S.msgBad = !!bad; }

  // ---------- 畫面 ----------
  const flagChips = (r) => {
    const out = WEAK_ORDER.filter((k) => r.flags[k]).map((k) => `<span class="dg-flag weak" title="${esc(FLAG_TEXT[k].rule)}">${FLAG_TEXT[k].name}</span>`);
    if (r.flags.S) out.push(`<span class="dg-flag strong" title="${esc(FLAG_TEXT.S.rule)}">${FLAG_TEXT.S.name}</span>`);
    return out.length ? out.join('') : '<span class="dg-flag none" title="沒有觸發任何弱勢旗標，也不在趨勢分數前 20%">中性</span>';
  };
  function histRows(r) {
    const base = baseRow(3), out = [];
    const keys = WEAK_ORDER.filter((k) => r.flags[k]); if (r.flags.S) keys.push('S');
    for (const k of keys) {
      const s = statRow(k, 3); if (!s) continue;
      out.push(`<div class="dg-hist"><div><b>${FLAG_TEXT[k].name}</b><span class="muted small"> 過去同條件的股票，之後 3 個月</span></div><dl>
        <dt>相對全體平均</dt><dd><b class="num ${cls(s.ex)}">${pn(s.ex, 2)}</b><span class="muted small">（95% 區間 ${s.lo.toFixed(1)}～${s.hi.toFixed(1)}）</span></dd>
        <dt>續弱／震盪／轉強</dt><dd><b class="num">${s.pWeak}%／${s.pMid}%／${s.pStrong}%</b><span class="muted small">（全體 ${base.pWeak}%／${base.pMid}%／${base.pStrong}%）</span></dd>
        <dt>上漲機率</dt><dd><b class="num">${s.pUp}%</b><span class="muted small">（全體 ${base.pUp}%）</span></dd>
        <dt>2026 年驗證</dt><dd>${s.val ? `<b class="num ${cls(s.val.ex)}">${pn(s.val.ex, 1)}</b><span class="muted small">（${s.val.months} 個訊號月，只當觀察）</span>` : '—'}</dd></dl></div>`);
    }
    return out.join('');
  }
  function s6Block(r) {
    if (!r.s6) return `<div class="dg-note muted">三因子分數：這檔不在策略頁的名單內（名單只涵蓋成交值前 300 大的上市股），所以只顯示趨勢旗標。</div>`;
    const t = r.s6;
    return `<div class="dg-s6"><span class="muted">三因子分數（名單內百分位，越高越好）</span><span>價值 <b class="num">${n0(t.value * 100)}</b></span><span>低波動 <b class="num">${n0(t.lowvol * 100)}</b></span><span>趨勢 <b class="num">${n0(t.trend * 100)}</b></span>${t.rank ? `<span class="muted">保守版排名第 ${t.rank}</span>` : ''}</div>`;
  }
  function card(r, w) {
    const title = `<div class="dg-head"><b>${esc(r.code)} ${esc(r.name)}</b><button type="button" class="dg-x" data-del="${esc(r.code)}" aria-label="刪除 ${esc(r.code)}">移除</button></div>`;
    if (r.status === 'notfound') return `<section class="panel dg-card">${title}<div class="dg-note bad">資料裡找不到 ${esc(r.code)}（可能是興櫃、ETF、剛上市，或代號打錯）。目前只支援上市櫃的一般個股。</div></section>`;
    const money = `<div class="dg-grid"><div><span class="muted">現價</span><b class="num">${px(r.px)}</b></div>${r.shares ? `<div><span class="muted">股數</span><b class="num">${n0(r.shares)}</b></div><div><span class="muted">市值</span><b class="num">${n0(r.value)}</b>${w != null ? `<span class="muted small"> 占 ${(w * 100).toFixed(0)}%</span>` : ''}</div>` : ''}${r.cost != null ? `<div><span class="muted">成本</span><b class="num">${px(r.cost)}</b></div><div><span class="muted">損益</span><b class="num ${cls(r.pnl)}">${pc(r.pnl)}</b></div>${r.needGain > 0 ? `<div><span class="muted">回到成本需漲</span><b class="num">${pc(r.needGain)}</b></div>` : ''}` : ''}</div>`;
    const liq = r.liqLow ? `<div class="dg-note warn">近 20 日平均成交量只有 ${n0(r.v20)} 張，流動性偏低，實際成交價可能與現價有落差，歷史統計也不一定適用。</div>` : '';
    if (r.status === 'outside') return `<section class="panel dg-card">${title}${money}<div class="dg-note muted">這檔股價低於 10 元或上市時間不足，不在歷史統計的母體內，不顯示旗標與機率。</div>${liq}</section>`;
    const v = r.vals;
    const detail = `<div class="dg-grid small"><div><span class="muted">200 日均線</span><b class="num">${px(v.ma200)}</b><span class="${cls(v.px / v.ma200 - 1)} small"> ${pc(v.px / v.ma200 - 1)}</span></div><div><span class="muted">250 日高點</span><b class="num">${px(v.hi250)}</b><span class="down small"> ${pc(v.near - 1)}</span></div><div><span class="muted">6-1 動能</span><b class="num ${cls(v.mom)}">${pc(v.mom)}</b></div><div><span class="muted">趨勢分數</span><b class="num">前 ${Math.max(1, Math.round((1 - r.tPct) * 100))}%</b></div></div>`;
    const mixed = r.flags.A && r.flags.S ? '<div class="dg-note muted">同時出現弱 A 與強勢，代表各指標互相矛盾，歷史統計不適用，請看個別指標。</div>' : '';
    return `<section class="panel dg-card">${title}<div class="dg-flags">${flagChips(r)}</div>${money}${detail}${s6Block(r)}${mixed}${histRows(r)}${liq}</section>`;
  }
  function summaryBlock(rs, sm) {
    const valid = rs.filter((r) => r.status === 'ok');
    if (rs.length < 2 && !sm.warns.length) return '';
    const lines = [];
    if (sm.weakShare != null && sm.total > 0) lines.push(`組合市值中，觸發弱 A 的占 <b class="num">${(sm.weakShare * 100).toFixed(0)}%</b>、強勢的占 <b class="num">${(sm.strongShare * 100).toFixed(0)}%</b>。`);
    if (valid.length) lines.push(`${valid.length} 檔有旗標資料，其中弱 A ${valid.filter((r) => r.flags.A).length} 檔、強勢 ${valid.filter((r) => r.flags.S).length} 檔。`);
    return `<section class="panel"><h4>組合摘要</h4>${lines.map((x) => `<div>${x}</div>`).join('')}${sm.warns.map((x) => `<div class="dg-note warn">${esc(x)}</div>`).join('')}</section>`;
  }
  function actionBlock() {
    const a = ACTION_STATS, b = a.weakVs0050.bt, v = a.weakVs0050.val, s = a.s6u;
    return `<details class="fold" data-k="openAct" ${S.openAct ? 'open' : ''}><summary><b>三種做法的歷史統計</b><span class="muted small">換強勢股、買 0050、續抱（點開展開）</span></summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>做法（弱 A 股票出現後 3 個月）</th><th class="n">回測 ${b.months} 個月</th><th class="n">2026 驗證 ${v.months} 個月</th></tr></thead><tbody>
      <tr><td>續抱弱 A 股票，相對 0050</td><td class="n ${cls(b.diff)}">${pn(b.diff, 2)}（區間 ${b.lo.toFixed(1)}～${b.hi.toFixed(1)}）</td><td class="n ${cls(v.diff)}">${pn(v.diff, 1)}</td></tr>
      <tr><td>其中輸給 0050 的月份比例</td><td class="n">${b.losePct}%</td><td class="n">${v.losePct}%</td></tr>
      <tr><td>改持有 0050，比續抱多賺（已扣換股成本）</td><td class="n ${cls(b.swap0050)}">${pn(b.swap0050, 2)}</td><td class="n ${cls(v.swap0050)}">${pn(v.swap0050, 1)}</td></tr>
      <tr><td>改持有趨勢分數前 20 名，比續抱多賺（已扣成本）</td><td class="n ${cls(b.swapTop20)}">${pn(b.swapTop20, 2)}</td><td class="n ${cls(v.swapTop20)}">${pn(v.swapTop20, 1)}</td></tr></tbody></table></div>
      <ul class="s6-ul"><li>${esc(a.strongTop20vs0050)}</li>
      <li>三因子策略（策略頁）：年化 保守 ${s.bt.base.cagr}%／平衡 ${s.bt.bal.cagr}%／平衡含濾網 ${s.bt.balF.cagr}%，0050 ${s.bt.etf.cagr}%；最大回撤 ${s.bt.base.mdd}%／${s.bt.bal.mdd}%／${s.bt.balF.mdd}%，0050 ${s.bt.etf.mdd}%。2026 年前 ${s.y2026.months} 個月：${s.y2026.base}%／${s.y2026.bal}%／${s.y2026.balF}%，0050 ${s.y2026.etf}%。${esc(s.note)}</li>
      <li>${esc(s.alpha)}。</li></ul>
      <div class="muted small">資料來源：${esc(a.source)}。這些都是過去的統計，只能說明「過去同樣情況下平均發生什麼」，不能保證你這一檔會怎樣；你的成本價不會改變這些統計。</div></details>`;
  }
  function statsBlock() {
    const bt = DIAG_STATS.bt, vl = DIAG_STATS.val;
    return `<details class="fold" data-k="openStats" ${S.openStats ? 'open' : ''}><summary><b>旗標怎麼定義、統計怎麼算</b><span class="muted small">（點開展開）</span></summary><ul class="s6-ul">
      ${['A', 'B', 'C', 'D', 'S'].map((k) => `<li><b>${FLAG_TEXT[k].name}</b>：${esc(FLAG_TEXT[k].rule)}。</li>`).join('')}
      <li>趨勢分數＝6-1 動能、距 250 日高點的接近度、相對 200 日線的幅度，三者在全體股票中的百分位平均。全體＝上市櫃股價 ≥ 10 元、有成交的個股。</li>
      <li>統計方式：每個月底找出符合旗標的股票，看之後 3 個月的報酬相對全體平均多或少（已排除 2026 年；2026 年另列作驗證）。回測 ${bt.months?.['3'] ?? ''} 個月、2026 驗證 ${vl.months?.['3'] ?? ''} 個訊號月；同一股票不同月份高度重疊，區間用自助法估計，仍可能偏窄。</li>
      <li>表中「續弱／震盪／轉強」＝之後 3 個月相對全體落在最差 20%、中間、最好 20% 的比例；全體基準就是沒有任何條件時的比例，用來避免把正常機率誤讀成訊號。</li>
      <li>這個旗標是月線等級的訊號，不適合短線進出；空頭市場時是否仍有效尚未確定（2026 年沒有空頭月份）。</li>
      <li>價格採未還原股利的收盤價，ETF 與興櫃不在範圍內。統計來源：${esc(DIAG_STATS.source)}（${esc(DIAG_STATS.built)}）。</li></ul></details>`;
  }

  function render() {
    const d = S.data;
    const head = `<section class="panel dg-top"><div class="panel-head"><h2 style="margin:0;font-size:18px">持股診斷</h2><span class="muted small">台股個股；只存在這個瀏覽器</span></div>
      <div class="dg-note muted">輸入你的持股，看每一檔目前有沒有觸發弱勢旗標、趨勢分數在哪、過去同條件的股票之後怎麼走。僅為歷史統計，不構成投資建議；你的成本價只用來算損益與回本幅度，不影響任何判斷。</div></section>`;
    const form = `<form class="panel dg-form" id="dg-form"><div class="dg-fields">
      <label>代號<input name="code" inputmode="numeric" maxlength="4" placeholder="2330" autocomplete="off" required></label>
      <label>股數<input name="shares" inputmode="numeric" placeholder="1000" autocomplete="off"></label>
      <label>成本價（可留空）<input name="cost" inputmode="decimal" placeholder="選填" autocomplete="off"></label>
      <button type="submit" class="refresh">加入／更新</button></div>${S.msg ? `<div class="dg-note ${S.msgBad ? 'bad' : 'muted'}">${esc(S.msg)}</div>` : ''}</form>`;
    if (S.loading && !d) { el.innerHTML = head + form + '<div class="status">讀取全市場資料中…</div>'; bind(); return; }
    if (S.error && !d) { el.innerHTML = head + form + `<div class="dg-note bad">讀不到資料：${esc(S.error)}</div><button class="refresh" id="dg-reload" type="button">重試</button>`; bind(); return; }
    const rs = d ? results() : [], sm = summarize(rs);
    const age = d ? Math.floor((Date.now() + 8 * 3600e3 - Date.parse(d.asof + 'T00:00:00Z')) / 864e5) : 0;
    const asof = d ? `<div class="muted small">資料日期 ${esc(d.asof)}（每個交易日收盤後更新；涵蓋 ${n0(d.nOk)} 檔）${age > 5 ? `<span class="down"> ，已經 ${age} 天沒有更新，旗標可能過期</span>` : ''}</div>` : '';
    const body = rs.length ? rs.map((r) => card(r, sm.weights[r.code])).join('') : '<div class="dg-empty muted">還沒有持股。在上面輸入代號與股數就會顯示診斷。</div>';
    const tools = `<div class="dg-tools"><button type="button" class="refresh" id="dg-exp" ${rs.length ? '' : 'disabled'}>匯出備份</button><label class="refresh dg-imp">匯入<input type="file" id="dg-imp" accept=".json,application/json" hidden></label>${S.storeOk ? '' : '<span class="down small">瀏覽器無法保存資料（可能是無痕模式），請用匯出備份。</span>'}</div>`;
    el.innerHTML = head + form + asof + summaryBlock(rs, sm) + body + actionBlock() + statsBlock() + tools;
    bind();
  }

  function bind() {
    el.querySelector('#dg-reload')?.addEventListener('click', load);
    el.querySelector('#dg-form')?.addEventListener('submit', (e) => {
      e.preventDefault(); const f = new FormData(e.target); say('');
      const r = upsertHolding(S.holdings, { code: f.get('code'), shares: f.get('shares'), cost: f.get('cost') });
      if (r.error) say(r.error, true); else { S.holdings = r.list; save(); say(''); }
      render();
    });
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { S.holdings = S.holdings.filter((h) => h.code !== b.dataset.del); save(); render(); }));
    el.querySelector('#dg-exp')?.addEventListener('click', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportHoldings(S.holdings)], { type: 'application/json' }));
      a.download = `持股診斷備份-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    el.querySelector('#dg-imp')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const r = parseHoldings(await f.text());
      if (r.error) say(r.error, true); else { S.holdings = r.list; save(); say(`已匯入 ${r.list.length} 檔` + (r.skipped?.length ? `，略過 ${r.skipped.length} 筆格式不正確的` : '')); }
      render();
    });
  }
  return { load, render, state: S };
}
