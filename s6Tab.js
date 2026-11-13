// 策略頁「長期核心」：價值＋低波動＋趨勢（S6-U）每月定期定額的操作助手。
// 做什麼：依你的起始日與每月可投入金額，算出這個月要賣什麼、先買什麼、各買幾股；你在畫面上打勾並填實際成交價，
// 之後它會幫你記錄持股、標出該賣的股票、比較同樣的錢買 0050 的結果。
// 紀錄只存在你的瀏覽器，可匯出成檔案備份、換裝置時匯入；不會傳到伺服器。規則與回測：專案文件《全球多因子長期策略-S6U》。
import { PLAN_DEFAULTS, planMonth } from '/lib/s6uPlan.js';
import { newState, derive, buildListInfo, makePlan, benchCompare, exportState, parseImport, uid, allTrades } from '/lib/s6uState.js';

const LSK = 'wr_s6u_state_v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const px = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 100 ? v.toFixed(1) : v.toFixed(2));
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const cls = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');

export function createS6Tab({ api, el }) {
  const S = { loading: false, error: '', data: null, loaded: false, st: null, which: 'final', storeOk: true, msg: '', openMore: false };
  try { const raw = localStorage.getItem(LSK); if (raw) S.st = parseImport(raw); } catch (e) { if (e && e.message && !/storage|denied/i.test(e.message)) S.msg = '瀏覽器裡的舊紀錄讀不出來（' + e.message + '），請用「匯入」還原備份。'; }
  function save() { try { localStorage.setItem(LSK, JSON.stringify(S.st)); S.storeOk = true; } catch { S.storeOk = false; } }

  async function load() {
    if (S.loading) return;
    S.loading = true; S.error = ''; render();
    try { S.data = await api('/api/s6u'); S.loaded = true; if (!buildListInfo(S.data, 'final')) S.which = 'preview'; }
    catch (e) { S.error = e.message || String(e); }
    finally { S.loading = false; render(); }
  }

  const info = () => (S.data ? buildListInfo(S.data, S.which) || buildListInfo(S.data, 'preview') : null);
  const curPrice = (code) => S.data?.list.find((x) => x.code === code)?.close;

  // ---------- 動作 ----------
  function act(fn) { fn(); save(); render(); }
  function ensurePlan(recalc) {
    const i = info(); if (!i) return;
    const m = today().slice(0, 7);
    act(() => { S.st.plans[m] = makePlan(S.st, m, i, today()); });
  }

  function render() {
    const d = S.data;
    const head = `<div class="s6-banner"><b>長期核心策略（價值＋低波動＋趨勢）</b>：每月定期定額，持有名單前 5～10 檔、等權，名次掉出前 2N 名才賣，不設停損。
      回測（2009～2025，排除 2026 大多頭，含手續費與證交稅）：1 萬元定期定額年化 <b class="num">20.4%</b>，同樣的錢買 0050 為 <b class="num">16.6%</b>；波動約 0050 的 0.85 倍、最大回撤 −15～−18%（0050 −29%）。
      <b>保守預測：長期每年多賺 1～2 個百分點、約六成機率贏 0050；遇到大空頭仍可能下跌 30～45%，不保證。</b></div>`;
    if (S.loading && !d) { el.innerHTML = head + '<div class="status">讀取名單中…</div>'; return; }
    if (S.error && !d) { el.innerHTML = head + `<div class="status err">${esc(S.error)}</div><button class="refresh" id="s6-reload" type="button">重試</button>`; el.querySelector('#s6-reload').onclick = load; return; }
    if (!d) { el.innerHTML = head; return; }
    const i = info();
    const warn = (S.msg ? `<div class="s6-note bad">${esc(S.msg)}</div>` : '') + (S.storeOk ? '' : '<div class="s6-note bad">這個瀏覽器無法保存紀錄（可能是無痕模式），請在每次操作後按「匯出紀錄」備份。</div>');
    if (!S.st) { el.innerHTML = head + warn + setupView(i); bindSetup(); return; }
    el.innerHTML = head + warn + mainView(i);
    bindMain(i);
  }

  // ---------- 首次設定 ----------
  function setupView(i) {
    const t = today();
    return `<section class="panel s6-setup"><div class="panel-head"><strong>開始前，先告訴我三件事</strong></div>
      <div class="s6-form">
        <label>策略開始日<input id="su-start" type="date" value="${t}"></label>
        <label>每月固定投入（元）<input id="su-monthly" type="number" min="1000" step="1000" value="10000"></label>
        <label>目前帳戶裡已有的現金（元，沒有填 0）<input id="su-cash" type="number" min="0" step="1000" value="0"></label>
      </div>
      <div class="status">開始日是你「第一次投入」的日子；之後每個月到這頁輸入當月投入金額，我會算出該買什麼。已有持股的話，建立後到下方「持股」新增。紀錄只存在這個瀏覽器，可隨時匯出備份。</div>
      <div class="toolbar"><button class="refresh" id="su-go" type="button">建立</button><button class="ghost" id="su-imp" type="button">匯入已備份的紀錄檔</button><input id="im-file" type="file" accept="application/json,.json" hidden></div></section>${guide()}`;
  }
  function bindSetup() {
    el.querySelector('#su-go').onclick = () => {
      const start = el.querySelector('#su-start').value, monthly = +el.querySelector('#su-monthly').value, cash = +el.querySelector('#su-cash').value || 0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(monthly >= 1000)) { S.msg = '請填起始日與每月投入（至少 1,000 元）'; render(); return; }
      S.msg = ''; act(() => { S.st = newState({ start, monthly, cash }); });
    };
    bindImport();
  }

  // ---------- 主畫面 ----------
  function mainView(i) {
    const st = S.st, m = today().slice(0, 7), dv = derive(st);
    const held = dv.positions.map((p) => { const c = curPrice(p.code) ?? p.cost / p.shares; return { ...p, price: c, mv: c * p.shares }; });
    const mv = held.reduce((a, p) => a + p.mv, 0), total = mv + dv.cash;
    const info_ = i;
    const flag = planMonth({ list: info_.list, holdings: dv.positions.map((p) => ({ code: p.code, shares: p.shares, px: p.cost / p.shares })), cash: dv.cash });
    const rankOf = new Map(info_.list.map((x) => [x.code, x.rank]));
    const cmp = benchCompare(st, d_bench(), total);
    const dep = st.deposits[m];
    const plan = st.plans[m];
    const tiles = `<div class="s6-tiles">
      <div><span>總資產</span><b class="num">${n0(total)}</b></div><div><span>持股市值</span><b class="num">${n0(mv)}</b></div><div><span>現金</span><b class="num">${n0(dv.cash)}</b></div>
      <div><span>累計投入</span><b class="num">${n0(dv.invested)}</b></div>
      <div><span>目前損益</span><b class="num ${cls(total - dv.invested)}">${dv.invested ? pct(total / dv.invested - 1) : '—'}</b></div>
      <div><span>同樣的錢買 0050</span><b class="num">${cmp ? pct(cmp.benchRet) : '—'}</b></div></div>
      ${cmp ? `<div class="status">比較只算價格報酬（不含股息），0050 以每月投入日當天收盤價買進。差距 ${pct(cmp.mineRet - cmp.benchRet)}。幾個月的差距主要是運氣，長期看才有意義（回測 5～10 年尺度）。</div>` : ''}`;
    const listSel = `<div class="s6-seg" role="group" aria-label="採用哪份名單">
      <button type="button" data-w="final" class="${S.which === 'final' ? 'on' : ''}" ${buildListInfo(S.data, 'final') ? '' : 'disabled'}>月底正式名單${buildListInfo(S.data, 'final') ? `（${esc(buildListInfo(S.data, 'final').month)}）` : '（尚無）'}</button>
      <button type="button" data-w="preview" class="${S.which === 'preview' ? 'on' : ''}">今日預覽（${esc(S.data.asof)}）</button></div>
      <div class="status">${S.which === 'final' ? `名次取自 ${esc(info_.day)} 月底收盤的名單（回測就是每月底排名、下個月換股），價格用最新收盤。` : '預覽名單用今天收盤重新排名，月中會跟月底名單不同；回測是以月底名單為準，建議用左邊那份。'}</div>`;
    const depBox = dep == null
      ? `<div class="s6-deposit"><label>${m} 這個月可以投入（元）<input id="dp-amt" type="number" min="0" step="1000" value="${st.monthly}"></label><button class="refresh" id="dp-go" type="button">入帳並計算本月計畫</button></div>`
      : `<div class="s6-deposit"><label>${m} 本月投入（元）<input id="dp-amt" type="number" min="0" step="1000" value="${dep}"></label><button class="ghost" id="dp-upd" type="button">修改金額</button></div>`;
    return `${tiles}
      <section class="panel"><div class="panel-head"><strong>① 本月（${m}）投入</strong></div>${depBox}${listSel}</section>
      ${plan ? planView(plan, m) : (dep != null ? '<div class="s6-note">按下「重新計算」產生本月計畫。</div>' : '')}
      <section class="panel"><div class="panel-head"><strong>③ 持股與賣出標記</strong><span class="muted small">現價取最新收盤；名次取自上面採用的名單（掉出前 ${flag.lim} 名或不在名單＝該賣）</span></div>${holdingsView(held, rankOf, flag)}
        <details class="s6-add"><summary>新增原本就有的持股／計畫外的買賣</summary>${addForm()}</details></section>
      <section class="panel"><div class="panel-head"><strong>④ 成交紀錄</strong><span class="muted small">打勾的計畫項目與手動新增都在這裡</span></div>${tradesView()}</section>
      <section class="panel"><div class="panel-head"><strong>⑤ 備份與設定</strong></div>
        <div class="s6-form"><label>每月固定投入（預設值）<input id="st-monthly" type="number" min="1000" step="1000" value="${st.monthly}"></label>
        <label>現金校正（元，領到股息或帳上現金不同時填差額，可為負）<input id="st-adj" type="number" step="100" value="${st.cashAdj || 0}"></label>
        <label>策略開始日<input id="st-start" type="date" value="${esc(st.start)}"></label></div>
        <div class="toolbar"><button class="refresh" id="ex-go" type="button">匯出紀錄（JSON 檔）</button><button class="ghost" id="su-imp" type="button">匯入紀錄檔</button><input id="im-file" type="file" accept="application/json,.json" hidden><button class="ghost" id="rs-go" type="button">清除全部紀錄</button></div>
        <div class="status">紀錄只存在這個瀏覽器；清除瀏覽器資料、換手機或電腦前請先匯出。匯入會取代目前的紀錄。</div></section>${guide()}`;
  }
  const d_bench = () => S.data?.bench;

  function planView(plan, m) {
    const basis = plan.basis.kind === 'final' ? `${esc(plan.basis.month)} 月底正式名單` : `${esc(plan.basis.day)} 預覽名單`;
    const acts = plan.items.filter((it) => it.kind !== 'skip'), skips = plan.items.filter((it) => it.kind === 'skip');
    acts.sort((a, b) => (a.kind === b.kind ? (a.rank ?? 999) - (b.rank ?? 999) : a.kind === 'sell' ? -1 : 1));
    const nTodo = acts.filter((x) => !x.done).length;
    const rows = acts.map((it, k) => {
      const f = it.done ? it.fill : { price: it.price, shares: it.shares, date: today() };
      const badge = it.kind === 'sell' ? '<span class="s6-b sell">賣出</span>' : it.isNew ? '<span class="s6-b new">新買</span>' : '<span class="s6-b add">加碼</span>';
      return `<div class="s6-item ${it.done ? 'done' : ''} ${it.kind}" data-id="${esc(it.id)}">
        <label class="s6-chk"><input type="checkbox" class="pi-chk" ${it.done ? 'checked' : ''} aria-label="${it.kind === 'sell' ? '已賣出' : '已買入'} ${esc(it.code)}"><span class="s6-step num">${k + 1}</span></label>
        <div class="s6-main"><div class="s6-name">${badge} <b class="num">${esc(it.code)}</b> ${esc(it.name)} <span class="muted small">名次 ${it.rank == null ? '—' : it.rank >= 999 ? '>60' : it.rank}</span></div>
          <div class="s6-plan num">${it.kind === 'sell' ? '賣出' : '買進'} <b>${n0(it.shares)}</b> 股 × 約 ${px(it.price)} ＝ <b>${n0(it.amount)}</b> 元${it.reason ? ` <span class="muted small">（${esc(it.reason)}）</span>` : ''}</div></div>
        <div class="s6-fill"><label>成交價<input class="pi-px num" type="number" step="0.01" min="0" value="${f.price}"></label><label>股數<input class="pi-sh num" type="number" step="1" min="1" value="${f.shares}"></label><label>日期<input class="pi-dt" type="date" value="${esc(f.date)}"></label></div></div>`;
    }).join('');
    const sk = skips.map((it) => `<li><b class="num">${esc(it.code)}</b> ${esc(it.name)}（名次 ${it.rank}）— ${esc(it.reason)}</li>`).join('');
    return `<section class="panel"><div class="panel-head"><strong>② 本月計畫：照順序做，做完打勾</strong><span class="muted small">依據 ${basis}・目標 ${plan.N} 檔・每檔約 ${n0(plan.target)} 元・總資產 ${n0(plan.V)} 元</span>
        <button class="ghost" id="pl-re" type="button">重新計算</button></div>
      ${acts.length ? `<div class="status">先賣出（回收現金）→ 再依名次由高到低買進；零股交易即可。還剩 <b>${nTodo}</b> 項。買完後在右邊填實際成交價與股數，打勾就會記進持股。價格是最新收盤估算，盤中會有差異。</div><div class="s6-list">${rows}</div>`
        : `<div class="s6-note">${plan.cashBefore < 1 ? '現金不足。' : `這個月不用買賣：資產 ${n0(plan.V)} 元分成 ${plan.N} 檔，每檔目標 ${n0(plan.target)} 元，低於最低單筆 ${n0(PLAN_DEFAULTS.minTicket)} 元，所以現金先留著，下個月合併再買（這是正常的，回測就是這樣做）。`}</div>`}
      ${skips.length ? `<details class="s6-skip"><summary>有 ${skips.length} 檔因金額太小或現金不夠先跳過（現金留到下個月）</summary><ul>${sk}</ul></details>` : ''}</section>`;
  }

  function holdingsView(held, rankOf, flag) {
    if (!held.length) return '<div class="status">目前沒有持股。完成本月計畫並打勾，或在下方手動新增。</div>';
    const sellSet = new Map(flag.sells.map((s) => [s.code, s.reason]));
    const rows = held.sort((a, b) => b.mv - a.mv).map((p) => {
      const r = rankOf.get(p.code), sell = sellSet.get(p.code), avg = p.cost / p.shares, pl = p.price / avg - 1;
      return `<tr class="${sell ? 's6-selltr' : ''}"><td><b class="num">${esc(p.code)}</b> ${esc(p.name)}</td><td class="num n">${n0(p.shares)}</td><td class="num n">${px(avg)}</td><td class="num n">${px(p.price)}</td><td class="num n ${cls(pl)}">${pct(pl)}</td><td class="num n">${n0(p.mv)}</td><td class="num n">${r == null ? '—' : r >= 999 ? '>60' : r}</td>
        <td>${sell ? `<span class="s6-b sell">該賣</span> <span class="muted small">${esc(sell)}</span>` : '<span class="s6-b keep">續抱</span>'}</td></tr>`;
    }).join('');
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>股票</th><th class="n">股數</th><th class="n">成本均價</th><th class="n">現價</th><th class="n">損益</th><th class="n">市值</th><th class="n">名次</th><th>狀態</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function addForm() {
    return `<div class="s6-form"><label>類型<select id="ad-type"><option value="buy">買進（原有持股／計畫外）</option><option value="sell">賣出</option></select></label>
      <label>代號<input id="ad-code" placeholder="2603"></label><label>股數<input id="ad-sh" type="number" min="1" step="1"></label><label>成交價<input id="ad-px" type="number" min="0" step="0.01"></label><label>日期<input id="ad-dt" type="date" value="${today()}"></label></div>
      <div class="toolbar"><button class="refresh" id="ad-go" type="button">新增</button><span class="status" style="width:auto">原本就有的持股請用買進、日期填取得日；現金會依成交金額（含手續費）扣除，若不想動到現金，請用上方「現金校正」補回。</span></div>`;
  }
  function tradesView() {
    const ts = allTrades(S.st).slice().reverse();
    if (!ts.length) return '<div class="status">還沒有成交紀錄。</div>';
    const rows = ts.map((t) => `<tr><td class="num">${esc(t.date)}</td><td>${t.type === 'buy' ? '買' : '賣'}</td><td><b class="num">${esc(t.code)}</b> ${esc(t.name)}</td><td class="num n">${n0(t.shares)}</td><td class="num n">${px(t.price)}</td><td class="num n">${n0(t.shares * t.price)}</td><td class="muted small">${t.src === 'plan' ? esc(t.month) + ' 計畫' : '手動'}</td><td>${t.src === 'manual' ? `<button class="ghost tr-del" data-id="${esc(t.id)}" type="button">刪除</button>` : ''}</td></tr>`).join('');
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th></th><th>股票</th><th class="n">股數</th><th class="n">成交價</th><th class="n">金額</th><th>來源</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="status">計畫內的項目要取消，請回上面把勾取消。</div>`;
  }

  function guide() {
    return `<details class="guide"><summary>規則與回測怎麼來的</summary><dl>
      <dt>怎麼選股</dt><dd>母體＝上市普通股、股價 ≥10、當日成交值排前 300。三個面向各自在母體內排百分位後平均：<b>價值</b>（本益比倒數、淨值比倒數、殖利率）、<b>低波動</b>（近 12 個月月報酬標準差越小越好）、<b>趨勢</b>（6-1 月動能、距 12 個月高點的接近度、站上 10 月均線）。這三類都是跨國市場（美、歐、日、亞太）長期被驗證的因子，不是只靠台灣資料挑出來的。</dd>
      <dt>怎麼買賣（每月一次）</dt><dd>持股檔數 N＝總資產 ÷ 3 萬元，限制在 5～10 檔（資金少就少檔，集中不分散到每檔買不起）。每個月：①名次掉到 2N 名之外或已不在名單的股票賣出；②不足 N 檔就依名次補進；③依名次由高到低，把每檔補到「總資產 ÷ N」，單筆不到 3,000 元就跳過，現金留到下個月。第一個月通常只存現金（1 萬元 ÷ 5 檔 = 2,000 元 &lt; 3,000 元）。</dd>
      <dt>回測（2009～2025，排除 2026）</dt><dd>每月投入 1 萬元、10 檔、緩衝 2 倍：年化（XIRR）20.4%，0050 定期定額 16.6%；開發期（2009～2017）18.3% vs 10.6%、驗證期（2018～2025）23.1% vs 23.2%（持平）；手續費加倍後 19.4%。8～12 檔結果差不多（不是挑到單一參數）。波動約 0050 的 0.85 倍、最大回撤 −15～−18%（0050 −29%）。隨機排名對照組明顯較差。</dd>
      <dt>預測與限制</dt><dd>回測的優勢一半以上可能是過度擬合與樣本期特性，保守預測長期超額約 +1～2 個百分點、約六成機率贏 0050。回測樣本沒有 2000、2008 這樣的大空頭，大空頭時這個策略同樣會下跌 30～45%（推論，不是回測）。資料每天由證交所公開資料＋Yahoo 還原價計算，名單與回測名單的前 30 名重疊 28～30 檔（全體名次相關 &gt;0.998）。這不是投資建議，只是把回測過的規則變成操作清單。</dd>
      <dt>跟其他卡片的關係</dt><dd>「四因子排名」是價格型因子（250 日高等），回測沒贏 0050，維持觀察用。這張卡是另一套：價值＋低波動＋趨勢，並且是長期持有、不看短線。研究時的「價值＋品質＋低波動（三因子）」「再加動能（四因子）」版本報酬都較低，已被這個版本取代。</dd></dl></details>`;
  }

  // ---------- 事件 ----------
  function bindImport() {
    const btn = el.querySelector('#su-imp'), fi = el.querySelector('#im-file'); if (!btn || !fi) return;
    btn.onclick = () => fi.click();
    fi.onchange = async () => {
      const f = fi.files[0]; if (!f) return;
      try { const st = parseImport(await f.text()); if (S.st && !confirm('匯入會取代目前這個瀏覽器裡的紀錄，確定嗎？')) return; S.msg = ''; act(() => { S.st = st; }); }
      catch (e) { S.msg = '匯入失敗：' + e.message; render(); }
    };
  }
  function bindMain(i) {
    const st = S.st, m = today().slice(0, 7);
    el.querySelectorAll('.s6-seg button').forEach((b) => { b.onclick = () => { S.which = b.dataset.w; render(); }; });
    const dp = el.querySelector('#dp-go'); if (dp) dp.onclick = () => { const v = +el.querySelector('#dp-amt').value; if (!(v >= 0)) return; act(() => { st.deposits[m] = v; st.plans[m] = makePlan(st, m, i, today()); }); };
    const du = el.querySelector('#dp-upd'); if (du) du.onclick = () => { const v = +el.querySelector('#dp-amt').value; if (!(v >= 0)) return; act(() => { st.deposits[m] = v; }); };
    const re = el.querySelector('#pl-re'); if (re) re.onclick = () => ensurePlan(true);
    el.querySelectorAll('.s6-item').forEach((row) => {
      const it = st.plans[m]?.items.find((x) => x.id === row.dataset.id); if (!it) return;
      const read = () => ({ price: +row.querySelector('.pi-px').value, shares: Math.floor(+row.querySelector('.pi-sh').value), date: row.querySelector('.pi-dt').value });
      row.querySelector('.pi-chk').onchange = (e) => {
        if (e.target.checked) { const f = read(); if (!(f.price > 0 && f.shares > 0 && f.date)) { S.msg = '請先填好成交價、股數、日期再打勾'; render(); return; } S.msg = ''; act(() => { it.done = true; it.fill = f; }); }
        else act(() => { it.done = false; delete it.fill; });
      };
      row.querySelectorAll('.s6-fill input').forEach((inp) => { inp.onchange = () => { if (it.done) { const f = read(); if (f.price > 0 && f.shares > 0 && f.date) act(() => { it.fill = f; }); else render(); } }; });
    });
    const ag = el.querySelector('#ad-go'); if (ag) ag.onclick = () => {
      const t = { id: uid(), type: el.querySelector('#ad-type').value, code: el.querySelector('#ad-code').value.trim(), shares: Math.floor(+el.querySelector('#ad-sh').value), price: +el.querySelector('#ad-px').value, date: el.querySelector('#ad-dt').value };
      if (!/^\d{4}$/.test(t.code) || !(t.shares > 0) || !(t.price > 0) || !t.date) { S.msg = '請填 4 碼代號、股數、成交價、日期'; render(); return; }
      t.name = S.data.list.find((x) => x.code === t.code)?.name || ''; S.msg = ''; act(() => { st.manual.push(t); });
    };
    el.querySelectorAll('.tr-del').forEach((b) => { b.onclick = () => act(() => { st.manual = st.manual.filter((x) => x.id !== b.dataset.id); }); });
    const mo = el.querySelector('#st-monthly'); if (mo) mo.onchange = () => { const v = +mo.value; if (v >= 1000) act(() => { st.monthly = v; }); };
    const ad = el.querySelector('#st-adj'); if (ad) ad.onchange = () => act(() => { st.cashAdj = +ad.value || 0; });
    const sd = el.querySelector('#st-start'); if (sd) sd.onchange = () => { if (sd.value) act(() => { st.start = sd.value; }); };
    el.querySelector('#ex-go').onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportState(st)], { type: 'application/json' }));
      a.download = `chip-radar-長期核心-${today().replace(/-/g, '')}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    el.querySelector('#rs-go').onclick = () => { if (confirm('會清除這個瀏覽器裡全部的長期核心紀錄（建議先匯出備份），確定嗎？')) { try { localStorage.removeItem(LSK); } catch {} S.st = null; render(); } };
    bindImport();
  }

  return { load, render, get loaded() { return S.loaded; }, get loading() { return S.loading; } };
}
