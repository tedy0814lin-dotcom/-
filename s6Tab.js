// 策略頁「長期核心」：價值＋低波動＋趨勢（S6-U）每月定期定額的操作助手。
// 做什麼：依你的起始日與每月可投入金額，算出這個月要賣什麼、先買什麼、各買幾股；你在畫面上打勾並填實際成交價，
// 之後它會幫你記錄持股、標出該賣的股票、比較同樣的錢買 0050 的結果。
// 紀錄只存在你的瀏覽器，可匯出成檔案備份、換裝置時匯入；不會傳到伺服器。規則與回測：專案文件《全球多因子長期策略-S6U》。
import { PLAN_DEFAULTS, planMonth, applyExclude } from '/lib/s6uPlan.js';
import { RULES_VER, TIERS, tierOf, planArgs, newState, derive, buildListInfo, makePlan, benchCompare, exportState, parseImport, uid, allTrades } from '/lib/s6uState.js';

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
    try { S.data = await api('/api/s6u'); S.loaded = true; if (!buildListInfo(S.data, 'final', verNow())) S.which = 'preview'; }
    catch (e) { S.error = e.message || String(e); }
    finally { S.loading = false; render(); }
  }

  const verNow = () => { const v = S.st?.ver; return TIERS[v] && (!TIERS[v].needRot || S.data?.rotOk === true) ? v : 'base'; };
  const info = () => (S.data ? buildListInfo(S.data, S.which, verNow()) || buildListInfo(S.data, 'preview', verNow()) : null);
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
    const head = `<div class="s6-banner"><b>長期核心</b>：每月定期定額，持有排名前 5～10 檔（依版本），名次掉出才賣、不設停損。保守／平衡／進攻三個版本（都分散持有，差別在強勢股占選股分數的比重），風險由低到高；預設保守版（回測定期定額年化 <b class="num">20.4%</b>，0050 <b class="num">16.6%</b>，回撤較小）。回測有挑參數的偏差，實際請打折看；大空頭仍會跌，不保證。</div>`;
    if (S.loading && !d) { el.innerHTML = head + '<div class="status">讀取名單中…</div>'; return; }
    if (S.error && !d) { el.innerHTML = head + `<div class="s6-note bad">讀不到名單：${esc(S.error)}</div><button class="refresh" id="s6-reload" type="button">重試</button>`; el.querySelector('#s6-reload').onclick = load; return; }
    if (!d) { el.innerHTML = head + '<div class="status">讀取名單中…</div>'; return; }
    const i = info();
    if (S.st && i) { // 規則版本更新或換名單：沒有任何打勾的舊計畫自動重算，避免看到過時的空清單
      const m = today().slice(0, 7), pl = S.st.plans[m];
      if (!pl && S.st.deposits[m] != null) { S.st.plans[m] = makePlan(S.st, m, i, today()); save(); } // 已入帳但還沒有本月清單（舊版紀錄）：直接產生
      else if (pl && pl.rv !== RULES_VER && !pl.items.some((x) => x.done)) { S.st.plans[m] = makePlan(S.st, m, i, today()); save(); }
    }
    const warn = (S.msg ? `<div class="s6-note bad">${esc(S.msg)}</div>` : '') + (S.storeOk ? '' : '<div class="s6-note bad">這個瀏覽器無法保存紀錄（可能是無痕模式），請操作後到「更多」匯出備份。</div>');
    if (!S.st) { el.innerHTML = head + warn + setupView() ; bindSetup(); return; }
    el.innerHTML = head + warn + mainView(i);
    bindMain(i);
  }

  // ---------- 首次設定 ----------
  function setupView() {
    return `<section class="panel s6-setup"><div class="panel-head"><strong>先設定三個數字</strong></div>
      <div class="s6-form">
        <label>開始日<input id="su-start" type="date" value="${today()}"></label>
        <label>每月固定投入（元）<input id="su-monthly" type="number" min="1000" step="1000" value="10000"></label>
        <label>現在帳戶裡的現金（元）<input id="su-cash" type="number" min="0" step="1000" value="10000"></label>
      </div>
      <div class="status">現金填「現在可以拿來買股票的錢」，之後每月會再加上每月投入。已經有持股的話，建立後在下面「持股」新增。紀錄只存在這個瀏覽器，可匯出備份。</div>
      <div class="toolbar"><button class="refresh" id="su-go" type="button">建立並產生本月清單</button><button class="ghost" id="su-imp" type="button">匯入備份檔</button><input id="im-file" type="file" accept="application/json,.json" hidden></div></section>`;
  }
  function bindSetup() {
    el.querySelector('#su-go').onclick = () => {
      const start = el.querySelector('#su-start').value, monthly = +el.querySelector('#su-monthly').value, cash = +el.querySelector('#su-cash').value || 0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(monthly >= 1000)) { S.msg = '請填開始日與每月投入（至少 1,000 元）'; render(); return; }
      S.msg = '';
      act(() => { S.st = newState({ start, monthly, cash }); const m = today().slice(0, 7); S.st.deposits[start.slice(0, 7)] = cash; if (start.slice(0, 7) === m) S.st.plans[m] = makePlan(S.st, m, info(), today()); });
    };
    bindImport();
  }

  // ---------- 主畫面 ----------
  const pn = (r) => (r == null ? '—' : r >= 999 ? '>60' : r);
  function mainView(i) {
    const st = S.st, m = today().slice(0, 7), dv = derive(st);
    const held = dv.positions.map((p) => { const c = curPrice(p.code) ?? p.cost / p.shares; return { ...p, price: c, mv: c * p.shares }; });
    const mv = held.reduce((a, p) => a + p.mv, 0), total = mv + dv.cash;
    const flag = planMonth({ list: i.list, holdings: dv.positions.map((p) => ({ code: p.code, shares: p.shares, px: p.cost / p.shares })), cash: dv.cash, ...planArgs(st, verNow()) });
    const rankOf = new Map(applyExclude(i.list, st.exclude).map((x) => [x.code, x.rank]));
    const cmp = benchCompare(st, S.data.bench, total);
    const plan = st.plans[m], dep = st.deposits[m];
    const fin = buildListInfo(S.data, 'final', verNow());
    const hero = `<section class="s6-hero"><div class="s6-hl">總資產（持股市值＋現金）</div><div class="s6-big num">${n0(total)}<small>元</small></div>
      <div class="s6-sub num"><span>持股 ${n0(mv)}</span><span>現金 ${n0(dv.cash)}</span><span>累計投入 ${n0(dv.invested)}</span>${dv.invested > 0 ? `<span class="${cls(total - dv.invested)}">損益 ${pct(total / dv.invested - 1)}</span>` : ''}${dv.realized ? `<span class="${cls(dv.realized)}">已實現損益 ${n0(dv.realized)}</span>` : ''}${cmp ? `<span>同樣的錢買 0050：${pct(cmp.benchRet)}</span>` : ''}</div>
      <div class="s6-addmoney"><label>新投入／領出（元，領出填負數）<input id="fl-amt" type="number" step="1000" value="${st.monthly}"></label><button class="refresh" id="fl-go" type="button">加入現金</button></div>
      <div class="s6-sub s6-hint"><span>總資產由系統自動算：持股用最新收盤估值＋現金。你的成本是「打勾時填的實際成交價」，賣出損益用你填的賣出價，不是上面預估價。</span></div></section>`;
    const need = dep == null
      ? `<div class="s6-deposit"><label>${m} 本月投入（元）<input id="dp-amt" type="number" min="0" step="1000" value="${st.monthly}"></label><button class="refresh" id="dp-go" type="button">入帳並產生清單</button></div>` : '';
    const lsel = `<select id="ls-sel" class="select" aria-label="採用哪份名單"><option value="final" ${S.which === 'final' ? 'selected' : ''} ${fin ? '' : 'disabled'}>月底正式名單${fin ? '（' + esc(fin.month) + '）' : '（尚無）'}</option><option value="preview" ${S.which === 'preview' ? 'selected' : ''}>今日預覽（${esc(S.data.asof)}）</option></select>`;
    const V = verNow();
    const TXT = {
      base: '<b>保守</b>：價值、低波動、趨勢各占 1/3（強勢股只占 1/3），持有 10 檔。回測（2009～2025，排除 2026，每月定期定額）年化 <b class="num">20.4%</b>、波動 17%、最大回撤 <b class="num">−16%</b>，最差連續 12 個月 −9%。對照 0050：16.6%／波動 19%／回撤 −29%／最差 12 個月 −25%。報酬小贏 0050、風險大降。',
      R: '<b>平衡</b>：強勢股（6 個月動能、接近 12 月高點、站上均線，加「強勢產業」加分）占分數 2/3，價值與低波動合占 1/3，持有 10 檔。回測年化 <b class="num">24.4%</b>、波動 29%、最大回撤 <b class="num">−26%</b>（略小於 0050），最差連續 12 個月 −19%。2022～2025 年化 22.6%（0050 19.5%）。排除 2021 航運大多頭後逐年複利仍 24.0%（0050 16.6%）。',
      A: '<b>進攻（觀察用）</b>：強勢股占分數 71%，低波動只剩很小權重，同樣持有 10 檔。回測年化 <b class="num">23.8%</b>、波動 33%、最大回撤 <b class="num">−33%</b>（比 0050 的 −29% 多 4 個百分點），最差連續 12 個月 −27%（0050 −25%）。<b>報酬沒有比平衡版高</b>（多承擔的風險在回測裡沒換到報酬）；2022～2025 年化 17.9%，輸 0050 的 19.5%；若從 2021 年才開始投入則年化 17.7%（0050 26.6%）。強勢股會集中在強勢產業，請看下方持股的產業分布。',
    };
    const opt = (k) => `<option value="${k}" ${V === k ? 'selected' : ''} ${TIERS[k].needRot && S.data.rotOk !== true ? 'disabled' : ''}>${TIERS[k].label}版${k === 'base' ? '（預設）' : k === 'A' ? '（觀察用）' : ''}</option>`;
    const vsel = `<section class="panel s6-ver"><div class="panel-head"><strong>策略版本</strong><select id="ver-sel" class="select">${opt('base')}${opt('R')}${opt('A')}</select></div>
      <div class="s6-tiers"><div class="s6-tier ${V === 'base' ? 'on' : ''}"><b>保守</b><span class="num">強勢股 33%・回撤 −16%</span></div><div class="s6-tier ${V === 'R' ? 'on' : ''}"><b>平衡</b><span class="num">強勢股 67%・回撤 −26%</span></div><div class="s6-tier ${V === 'A' ? 'on' : ''}"><b>進攻</b><span class="num">強勢股 71%・回撤 −33%</span></div></div>
      <div class="status">${TXT[V]}</div>${pickView(i, V)}</section>`;
    const todo = `<section class="panel"><div class="panel-head"><strong>本月（${m}）要做的事</strong>${lsel}<button class="ghost" id="pl-re" type="button">重新計算</button></div>${need}${plan ? planView(plan, i) : (dep != null ? '<div class="status">按「重新計算」產生清單。</div>' : '')}</section>`;
    return `${hero}${vsel}${todo}
      <section class="panel"><div class="panel-head"><strong>持股</strong><span class="muted small">紅底＝該賣（名次掉出前 ${flag.lim} 名或不在名單）</span></div>${holdingsView(held, rankOf, flag)}</section>
      <details class="s6-more"><summary>更多：新增持股、成交紀錄、備份、設定、規則</summary>
        <div class="s6-sec"><h4>新增原本就有的持股／計畫外的買賣</h4>${addForm()}</div>
        <div class="s6-sec"><h4>成交紀錄</h4>${tradesView()}</div>
        <div class="s6-sec"><h4>現金校正（領到股息、或帳上現金跟這裡不同）</h4><div class="s6-form"><label>現金改成（元）<input id="ca-amt" type="number" min="0" step="100" value="${Math.round(dv.cash)}"></label><label>　<button class="refresh" id="ca-go" type="button">校正</button></label></div><div class="status">只改現金，不算入「累計投入」，所以不會影響損益比較。</div></div>
        <div class="s6-sec"><h4>備份與設定</h4>
          <div class="s6-form"><label>每月固定投入（預設值）<input id="st-monthly" type="number" min="1000" step="1000" value="${st.monthly}"></label><label>策略開始日<input id="st-start" type="date" value="${esc(st.start)}"></label></div>
          <div class="toolbar"><button class="refresh" id="ex-go" type="button">匯出紀錄（JSON 檔）</button><button class="ghost" id="su-imp" type="button">匯入紀錄檔</button><input id="im-file" type="file" accept="application/json,.json" hidden><button class="ghost" id="rs-go" type="button">清除全部紀錄</button></div>
          <div class="status">紀錄只存在這個瀏覽器；換手機、換電腦或清除瀏覽器資料前請先匯出。匯入會取代目前的紀錄。</div></div>
        ${guide()}</details>`;
  }

  // ---------- 自己挑股票 ----------
  function pickView(i, V) {
    const st = S.st, pins = st.pins || [], ex = st.exclude || [], nm = (c) => i.list.find((x) => x.code === c)?.name || S.data.list.find((x) => x.code === c)?.name || '';
    const chip = (c, kind) => `<span class="s6-chip ${kind}"><b class="num">${esc(c)}</b> ${esc(nm(c))}<button type="button" class="pk-rm" data-kind="${kind}" data-code="${esc(c)}" aria-label="移除 ${esc(c)}">×</button></span>`;
    const opts = S.data.list.map((x) => `<option value="${esc(x.code)} ${esc(x.name)}"></option>`).join('');
    const top = i.list.slice().sort((a, b) => a.rank - b.rank).slice(0, 30);
    const rows = top.map((x) => `<tr><td class="num n">${x.rank}</td><td><b class="num">${esc(x.code)}</b> ${esc(x.name)} <span class="muted small">${esc(x.ind || '')}</span></td><td class="num n">${px(x.close)}</td><td>${pins.includes(x.code) ? '<span class="s6-b pin">已指定</span>' : ex.includes(x.code) ? '<span class="s6-b sell">已排除</span>' : `<button class="ghost s6-x pk-add" data-kind="pins" data-code="${esc(x.code)}" type="button">指定買</button> <button class="ghost s6-x pk-add" data-kind="exclude" data-code="${esc(x.code)}" type="button">不要買</button>`}</td></tr>`).join('');
    return `<details class="s6-pick" ${pins.length || ex.length ? 'open' : ''}><summary>自己挑股票（${pins.length ? '指定 ' + pins.length + ' 檔' : '未指定'}・${ex.length ? '排除 ' + ex.length + ' 檔' : '未排除'}）</summary>
      <div class="status"><b>指定</b>＝這檔一定持有（算在 ${tierOf(V).nMax} 檔以內，不會因名次被賣；名額滿了會賣掉名次最差的持股讓位）。<b>排除</b>＝不買這檔（已持有的會標賣出），後面名次遞補。設定三個版本共用。<b>你挑的股票不在回測裡，表現沒有驗證</b>；只能挑名單內的股票（上市、股價 ≥10、成交值前 300）。</div>
      <div class="s6-form"><label>輸入代號或名稱<input id="pk-in" list="pk-dl" placeholder="例如 2330 或 台積電" autocomplete="off"></label><datalist id="pk-dl">${opts}</datalist>
        <label>　<span><button class="refresh" id="pk-pin" type="button">指定買</button> <button class="ghost" id="pk-ex" type="button">不要買</button></span></label></div>
      ${pins.length ? `<div class="s6-chips"><span class="muted small">指定：</span>${pins.map((c) => chip(c, 'pins')).join('')}</div>` : ''}${ex.length ? `<div class="s6-chips"><span class="muted small">排除：</span>${ex.map((c) => chip(c, 'exclude')).join('')}</div>` : ''}
      <div class="s6-sec"><h4>${tierOf(V).label}版目前前 30 名（點選直接指定或排除）</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="n">名次</th><th>股票</th><th class="n">收盤</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
  }

  function planView(plan, i) {
    const basis = plan.basis.kind === 'final' ? `${esc(plan.basis.month)} 月底名單` : `${esc(plan.basis.day)} 預覽名單`;
    const acts = plan.items.filter((it) => it.kind !== 'skip'), skips = plan.items.filter((it) => it.kind === 'skip');
    acts.sort((a, b) => (a.kind === b.kind ? (a.rank ?? 999) - (b.rank ?? 999) : a.kind === 'sell' ? -1 : 1));
    const nTodo = acts.filter((x) => !x.done).length;
    const meta = `<div class="status">${esc(tierOf(plan.ver).label)}版・依據 ${basis}・總資產 ${n0(plan.V)} 元分 ${plan.N} 檔・每檔約 ${n0(plan.target)} 元</div>`;
    if (!acts.length) {
      // 沒有可做的事：說明原因，並預告下個月存入後會買什麼
      const nxt = planMonth({ list: i.list, holdings: derive(S.st).positions.map((p) => ({ code: p.code, shares: p.shares, px: p.cost / p.shares })), cash: derive(S.st).cash + S.st.monthly });
      const nb = nxt.buys.filter((b) => b.status === 'buy');
      const why = plan.cashBefore < 1 ? '現金不足。' : `這個月先不買：${n0(plan.V)} 元分成 ${plan.N} 檔，每檔只有約 ${n0(plan.target)} 元，不到最低單筆 ${n0(PLAN_DEFAULTS.minTicket)} 元。錢太少硬買會被手續費吃掉，也不符合回測的做法，現金留著下個月合併買（回測也是這樣）。`;
      return meta + `<div class="s6-empty"><b>今天沒有要買賣的。</b>${why}</div>` + (nb.length ? `<div class="s6-prev"><div class="s6-prevh">預告：下個月再存入 ${n0(S.st.monthly)} 元（現金約 ${n0(derive(S.st).cash + S.st.monthly)} 元），會買這 ${nb.length} 檔</div>${nb.map((b) => `<div class="s6-prevr"><span><b class="num">${esc(b.code)}</b> ${esc(b.name)} <span class="muted small">名次 ${pn(b.rank)}</span></span><span class="num">${n0(b.shares)} 股 ≈ ${n0(b.amount)} 元</span></div>`).join('')}<div class="status">名次會隨月底名單更新，這只是預覽，不是現在要買。</div></div>` : '');
    }
    const rows = acts.map((it, k) => {
      const f = it.done ? it.fill : { price: it.price, shares: it.shares };
      const badge = it.kind === 'sell' ? '<span class="s6-b sell">賣</span>' : it.isNew ? '<span class="s6-b new">買</span>' : '<span class="s6-b add">加碼</span>';
      return `<div class="s6-item ${it.done ? 'done' : ''} ${it.kind}" data-id="${esc(it.id)}">
        <label class="s6-chk"><input type="checkbox" class="pi-chk" ${it.done ? 'checked' : ''} aria-label="${it.kind === 'sell' ? '已賣出' : '已買入'} ${esc(it.code)}"><span class="s6-step num">${k + 1}</span></label>
        <div class="s6-main"><div class="s6-name">${badge} <b class="num">${esc(it.code)}</b> ${esc(it.name)} <span class="muted small">${it.ind ? esc(it.ind) + '・' : ''}名次 ${pn(it.rank)}</span>${it.pinned ? ' <span class="s6-b pin">你指定</span>' : ''}${it.kind === 'buy' && !it.done && !it.pinned ? ` <button class="ghost s6-x pk-ex" data-code="${esc(it.code)}" type="button">不買這檔</button>` : ''}</div>
          <div class="s6-plan num">${it.done ? `已記錄：<b>${n0(it.fill.shares)}</b> 股 × <b>${px(it.fill.price)}</b> ＝ <b>${n0(it.fill.shares * it.fill.price)}</b> 元（你的成交價）` : `建議 <b>${n0(it.shares)}</b> 股，預估價 ${px(it.price)}（約 ${n0(it.amount)} 元）${it.reason ? ` <span class="muted small">${esc(it.reason)}</span>` : ''}`}</div></div>
        <div class="s6-fill"><label>我的${it.kind === 'sell' ? '賣出' : '買入'}價<input class="pi-px num" type="number" step="0.01" min="0" value="${f.price}"></label><label>我的股數<input class="pi-sh num" type="number" step="1" min="1" value="${f.shares}"></label></div></div>`;
    }).join('');
    return meta + `<div class="status">依序做：先賣、再買（零股交易）。買完把「我的買入價／股數」改成你真正成交的，再打勾；持股成本、現金、損益都以你填的為準。還剩 <b>${nTodo}</b> 項。</div><div class="s6-list">${rows}</div>`
      + (skips.length ? `<details class="s6-skip"><summary>另有 ${skips.length} 檔金額太小先跳過</summary><ul>${skips.map((it) => `<li><b class="num">${esc(it.code)}</b> ${esc(it.name)}（名次 ${pn(it.rank)}）</li>`).join('')}</ul></details>` : '');
  }

  function holdingsView(held, rankOf, flag) {
    if (!held.length) return '<div class="status">目前沒有持股。照上面清單買進打勾後會出現在這；原本就有的持股請到「更多」新增。</div>';
    const sellSet = new Map(flag.sells.map((s) => [s.code, s.reason]));
    const indOf = new Map(info().list.map((x) => [x.code, x.ind]));
    const tot = held.reduce((a, p) => a + p.mv, 0), byInd = {};
    for (const p of held) { const k = indOf.get(p.code) || '其他'; byInd[k] = (byInd[k] || 0) + p.mv; }
    const mix = Object.entries(byInd).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${Math.round((v / tot) * 100)}%`).join('・');
    const rows = held.sort((a, b) => b.mv - a.mv).map((p) => {
      const r = rankOf.get(p.code), sell = sellSet.get(p.code), avg = p.cost / p.shares, pl = p.price / avg - 1;
      return `<tr class="${sell ? 's6-selltr' : ''}"><td><b class="num">${esc(p.code)}</b> ${esc(p.name)} <span class="muted small">${esc(indOf.get(p.code) || '')}</span></td><td class="num n">${n0(p.shares)}</td><td class="num n">${px(avg)}</td><td class="num n">${px(p.price)}</td><td class="num n ${cls(pl)}">${pct(pl)}</td><td class="num n">${n0(p.mv)}</td><td class="num n">${pn(r)}</td>
        <td>${sell ? '<span class="s6-b sell">該賣</span>' : '<span class="s6-b keep">續抱</span>'}</td></tr>`;
    }).join('');
    return `<div class="status">產業分布（依市值）：${mix}${Math.max(...Object.values(byInd)) / tot > 0.5 ? ' <b class="down">⚠ 單一產業超過一半</b>' : ''}</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>股票</th><th class="n">股數</th><th class="n">成本</th><th class="n">現價</th><th class="n">損益</th><th class="n">市值</th><th class="n">名次</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function addForm() {
    return `<div class="s6-form"><label>類型<select id="ad-type"><option value="buy">買進（原有持股／計畫外）</option><option value="sell">賣出</option></select></label>
      <label>代號<input id="ad-code" placeholder="2603"></label><label>股數<input id="ad-sh" type="number" min="1" step="1"></label><label>成交價<input id="ad-px" type="number" min="0" step="0.01"></label><label>日期<input id="ad-dt" type="date" value="${today()}"></label></div>
      <div class="toolbar"><button class="refresh" id="ad-go" type="button">新增</button></div>
      <div class="status">新增買進會從現金扣掉成交金額（含手續費）。原本就有的持股如果不想動現金，新增後再用上面「調整總資產」把總資產改回正確數字即可。</div>`;
  }
  function tradesView() {
    const ts = allTrades(S.st).slice().reverse();
    if (!ts.length) return '<div class="status">還沒有成交紀錄。</div>';
    const rows = ts.map((t) => `<tr><td class="num">${esc(t.date)}</td><td>${t.type === 'buy' ? '買' : '賣'}</td><td><b class="num">${esc(t.code)}</b> ${esc(t.name)}</td><td class="num n">${n0(t.shares)}</td><td class="num n">${px(t.price)}</td><td class="num n">${n0(t.shares * t.price)}</td><td class="muted small">${t.src === 'plan' ? esc(t.month) + ' 計畫' : '手動'}</td><td>${t.src === 'manual' ? `<button class="ghost tr-del" data-id="${esc(t.id)}" type="button">刪除</button>` : ''}</td></tr>`).join('');
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th></th><th>股票</th><th class="n">股數</th><th class="n">成交價</th><th class="n">金額</th><th>來源</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="status">計畫內的項目要取消，請回上面把勾取消。</div>`;
  }

  function guide() {
    return `<div class="s6-sec"><h4>規則與回測</h4><dl class="s6-dl">
      <dt>怎麼選股</dt><dd>母體＝上市普通股、股價 ≥10、當日成交值排前 300。三個面向各自排百分位後平均：價值（本益比倒數、淨值比倒數、殖利率）、低波動（近 12 個月月報酬波動越小越好）、趨勢（6-1 月動能、距 12 個月高點、站上 10 月均線）。這三類在美、歐、日、亞太都有長期證據，不是只靠台灣資料挑出來的。</dd>
      <dt>怎麼買賣（每月一次）</dt><dd>持股檔數 N＝總資產 ÷ 3 萬，限制 5～10 檔（三個版本檔數規則相同，都分散在最多 10 檔，差別只在選股分數裡「強勢股」的比重；總資產不到 1.5 萬時降到 3～4 檔，不然每檔不到 3,000 元買不了）。名次掉到 2N 名之外或不在名單的賣出；不足 N 檔依名次補進；依名次把每檔補到「總資產 ÷ N」，單筆不到 3,000 元就跳過、現金留到下月。1 萬元第一個月通常只存現金。</dd>
      <dt>回測（2009～2025，排除 2026）</dt><dd>每月 1 萬、10 檔、緩衝 2 倍：年化 20.4% vs 0050 定期定額 16.6%；開發期 18.3% vs 10.6%、驗證期 23.1% vs 23.2%（持平）；手續費加倍 19.4%；隨機名次對照組 5.9%。波動約 0050 的 0.85 倍、最大回撤 −15～−18%（0050 −29%）。</dd>
      <dt>預測與限制</dt><dd>保守預測長期超額約 +1～2 個百分點、約六成機率贏 0050；回測沒有 2000／2008 這樣的大空頭，大空頭同樣會跌 30～45%（推論）。名單每天由證交所公開資料＋Yahoo 還原價計算，與回測名單前 30 名重疊 28～30 檔。這不是投資建議。</dd>
      <dt>跟其他卡片</dt><dd>「四因子排名」是價格型因子，沒贏 0050，維持觀察用。研究時的三因子、四因子報酬較低，已被這套取代。</dd></dl></div>`;
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
    const vs = el.querySelector('#ver-sel'); if (vs) vs.onchange = () => { st.ver = vs.value; if (S.which === 'final' && !buildListInfo(S.data, 'final', verNow())) S.which = 'preview'; const j = info(); if (j && st.plans[m]) st.plans[m] = makePlan(st, m, j, today()); save(); render(); };
    const ls = el.querySelector('#ls-sel'); if (ls) ls.onchange = () => { S.which = ls.value; const j = info(); if (st.plans[m] && j) { st.plans[m] = makePlan(st, m, j, today()); save(); } render(); };
    const dp = el.querySelector('#dp-go'); if (dp) dp.onclick = () => { const v = +el.querySelector('#dp-amt').value; if (!(v >= 0)) return; act(() => { st.deposits[m] = v; (st.flows ||= []).push({ date: today(), amount: v }); st.plans[m] = makePlan(st, m, i, today()); }); };
    const recalc = () => { const j = info(); if (j && st.plans[m]) st.plans[m] = makePlan(st, m, j, today()); };
    const setPick = (kind, code) => {
      const other = kind === 'pins' ? 'exclude' : 'pins'; st.pins ||= []; st.exclude ||= [];
      if (!S.data.list.some((x) => x.code === code)) { S.msg = code + ' 不在名單內（只能挑上市、股價 ≥10、成交值前 300 的股票）'; render(); return; }
      if (kind === 'pins' && !st.pins.includes(code) && st.pins.length >= tierOf(verNow()).nMax) { S.msg = `指定最多 ${tierOf(verNow()).nMax} 檔（目前版本的持股上限）`; render(); return; }
      S.msg = ''; act(() => { st[other] = st[other].filter((c) => c !== code); if (!st[kind].includes(code)) st[kind].push(code); recalc(); });
    };
    const resolve = () => { const t = (el.querySelector('#pk-in').value || '').trim(); const code = (t.match(/^\d{4}/) || [])[0] || S.data.list.find((x) => x.name === t)?.code; if (!code) { S.msg = '找不到「' + t + '」，請輸入 4 碼代號或從選單選'; render(); return null; } return code; };
    const pp = el.querySelector('#pk-pin'); if (pp) pp.onclick = () => { const c = resolve(); if (c) setPick('pins', c); };
    const pe = el.querySelector('#pk-ex'); if (pe) pe.onclick = () => { const c = resolve(); if (c) setPick('exclude', c); };
    el.querySelectorAll('.pk-add').forEach((b) => { b.onclick = () => setPick(b.dataset.kind, b.dataset.code); });
    el.querySelectorAll('.pk-ex').forEach((b) => { b.onclick = () => setPick('exclude', b.dataset.code); });
    el.querySelectorAll('.pk-rm').forEach((b) => { b.onclick = () => act(() => { st[b.dataset.kind] = (st[b.dataset.kind] || []).filter((c) => c !== b.dataset.code); recalc(); }); });
    const re = el.querySelector('#pl-re'); if (re) re.onclick = () => ensurePlan();
    const fl = el.querySelector('#fl-go'); if (fl) fl.onclick = () => {
      const v = +el.querySelector('#fl-amt').value; if (!v || !Number.isFinite(v)) { S.msg = '請填新投入的金額（領出填負數）'; render(); return; }
      if (v < 0 && -v > derive(st).cash) { S.msg = '領出金額超過現金，請先賣出持股'; render(); return; }
      S.msg = ''; act(() => { st.deposits[m] = (st.deposits[m] || 0) + v; (st.flows ||= []).push({ date: today(), amount: v }); const j = info(); if (j && st.plans[m]) st.plans[m] = makePlan(st, m, j, today()); });
    };
    const ca = el.querySelector('#ca-go'); if (ca) ca.onclick = () => {
      const t = +el.querySelector('#ca-amt').value; if (!(t >= 0)) return; const dv = derive(st); act(() => { st.cashAdj = (st.cashAdj || 0) + (t - dv.cash); const j = info(); if (j && st.plans[m]) st.plans[m] = makePlan(st, m, j, today()); });
    };
    el.querySelectorAll('.s6-item').forEach((row) => {
      const it = st.plans[m]?.items.find((x) => x.id === row.dataset.id); if (!it) return;
      const read = () => ({ price: +row.querySelector('.pi-px').value, shares: Math.floor(+row.querySelector('.pi-sh').value), date: it.fill?.date || today() });
      row.querySelector('.pi-chk').onchange = (e) => {
        if (e.target.checked) { const f = read(); if (!(f.price > 0 && f.shares > 0)) { S.msg = '請先填好實際價與股數再打勾'; render(); return; } S.msg = ''; act(() => { it.done = true; it.fill = f; }); }
        else act(() => { it.done = false; delete it.fill; });
      };
      row.querySelectorAll('.s6-fill input').forEach((inp) => { inp.onchange = () => { if (it.done) { const f = read(); if (f.price > 0 && f.shares > 0) act(() => { it.fill = f; }); else render(); } }; });
    });
    const ag = el.querySelector('#ad-go'); if (ag) ag.onclick = () => {
      const t = { id: uid(), type: el.querySelector('#ad-type').value, code: el.querySelector('#ad-code').value.trim(), shares: Math.floor(+el.querySelector('#ad-sh').value), price: +el.querySelector('#ad-px').value, date: el.querySelector('#ad-dt').value };
      if (!/^\d{4}$/.test(t.code) || !(t.shares > 0) || !(t.price > 0) || !t.date) { S.msg = '請填 4 碼代號、股數、成交價、日期'; render(); return; }
      t.name = S.data.list.find((x) => x.code === t.code)?.name || ''; S.msg = ''; act(() => { st.manual.push(t); });
    };
    el.querySelectorAll('.tr-del').forEach((b) => { b.onclick = () => act(() => { st.manual = st.manual.filter((x) => x.id !== b.dataset.id); }); });
    const mo = el.querySelector('#st-monthly'); if (mo) mo.onchange = () => { const v = +mo.value; if (v >= 1000) act(() => { st.monthly = v; }); };
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
