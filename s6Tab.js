// 策略頁「長期核心」：價值＋低波動＋趨勢（S6-U）每月定期定額的操作助手。
// 做什麼：依你的起始日與每月可投入金額，算出這個月要賣什麼、先買什麼、各買幾股；你在畫面上打勾並填實際成交價，
// 之後它會幫你記錄持股、標出該賣的股票、比較同樣的錢買 0050 的結果。
// 紀錄只存在你的瀏覽器，可匯出成檔案備份、換裝置時匯入；不會傳到伺服器。規則與回測：專案文件《全球多因子長期策略-S6U》。
import { PLAN_DEFAULTS, planMonth, applyExclude } from '/lib/s6uPlan.js';
import { RULES_VER, TIERS, tierOf, tierOk, planArgs, planTier, LEV, newState, derive, buildListInfo, makePlan, benchCompare, exportState, parseImport, uid, allTrades } from '/lib/s6uState.js';

const LSK = 'wr_s6u_state_v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const px = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 100 ? v.toFixed(1) : v.toFixed(2));
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const cls = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');

export function createS6Tab({ api, el }) {
  const S = { loading: false, error: '', data: null, loaded: false, st: null, which: 'final', storeOk: true, msg: '', openMore: false, txtOpen: false };
  try { const raw = localStorage.getItem(LSK); if (raw) S.st = parseImport(raw); } catch (e) { if (e && e.message && !/storage|denied/i.test(e.message)) S.msg = '瀏覽器裡的舊紀錄讀不出來（' + e.message + '），請用「匯入」還原備份。'; }
  // 簡介的展開狀態（toggle 不會往上傳，用捕獲階段在外層接）
  el.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches('details.s6-banner')) S.bannerOpen = e.target.open; }, true);
  function save() { try { localStorage.setItem(LSK, JSON.stringify(S.st)); S.storeOk = true; } catch { S.storeOk = false; } }

  async function load() {
    if (S.loading) return;
    S.loading = true; S.error = ''; render();
    try { S.data = await api('/api/s6u'); S.loaded = true; if (!buildListInfo(S.data, 'final', verNow())) S.which = 'preview'; }
    catch (e) { S.error = e.message || String(e); }
    finally { S.loading = false; render(); }
  }

  const verNow = () => { const v = S.st?.ver; return TIERS[v] && tierOk(S.data, v) ? v : 'base'; };
  const info = () => (S.data ? buildListInfo(S.data, S.which, verNow()) || buildListInfo(S.data, 'preview', verNow()) : null);
  const curPrice = (code) => (code === LEV.code ? S.data?.lev?.close : S.data?.list.find((x) => x.code === code)?.close);

  // ---------- 動作 ----------
  function act(fn) { fn(); save(); render(); }
  function ensurePlan(recalc) {
    const i = info(); if (!i) return;
    const m = today().slice(0, 7);
    act(() => { S.st.plans[m] = makePlan(S.st, m, i, today()); });
  }

  function render() {
    const d = S.data;
    const head = `<details class="s6-banner fold" ${S.bannerOpen ? 'open' : ''}><summary><b>長期核心</b><span class="muted small">簡介與風險（點開展開）</span></summary>每月定期定額，持有排名前 3～15 檔（依資金多寡，最多 15 檔），名次掉出才賣、不設停損。保守／平衡／進攻三個版本（都分散持有，差別在強勢股占選股分數的比重），風險由低到高；預設保守版（回測定期定額年化 <b class="num">19.3%</b>，0050 <b class="num">16.5%</b>，回撤較小）。回測有挑參數的偏差，實際請打折看；大空頭仍會跌，不保證。頁內有操作助手：算每月買幾股、先買什麼，打勾記錄成交價、標出該賣的持股、比較同樣的錢買 0050，紀錄可匯出備份。回測排除 2026；預測長期只比 0050 多 1～2 個百分點（約六成機率），大空頭仍會跌 30～45%。</details>`;
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
    const flag = planTier({ list: i.list, holdings: dv.positions.map((p) => ({ code: p.code, shares: p.shares, px: p.cost / p.shares })), cash: dv.cash, st, ver: verNow(), levPrice: S.data.lev?.close });
    const rankOf = new Map(applyExclude(i.list, st.exclude).map((x) => [x.code, x.rank]));
    const cmp = benchCompare(st, S.data.bench, total);
    const plan = st.plans[m], dep = st.deposits[m];
    const fin = buildListInfo(S.data, 'final', verNow());
    const hero = `<section class="s6-hero"><div class="s6-hl">總資產（持股市值＋現金）</div><div class="s6-big num">${n0(total)}<small>元</small></div>
      <div class="s6-sub num"><span>持股 ${n0(mv)}</span><span>現金 ${n0(dv.cash)}</span><span>累計投入 ${n0(dv.invested)}</span>${dv.withdrawn > 0 ? `<span>已領出 ${n0(dv.withdrawn)}</span>` : ''}${dv.invested > 0 ? `<span class="${cls(total + dv.withdrawn - dv.invested)}">損益 ${n0(total + dv.withdrawn - dv.invested)}（${pct((total + dv.withdrawn) / dv.invested - 1)}）</span>` : ''}${dv.realized ? `<span class="${cls(dv.realized)}">已實現損益 ${n0(dv.realized)}</span>` : ''}${cmp ? `<span>同樣的錢買 0050：${pct(cmp.benchRet)}</span>` : ''}</div>
      <div class="s6-addmoney"><label>新投入／領出（元，領出填負數；領出不會讓損益變負，會另外列「已領出」）<input id="fl-amt" type="number" step="1000" value="${st.monthly}"></label><button class="refresh" id="fl-go" type="button">加入現金</button><button class="ghost" id="rs-top" type="button" title="清除全部紀錄，回到一開始重新填開始日、每月投入、現金與持股">重新設定（歸零）</button></div>
      <div class="s6-sub s6-hint"><span>總資產由系統自動算：持股用最新收盤估值＋現金。你的成本是「打勾時填的實際成交價」，賣出損益用你填的賣出價，不是上面預估價。</span></div></section>`;
    const need = dep == null
      ? `<div class="s6-deposit"><label>${m} 本月投入（元）<input id="dp-amt" type="number" min="0" step="1000" value="${st.monthly}"></label><button class="refresh" id="dp-go" type="button">入帳並產生清單</button></div>` : '';
    const lsel = `<select id="ls-sel" class="select" aria-label="採用哪份名單"><option value="final" ${S.which === 'final' ? 'selected' : ''} ${fin ? '' : 'disabled'}>月底正式名單${fin ? '（' + esc(fin.month) + '）' : '（尚無）'}</option><option value="preview" ${S.which === 'preview' ? 'selected' : ''}>今日預覽（${esc(S.data.asof)}）</option></select>`;
    const V = verNow();
    const TXT = {
      base: '<b>保守</b>：價值、低波動、趨勢各占 1/3（強勢股只占 1/3），最多持有 15 檔。回測（2009～2025，排除 2026，每月定期定額；下面是最多 10 檔的舊數字，同一模擬改成最多 15 檔約多 0.6 個百分點、最大回撤 −17%→−15%）年化 <b class="num">19.3%</b>、波動 14%、最大回撤 <b class="num">−19%</b>，最差連續 12 個月 −13%。對照 0050：16.5%／波動 18%／回撤 −29%／最差 12 個月 −24%。2009～2017 年化 16.2%（0050 10.7%）；2018～2025 年化 22.2%，<b>略輸 0050 的 23.5%</b>，但波動與回撤小很多。報酬大致與 0050 相當到小贏、風險大降。',
      R: '<b>平衡</b>（2026-11-13 改版）：趨勢（6 個月動能、接近 12 月高點、站上均線）占分數一半，價值占 1/4，低波動與<b>「近 3 個月每股盈餘成長」</b>各占 1/8，最多持有 15 檔；<b>2026-11-14 起先排除「營收加速度」最差的 10%</b>（營收加速度＝近 3 個月營收年增率，比 3 個月前增加或減少多少；排除後才排名，已持有被排除者會標賣出；金融股營收波動大，常被排除）；不再用產業加分，名單較不會擠在同一產業（回測單一產業平均占 30%，舊版 41%）。回測年化 <b class="num">26.5%</b>（最多 10 檔的舊數字；同一模擬改成最多 15 檔，年化 25.1%→22.9%、擾動後的結果範圍 3.2→2.2 個百分點、最大回撤 −21%→−20%，即報酬少約 2 個百分點換較不靠運氣）、波動 22%、最大回撤 <b class="num">−21%</b>，最差連續 12 個月 −19%；2009～2017 年化 19.6%（0050 10.7%）、2018～2025 年化 33.1%（0050 23.5%）；手續費加倍 24.2%。<b>營收濾網的回測</b>（同一模擬）：最多 15 檔 22.9%→27.0%（前半 20.1→24.5、後半 25.5→30.5、手續費加倍 19.9→23.7、回撤 −20%→−20%）；舊 10 檔規則 25.1%→26.7%（後半 31.3→30.3、回撤 −21%→−26%）；隨機排除同比例股票 30 次，實際贏 28～30 次；2026 年 1～8 月樣本外兩種規則方向相反（太短，不能當證據）。排除 5%／10%／15%／20%／33% 結果都在 25.4～27.2% 之間，不是某個門檻的運氣，但屬看過結果後追加的測試，請當作「有訊號、尚未長期驗證」。<b>限制</b>：2024、2025 與 2026 年 1～10 月都輸 0050（16%／6%／31% 對 49%／37%／63%，台積電帶動的大型股行情）；盈餘成長的訊號晚一個月才買效果就少掉大半，請在月初照名單執行。',
      A: '<b>進攻</b>（2026-11-14 改版）：<b>六成資金照平衡版名單買個股，四成買「元大台灣50正2」（00631L）</b>。每月新資金優先補不足的那一邊；正2 占比超過 45% 才賣回 40%。回測（2015-03～2025-12，正2 有真實資料的期間，每月定期定額；個股部分 10／12／15 檔）年化 <b class="num">31.8～35.5%</b>、波動 22～23%、最大回撤 <b class="num">−27～−28%</b>、最差連續 12 個月 −20%。同期單買正2：35.3%／波動 33%／回撤 −47%；0050：20.6%／回撤 −29%。2026 年 1～10 月 +69～77%（正2 +136%、0050 +63%）。<b>限制</b>：報酬大約跟正2 打平（重抽樣十年後贏正2 的機率 48%）、不是穩贏，好處是跌得比較少；2024、2025 輸 0050；如果平衡版名單未來沒有超額，會退化成年化約 27%、回撤 −37%；回測期間沒有 2008 那種大空頭（粗估 0050 −43% 時正2 約 −72%，這個配置約 −57%）。正2 是槓桿 ETF，盤整時會耗損，不適合短期要用的錢。原本「近期強勢股」的進攻算式回測報酬輸平衡版，已停用。',
    };
    const opt = (k) => `<option value="${k}" ${V === k ? 'selected' : ''} ${tierOk(S.data, k) ? '' : 'disabled'}>${TIERS[k].label}版${k === 'base' ? '（預設）' : k === 'A' ? '（含正2）' : ''}</option>`;
    const vsel = `<section class="panel s6-ver"><div class="panel-head"><strong>策略版本</strong><select id="ver-sel" class="select">${opt('base')}${opt('R')}${opt('A')}</select></div>
      <div class="s6-tiers"><div class="s6-tier ${V === 'base' ? 'on' : ''}"><b>保守</b><span class="num">強勢股 33%・回撤 −19%</span></div><div class="s6-tier ${V === 'R' ? 'on' : ''}"><b>平衡</b><span class="num">趨勢 50%＋盈餘成長＋營收濾網・回撤 −20%</span></div><div class="s6-tier ${V === 'A' ? 'on' : ''}"><b>進攻</b><span class="num">平衡名單 60%＋正2 40%・回撤 −27%</span></div></div>
      <details class="fold s6-txt" ${S.txtOpen ? 'open' : ''}><summary><b>${TIERS[V].label}版說明與回測</b><span class="muted small">（點開展開）</span></summary><div class="status">${TXT[V]}</div></details>${pickView(i, V)}</section>`;
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
    const meta = `<div class="status">${esc(tierOf(plan.ver).label)}版・依據 ${basis}・${plan.lev ? `總資產 ${n0(plan.lev.V)} 元：正2 目標 ${Math.round(plan.lev.w * 100)}%（${n0(plan.lev.target)} 元，現有 ${n0(plan.lev.held)} 元）・個股部分 ` : '總資產 '}${n0(plan.V)} 元分 ${plan.N} 檔・每檔約 ${n0(plan.target)} 元</div>`;
    if (!acts.length) {
      // 沒有可做的事：說明原因，並預告下個月存入後會買什麼
      const nxt = planTier({ list: i.list, holdings: derive(S.st).positions.map((p) => ({ code: p.code, shares: p.shares, px: p.cost / p.shares })), cash: derive(S.st).cash + S.st.monthly, st: S.st, ver: plan.ver, levPrice: S.data.lev?.close });
      const nb = nxt.buys.filter((b) => b.status === 'buy');
      const why = plan.cashBefore < 1 ? '現金不足。' : `這個月先不買：${n0(plan.V)} 元分成 ${plan.N} 檔，每檔只有約 ${n0(plan.target)} 元，不到最低單筆 ${n0(PLAN_DEFAULTS.minTicket)} 元。錢太少硬買會被手續費吃掉，也不符合回測的做法，現金留著下個月合併買（回測也是這樣）。`;
      return meta + `<div class="s6-empty"><b>今天沒有要買賣的。</b>${why}</div>` + (nb.length ? `<div class="s6-prev"><div class="s6-prevh">預告：下個月再存入 ${n0(S.st.monthly)} 元（現金約 ${n0(derive(S.st).cash + S.st.monthly)} 元），會買這 ${nb.length} 檔</div>${nb.map((b) => `<div class="s6-prevr"><span><b class="num">${esc(b.code)}</b> ${esc(b.name)} <span class="muted small">名次 ${pn(b.rank)}</span></span><span class="num">${n0(b.shares)} 股 ≈ ${n0(b.amount)} 元</span></div>`).join('')}<div class="status">名次會隨月底名單更新，這只是預覽，不是現在要買。</div></div>` : '');
    }
    const rows = acts.map((it, k) => {
      const f = it.done ? it.fill : { price: it.price, shares: it.shares };
      const badge = it.kind === 'sell' ? '<span class="s6-b sell">賣</span>' : it.isNew ? '<span class="s6-b new">買</span>' : '<span class="s6-b add">加碼</span>';
      return `<div class="s6-item ${it.done ? 'done' : ''} ${it.kind}" data-id="${esc(it.id)}">
        <label class="s6-chk"><input type="checkbox" class="pi-chk" ${it.done ? 'checked' : ''} aria-label="${it.kind === 'sell' ? '已賣出' : '已買入'} ${esc(it.code)}"><span class="s6-step num">${k + 1}</span></label>
        <div class="s6-main"><div class="s6-name">${badge} <b class="num">${esc(it.code)}</b> ${esc(it.name)} <span class="muted small">${it.ind ? esc(it.ind) + '・' : ''}名次 ${(it.lev ? '正2' : pn(it.rank))}</span>${it.pinned ? ' <span class="s6-b pin">你指定</span>' : ''}${it.kind === 'buy' && !it.done && !it.pinned ? ` <button class="ghost s6-x pk-ex" data-code="${esc(it.code)}" type="button">不買這檔</button>` : ''}</div>
          <div class="s6-plan num">${it.done ? `已記錄：<b>${n0(it.fill.shares)}</b> 股 × <b>${px(it.fill.price)}</b> ＝ <b>${n0(it.fill.shares * it.fill.price)}</b> 元（你的成交價）` : `建議 <b>${n0(it.shares)}</b> 股，預估價 ${px(it.price)}（約 ${n0(it.amount)} 元）${it.reason ? ` <span class="muted small">${esc(it.reason)}</span>` : ''}`}</div></div>
        <div class="s6-fill"><label>我的${it.kind === 'sell' ? '賣出' : '買入'}價<input class="pi-px num" type="number" step="0.01" min="0" value="${f.price}"></label><label>我的股數<input class="pi-sh num" type="number" step="1" min="1" value="${f.shares}"></label></div></div>`;
    }).join('');
    return meta + `<div class="status">依序做：先賣、再買（零股交易）。買完把「我的買入價／股數」改成你真正成交的，再打勾；持股成本、現金、損益都以你填的為準。還剩 <b>${nTodo}</b> 項。</div><div class="s6-list">${rows}</div>`
      + (skips.length ? `<details class="s6-skip"><summary>另有 ${skips.length} 檔金額太小先跳過</summary><ul>${skips.map((it) => `<li><b class="num">${esc(it.code)}</b> ${esc(it.name)}（名次 ${(it.lev ? '正2' : pn(it.rank))}）</li>`).join('')}</ul></details>` : '');
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
      return `<tr class="${sell ? 's6-selltr' : ''}"><td><b class="num">${esc(p.code)}</b> ${esc(p.name)} <span class="muted small">${esc(indOf.get(p.code) || '')}</span></td><td class="num n">${n0(p.shares)}</td><td class="num n">${px(avg)}</td><td class="num n">${px(p.price)}</td><td class="num n ${cls(pl)}">${pct(pl)}</td><td class="num n">${n0(p.mv)}</td><td class="num n">${p.code === LEV.code ? '正2' : pn(r)}</td>
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
      <dt>怎麼選股</dt><dd>母體＝上市普通股、股價 ≥10、當日成交值排前 300。三個面向各自排百分位後平均：價值（本益比倒數、淨值比倒數、殖利率）、低波動（近 12 個月月報酬波動越小越好）、趨勢（6-1 月動能、距 12 個月高點、站上 10 月均線）。這三類在美、歐、日、亞太都有長期證據，不是只靠台灣資料挑出來的。平衡版另外加「近 3 個月每股盈餘成長」（用本益比與還原價反推每股盈餘的變化；盈餘成長的股票之後表現較好、盈餘衰退最多的 1/5 明顯落後，上市 2009～2025 高低組每月差 0.76 個百分點）。</dd>
      <dt>怎麼買賣（每月一次）</dt><dd>持股檔數 N＝總資產 ÷ 3,000（每檔至少 3,000 元），最少 3 檔、最多 15 檔：1 萬元 3 檔、3 萬 10 檔、4.5 萬以上 15 檔（2026-11-14 前是每檔至少 3 萬、5～10 檔；改多檔是為了分散，回測保守版 18.2%→18.8%、平衡版 25.1%→22.9%，兩者最大回撤都略小）。三個版本規則相同。名次掉到 2N 名之外或不在名單的賣出；不足 N 檔依名次補進；依名次把每檔補到「總資產 ÷ N」，單筆不到 3,000 元就跳過、現金留到下月。1 萬元第一個月通常只存現金。</dd>
      <dt>回測（2009～2025，排除 2026）</dt><dd>每月 1 萬、緩衝 2 倍（以下數字多為最多 10 檔的舊規則；改 15 檔後保守版約 +0.6pp、平衡版約 −2pp）。保守版：年化 19.3% vs 0050 定期定額 16.5%；2009～2017 為 16.2% vs 10.7%、2018～2025 為 22.2% vs 23.5%（略輸）；手續費加倍 18.1%；波動約 0050 的 0.8 倍、最大回撤 −17～−19%（0050 −29%）。<b>2026-11-13 更正</b>：先前的回測資料少了 25 個月（證交所本益比檔當時沒抓到），補齊 227 個月後重算，保守版由 20.4% 更正為 19.3%、進攻版由 25.2% 更正為 24.3%，舊平衡版由 24.4% 降到 19.6%（已改用新算式）。同一套規則只因資料多寡就差 1～5 個百分點，代表只持有 10 檔的回測數字本身誤差就有這麼大，請當成大概的範圍看。</dd>
      <dt>預測與限制</dt><dd>保守預測長期超額約 +1～2 個百分點、約六成機率贏 0050；近三年（2024～2026）0050 因台積電大漲，三個版本都落後；回測沒有 2000／2008 這樣的大空頭，大空頭同樣會跌 30～45%（推論）。名單每天由證交所公開資料＋Yahoo 還原價計算，與回測名單前 30 名重疊 28～30 檔。這不是投資建議。</dd>
      <dt>跟其他卡片</dt><dd>原本的「四因子排名」卡片（價格型因子，回測沒贏 0050）已於 2026-11-14 移除。</dd></dl></div>`;
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
    const tx = el.querySelector('details.s6-txt'); if (tx) tx.addEventListener('toggle', () => { S.txtOpen = tx.open; });
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
      // 領出記在 withdrawals（不從「累計投入」扣掉，損益＝總資產＋已領出−累計投入）；投入照舊加進當月
      S.msg = ''; act(() => { if (v < 0) (st.withdrawals ||= []).push({ date: today(), amount: -v }); else { st.deposits[m] = (st.deposits[m] || 0) + v; (st.flows ||= []).push({ date: today(), amount: v }); } const j = info(); if (j && st.plans[m]) st.plans[m] = makePlan(st, m, j, today()); });
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
    const doReset = () => { if (confirm('會把這個瀏覽器裡的長期核心紀錄全部歸零（投入、持股、成交、計畫都清掉），回到一開始重新設定。建議先到下面「備份與設定」匯出紀錄。確定要歸零嗎？')) { try { localStorage.removeItem(LSK); } catch {} S.st = null; S.msg = ''; render(); } };
    el.querySelector('#rs-go').onclick = doReset; const rt = el.querySelector('#rs-top'); if (rt) rt.onclick = doReset;
    bindImport();
  }

  return { load, render, get loaded() { return S.loaded; }, get loading() { return S.loading; } };
}
