// 策略頁：把所有「有規則、有回測」的策略放在同一頁。上面是策略總覽卡片（點選切換），下面是該策略的內容。
// 子頁沿用原本的模組：Claude 突破（claudeTab）、維加斯通道（vegasTab）、台股大單推升（pickTab）；底部型態早進場在「型態」頁。
import { createClaudeTab } from '/claudeTab.js';
import { createVegasTab } from '/vegasTab.js';
import { createPickTab } from '/pickTab.js';
import { createFootTab } from '/footTab.js';
import { createS6Tab } from '/s6Tab.js';
import { watchTypeset } from '/lib/typeset.js';

const LS = 'wr_strat_sub';
const CARDS = [
  { id: 's6', cat: '核心配置', verdict: ['ok', '回測支持，打折看'], mk: '台股', tf: '月線・長期', side: '做多', by: 'Claude 設計', title: '三因子長期投資', sub: '價值＋低波動＋趨勢',
    note: ['每月定期定額，買排名前面的股票', '掉出名單才賣，不設停損'],
    stats: [['年化 保守／平衡／進攻', '18.8%／27.0%／35.1%'], ['0050 同法年化', '16.5%'], ['最大回撤（2009～2025）', '−18%／−20%／−28%'], ['年化 保守／平衡（含 2008）', '18.5%／26.3%（0050 16.0%）'], ['最大回撤（含 2008）', '−45%／−49%／約 −62%（進攻為合成粗估）'], ['保守、平衡贏 0050 的 5 年窗口（2008 起）', '12／13 個']],
    doc: [
      { h: '進場規則', li: ['每月月初投入固定金額（定期定額），照當月名單買進。', '持股數看資金：夠就買滿 15 檔，不夠就減檔，每檔至少約 3,000 元、最少 3 檔，每檔等權。', '名單排名有三個版本：保守＝價值、低波動、趨勢各占 1/3；平衡＝趨勢 1/2、價值 1/4、低波動與近 3 個月每股盈餘成長各 1/8，並先排除營收加速度最差的 10%；進攻＝平衡名單 60%＋「元大台灣50正2」（00631L）40%。', '新資金優先補買不足的檔數。'] },
      { h: '出場規則', li: ['名次掉到持股數 2 倍以外才賣（緩衝帶，避免來回換股）。', '不設停損，不因短期下跌賣出。', '進攻版：正2 占比超過 45% 時，才賣回 40%。'] },
      { h: '策略原理', li: ['價值、低波動、趨勢是長期有研究支持的選股因子，三者合併排名，不押單一風格，也不用猜哪個因子今年有效。', '每月依排名汰弱留強；定期定額把進場時間分散，不必判斷高低點。', '平衡版把趨勢權重拉高並加入盈餘與營收條件，是回測表現較好的版本；進攻版再加槓桿 ETF 放大報酬與風險。'] },
      { h: '提醒', li: ['長期只預期比 0050 多 1～2 個百分點（約六成機率），大空頭仍會跌 30～45%。', '回測有挑參數的偏差，請打折看；2024、2025 年平衡版輸 0050（大型權值股行情）。', '營收濾網是看過結果後追加的測試，屬「有訊號、尚未長期驗證」。', '正2 是槓桿 ETF，盤整時會耗損，不適合短期要用的錢。'] },
    ] },
  { id: 'cs', cat: '趨勢突破', mk: '加密', tf: '日線', side: '做多', by: 'Claude 設計', title: '大陽線突破新高',
    note: ['大陽線＋創 55 日新高＋爆量', 'BTC 站上 50 日線才進場', '用寬追蹤停損抱波段'],
    stats: [['年化', '+49%'], ['驗證期年化', '+23%'], ['最大回撤', '−45%'], ['勝率', '24%']],
    doc: [
      { h: '進場規則', li: ['同一根日 K 同時成立：大陽線（收盤−開盤 ≥ 1 倍 ATR14）、收盤 ≥ 前 55 天最高價、成交額 ≥ 前 20 天平均的 1.5 倍。', '大盤濾網：BTC 收盤在 50 日線上才開新倉。', '隔天開盤進場。'] },
      { h: '出場規則', li: ['初始停損：訊號那根 K 的最低點。', '之後改追蹤停損＝進場後最高收盤 − 7×ATR14，只往上移；BTC 跌破 50 日線時收緊成 2.5×ATR。', '不設獲利目標，碰到停損才出場。', '部位：每筆最多虧總資金 1%、單檔 ≤ 25%、最多同時 10 檔。'] },
      { h: '策略原理', li: ['價格創新高、又帶量收大陽線，代表有資金強勢進場，常是大波段的開頭。', '勝率只有約 24%：多數單子小賠，靠少數大波段賺回來，所以停損放寬、不設目標。', 'BTC 大盤濾網用來避開空頭裡的假突破。'] },
      { h: '提醒', li: ['數字是用幣安資料回測，改用 BingX 資料後尚未重驗。', '最大回撤 −45%，勝率低，連續虧損是常態；驗證期年化 +23% 低於全期 +49%。'] },
    ] },
  { id: 'vg', cat: '看圖輔助', verdict: ['no', '台股無穩定優勢'], mk: '加密＋台股', tf: '15 分～日線', side: '多空', by: '你的規則', title: '維加斯通道',
    note: ['價格回踩 EMA 通道、突破確認後進場', '每檔依共振與歷史勝率打 0～100 分'],
    stats: [['台股日線全部做多', '−0.05～+0.03R'], ['台股日線大通道子集', '+0.07～+0.12R'], ['區間（排除 2026）', '皆含 0'], ['樣本（全部／大通道）', '1,954／608 筆']],
    doc: [
      { h: '進場規則（做多，做空全部反過來）', li: ['前提：小通道（EMA144／169）整條在大通道（EMA288／338）之上，最近 30 根都維持、大通道往上、兩通道有拉開。', '① 價格回到通道（碰小通道或大通道）。', '② 第一次收盤站上 EMA12（突破 K）。', '③ 回踩 EMA12 有拒絕（下影線或收紅、收在 EMA12 之上）。', '④ 價格突破「突破 K」的高點＝確認，進場。'] },
      { h: '出場規則', li: ['停損：回踩低點再下 0.1 倍 ATR。', '目標：碰通道前 60 根內的最高價；若沒有高於進場價，就用 2 倍風險（風報比 1:2）。'] },
      { h: '策略原理', li: ['趨勢裡價格回測均線通道後順勢再起，通道提供支撐，停損點明確。', '訊號分數：確認 50／回踩完成 35／突破 EMA12 25／碰通道 10 為底，再加減大時區共振、這檔歷史勝率（±20）、風報比 ≥2、主動買賣與帶量；分數只加減經回測有效的條件。'] },
      { h: '提醒', li: ['2026-11-12 用 1,943 檔台股日線重測（排除 2026）：做多全部 −0.05R，「大通道」子集 +0.07～+0.12R 但區間含 0、後半段轉負；原本卡片的 +0.55R 沒有重現，已拿掉大通道加分。', '其他台股加減分（通道距離）尚未重驗；台股日線沒有穩定優勢，當看圖輔助即可。'] },
    ] },
  { id: 'pk', cat: '選股參考', verdict: ['mid', '觀察用，沒贏 0050'], mk: '台股', tf: '日線', side: '做多', by: '台股選股', title: '大單推升',
    note: ['每筆平均成交股數暴增、當日大漲、站上月線', '少數大戶在買，隔天開盤買'],
    stats: [['每筆贏 0050', '+0.02%'], ['90% 區間', '−1.62～+1.55'], ['投組年化 5 槽／10 槽', '+7.8%／+24.2%'], ['勝率（810 筆）', '33%']],
    doc: [
      { h: '進場規則', li: ['選股條件（收盤後）：每筆平均成交股數 ≥ 平常的 1.5 倍（成交筆數沒變多）、當天收盤漲超過 4%、站上 20 日線、近 5 日均量 ≥ 500 張。', '名單已先排除「簡易 MACD 頂背離」的股票。', '隔天開盤買；開盤比昨日收盤高超過 5% 不買，漲停鎖死買不到就跳過，不追價；每日最多 3 檔。'] },
      { h: '出場規則', li: ['買進後收盤價跌到買價 −12% → 隔天開盤賣出。', '否則最長持有 40 個交易日，第 40 天收盤賣出。'] },
      { h: '策略原理', li: ['散戶單筆小、大戶單筆大。成交筆數沒變多、每筆股數卻突然變大，代表少數人大量買進，價格被大單推上去。', '再用收盤大漲、站上月線、流動性門檻，篩出「大單推升」的股票。'] },
      { h: '提醒', li: ['2026-11-14 重跑（上櫃 2021～2025、排除 2026、現行名單 810 筆、40 天＋停損 12%）：每筆比 0050 +0.02%，90% 區間 −1.62～+1.55（含 0）；前半 +1.44%、後半 −1.41%；2024 年 −4.0%。', '投組結果隨槽數大幅跳動：5 槽年化 +7.8%（回撤 −61%）、10 槽 +24.2%（回撤 −29%），0050 +16.1%（回撤 −36%）。', '沒排除頂背離的 960 筆每筆比 0050 少 0.66%；「排除頂背離」來自大量設定搜尋，上市驗證方向不一致。上市沒有優勢，只當選股參考。', '勝率只有三成多，超過一半的單子會被停損，利潤靠少數大波段。'] },
    ] },
  { id: 'fp', cat: '訂單流', mk: '加密', tf: '4H', side: '多空', by: 'Claude 設計', title: 'Delta 階梯（足跡圖）',
    note: ['連 2 根買盤 Delta 強、價格一階階創高', '下一根開盤進場，4R 出場'],
    stats: [['做多期望（BingX 近似）', '+0.15R'], ['做空期望（BingX 近似）', '+0.13R'], ['幣安真 Delta 多／空', '+0.28／+0.11R'], ['2026-11-07 重測 104 幣', '4R 出場']],
    doc: [
      { h: '進場規則', li: ['做多：連續 2 根 4H，每根都 ① 淨買 Delta 強（≥ 近 50 根平均的 2 倍）② 創新高 ③ 收紅 → 下一根 4H 開盤進場。', '做空：完全相反（連 2 根淨賣 Delta 強、創新低、收綠）。'] },
      { h: '出場規則', li: ['停損：這 2 根的最低點下緣（做空為最高點上緣）。', '目標：4R 出場，賺到風險的 4 倍就賣。'] },
      { h: '策略原理', li: ['足跡圖看每根 K 棒的主動買／賣量（Delta）。買盤一階一階把價格推高，代表買方持續吃單、賣方撐不住。'] },
      { h: '提醒', li: ['BingX 沒有主動買賣量，Delta 用 OHLCV 近似（強度約幣安真 Delta 的 55～65%），期望值比幣安真 Delta 低。'] },
    ] },
];
// 台股策略對比表：數字都是 2026-11-14 重跑的回測（排除 2026），範圍＝不同窗口／出場設定下的最低～最高。
const CMP = [
  { grp: '核心配置（長期、每月定期定額）', rows: [
    { id: 's6', name: '三因子長期投資・保守', perf: '年化 18.8%；各 5 年窗口 6.7～29.2%', ref: '0050 年化 16.5%；各 5 年窗口 3.5～23.5%；保守贏 12／13 個窗口（2008 起算）', dd: '−18%（含 2008：−45%）；0050 −29%（含 2008：−49%）', v: ['ok', '回測支持，打折看'],
      risk: ['13 個 5 年窗口互相重疊，不是 13 次獨立驗證', '2018～2025 年化 23.8% 對 0050 23.5%，約平手', '2009 起的低回撤沒有大空頭：含 2008 回撤 −45%，與 0050 −49% 同級', '回測有挑參數的偏差'] },
    { id: 's6', name: '三因子長期投資・平衡', perf: '年化 27.0%；各 5 年窗口 11.8～45.9%', ref: '同上 0050；平衡贏 12／13 個窗口（2008 起算）', dd: '−20%（含 2008：−49%）', v: ['ok', '回測支持，打折看'],
      risk: ['營收濾網是看過結果後追加的測試，尚未長期驗證', '含 2008 回撤 −49%，與 0050 同；2008～2012 五年窗口 11.8%，沒比保守版好', '2024、2025 年輸 0050（大型權值股行情）', '手續費加倍年化降到 23.7%'] },
    { id: 's6', name: '三因子長期投資・進攻（平衡 60%＋正2 40%）', perf: '年化 35.1%；各 5 年窗口 24.2～47.4%；2015-03 起算', ref: '0050 年化 20.6%；各 5 年窗口 11.1～23.5%；單買正2 35.3%', dd: '−28%（含 2008 粗估 −62%）；單買正2 −47%', v: ['mid', '高風險高報酬'],
      risk: ['報酬約等於單買正2，好處只是跌得少一些', '回撤 −28% 只在樣本內；2008 級空頭合成粗估約 −62%（非回測）', '正2 是槓桿 ETF，盤整會耗損；估算未含個股交易成本'] },
  ] },
  { grp: '選股參考（短波段、持有最長 40 天）', rows: [
    { id: 'pk', name: '大單推升（上櫃，現行名單）', perf: '每筆平均 +1.45%；贏 0050 +0.02%；90% 區間 −1.62～+1.55，含 0；投組年化 5 槽 +7.8%；投組年化 10 槽 +24.2%', ref: '0050 年化 +16.1%；2021～2025，價格報酬', dd: '5 槽 −61%；10 槽 −29%；0050 −36%', v: ['mid', '觀察用，沒贏 0050'],
      risk: ['每筆區間含 0，勝率只有 33%', '前半 +1.44%、後半 −1.41%；2024 年 −4.0%', '5 槽與 10 槽結果差 16 個百分點，不穩', '上市沒有優勢；排除頂背離來自大量設定搜尋'] },
  ] },
  { grp: '看圖輔助（沒有穩定優勢，不當進出場訊號）', rows: [
    { id: 'vg', name: '維加斯通道（台股日線，做多）', perf: '全部做多每筆 −0.05～+0.03R；大通道子集每筆 +0.07～+0.12R；區間皆含 0；3R／4R／6R 三種出場', ref: '事件層級回測；沒有投組對 0050', dd: '—', v: ['no', '無穩定優勢'],
      risk: ['後半段：全部 −0.23～−0.31R、大通道 −0.13R，由正轉負', '2024 年 −0.14～−0.17R', '原卡片 +0.55R 無法重現；其餘台股加減分尚未重驗'] },
  ] },
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 排版：數字／範圍／正2 不在中間斷行；「；」不顯示，改成分行
const NW = /(正2|[+−-]?\d+(?:[.,]\d+)*(?:-\d+)*(?: ?(?:年|檔|槽|天|個|筆|根))?%?R?(?:～[+−-]?\d+(?:[.,]\d+)*%?R?)*(?:／\d+(?:[.,]\d+)*%?)*)/;
const fmt = (s) => String(s ?? '').replace(/；/g, '，').split(NW).map((p, i) => (i % 2 ? `<span class="nw">${esc(p)}</span>` : esc(p))).join('');
const parts = (s) => String(s ?? '').split('；').map((x) => x.trim()).filter(Boolean);
const lines = (s) => parts(s).map((x) => `<div class="cl">${fmt(x)}</div>`).join('');
const bul = (arr) => arr.flatMap(parts).map((x) => `<li>${fmt(x)}</li>`).join('');

export function createStrategyTab({ api, el, goto }) {
  el.innerHTML = '<div id="st-cmp"></div><div class="st-cards" id="st-cards" role="tablist" aria-label="策略"></div><div id="st-more"></div><div id="st-s6"></div><div id="st-cs" hidden></div><div id="st-vg" hidden></div><div id="st-pk" hidden></div><div id="st-fp" hidden></div>';
  const kids = {
    s6: createS6Tab({ api, el: el.querySelector('#st-s6') }),
    cs: createClaudeTab({ api, el: el.querySelector('#st-cs') }),
    vg: createVegasTab({ api, el: el.querySelector('#st-vg') }),
    pk: createPickTab({ api, el: el.querySelector('#st-pk') }),
    fp: createFootTab({ api, el: el.querySelector('#st-fp') }),
  };
  watchTypeset(el);
  let sub = 's6';
  try { const s = localStorage.getItem(LS); if (kids[s]) sub = s; } catch {}

  function cards() {
    el.querySelector('#st-cards').innerHTML = CARDS.map((c) => `<button class="st-card${c.link ? ' st-link' : ''}" type="button" role="tab" data-sub="${c.id}" aria-selected="${c.id === sub}">
      <div class="st-top"><span class="st-title">${esc(c.title)}${c.sub ? `<span class="st-sub">${esc(c.sub)}</span>` : ''}</span><span class="st-by">${esc(c.by)}</span></div>
      <div class="st-tags">${c.cat ? `<span class="st-cat">${esc(c.cat)}</span>` : ''}<span>${esc(c.mk)}</span><span>${esc(c.tf)}</span><span>${esc(c.side)}</span>${c.verdict ? `<span class="st-v st-v-${c.verdict[0]}">${esc(c.verdict[1])}</span>` : ''}</div>
      <p class="st-note">${[].concat(c.note).map((x) => `<span>${fmt(x)}</span>`).join('')}</p>
      <dl class="st-stats">${c.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${fmt(v)}</dd></div>`).join('')}</dl>
      </button>`).join('');
  }
  let cmpOpen = true;
  try { cmpOpen = localStorage.getItem(LS + '_cmp') !== '0'; } catch {}
  function cmp() {
    const box = el.querySelector('#st-cmp');
    const body = CMP.map((g) => `<tr class="cmp-grp"><th colspan="6">${esc(g.grp)}</th></tr>` + g.rows.map((r) => `<tr class="cmp-row" data-sub="${r.id}">
      <td data-label="策略"><b>${esc(r.name)}</b></td>
      <td data-label="回測表現（範圍）">${lines(r.perf)}</td>
      <td data-label="對照 0050">${lines(r.ref)}</td>
      <td data-label="最大回撤">${lines(r.dd)}</td>
      <td data-label="判定"><span class="st-v st-v-${r.v[0]}">${esc(r.v[1])}</span></td>
      <td data-label="隱患" class="cmp-risk"><ul>${bul(r.risk)}</ul></td></tr>`).join('')).join('');
    box.innerHTML = `<details class="fold st-cmp" ${cmpOpen ? 'open' : ''}><summary><b>台股策略對比</b><span class="muted small">回測範圍・分類・隱患（點一列跳到該策略）</span></summary>
      <div class="tbl-wrap"><table class="tbl cmp"><thead><tr><th>策略</th><th>回測表現（範圍）</th><th>對照 0050</th><th>最大回撤</th><th>判定</th><th>隱患</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="muted small cmp-note">範圍＝不同回測窗口或出場設定下的最低～最高，不是預測。2026-11-14 重跑，台股一律排除 2026（大多頭難重現）。三因子是每月定期定額 1 萬、最多 15 檔，窗口為各 5 年。大單推升為上櫃 2021～2025。R＝每筆承擔的風險單位。全部是歷史回測，會受挑參數、現存股票偏誤影響，請打折看。</p></details>`;
    box.querySelector('details').addEventListener('toggle', (e) => { cmpOpen = e.currentTarget.open; try { localStorage.setItem(LS + '_cmp', cmpOpen ? '1' : '0'); } catch {} });
    box.querySelector('tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr.cmp-row'); if (tr) { pick(tr.dataset.sub); el.querySelector('#st-cards').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  }
  const docOpen = {};
  function more() {
    const c = CARDS.find((x) => x.id === sub), box = el.querySelector('#st-more');
    if (!c || !c.doc) { box.innerHTML = ''; return; }
    box.innerHTML = `<details class="fold st-more" ${docOpen[c.id] ? 'open' : ''}><summary><b>「${esc(c.title)}」進出場規則與原理</b><span class="muted small">（點開展開）</span></summary>${c.doc.map((s) => `<section class="st-sec${s.h === '提醒' ? ' st-warn' : ''}"><h4>${esc(s.h)}</h4><ul>${bul(s.li)}</ul></section>`).join('')}</details>`;
    box.querySelector('details').addEventListener('toggle', (e) => { docOpen[c.id] = e.currentTarget.open; });
  }
  function show() {
    cards();
    if (!el.querySelector('#st-cmp details')) cmp();
    more();
    for (const k of Object.keys(kids)) el.querySelector('#st-' + k).hidden = k !== sub;
    if (kids[sub]) kids[sub].render();
  }
  function pick(id) {
    sub = id;
    try { localStorage.setItem(LS, sub); } catch {}
    show();
    if (!kids[sub].loaded && !kids[sub].loading) kids[sub].load();
  }
  el.querySelector('#st-cards').addEventListener('click', (e) => { const b = e.target.closest('.st-card'); if (b) pick(b.dataset.sub); });
  return {
    load() { show(); if (!kids[sub].loaded) kids[sub].load(); },
    render: show,
    get loaded() { return kids[sub].loaded; },
  };
}
