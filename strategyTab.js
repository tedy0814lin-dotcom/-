// 策略頁：把所有「有規則、有回測」的策略放在同一頁。上面是策略總覽卡片（點選切換），下面是該策略的內容。
// 子頁沿用原本的模組：Claude 突破（claudeTab）、維加斯通道（vegasTab）、台股大單推升（pickTab）；底部型態早進場在「型態」頁。
import { createClaudeTab } from '/claudeTab.js';
import { createVegasTab } from '/vegasTab.js';
import { createPickTab } from '/pickTab.js';
import { createFootTab } from '/footTab.js';
import { createS6Tab } from '/s6Tab.js';

const LS = 'wr_strat_sub';
const CARDS = [
  { id: 's6', mk: '台股', tf: '月線・長期', side: '做多', by: 'Claude 設計', title: '三因子長期投資', sub: '價值＋低波動＋趨勢',
    note: '每月定期定額，買排名前面的股票、掉出名單才賣，不設停損。',
    stats: [['定期定額年化（2009～2025）', '+18.8%'], ['0050 同樣定期定額', '+16.5%'], ['最大回撤', '−18%（0050 −29%）'], ['驗證期（2018～2025）', '23.8% vs 23.5%（約平手）']],
    doc: [
      { h: '進場規則', li: ['每月月初投入固定金額（定期定額），照當月名單買進。', '持股數看資金：夠就買滿 15 檔，不夠就減檔，每檔至少約 3,000 元、最少 3 檔，每檔等權。', '名單排名有三個版本：保守＝價值、低波動、趨勢各占 1/3；平衡＝趨勢 1/2、價值 1/4、低波動與近 3 個月每股盈餘成長各 1/8，並先排除營收加速度最差的 10%；進攻＝平衡名單 60%＋「元大台灣50正2」（00631L）40%。', '新資金優先補買不足的檔數。'] },
      { h: '出場規則', li: ['名次掉到持股數 2 倍以外才賣（緩衝帶，避免來回換股）。', '不設停損，不因短期下跌賣出。', '進攻版：正2 占比超過 45% 時，才賣回 40%。'] },
      { h: '策略原理', li: ['價值、低波動、趨勢是長期有研究支持的選股因子，三者合併排名，不押單一風格，也不用猜哪個因子今年有效。', '每月依排名汰弱留強；定期定額把進場時間分散，不必判斷高低點。', '平衡版把趨勢權重拉高並加入盈餘與營收條件，是回測表現較好的版本；進攻版再加槓桿 ETF 放大報酬與風險。'] },
      { h: '提醒', li: ['長期只預期比 0050 多 1～2 個百分點（約六成機率），大空頭仍會跌 30～45%。', '回測有挑參數的偏差，請打折看；2024、2025 年平衡版輸 0050（大型權值股行情）。', '營收濾網是看過結果後追加的測試，屬「有訊號、尚未長期驗證」。', '正2 是槓桿 ETF，盤整時會耗損，不適合短期要用的錢。'] },
    ] },
  { id: 'cs', mk: '加密', tf: '日線', side: '做多', by: 'Claude 設計', title: '大陽線突破新高',
    note: '大陽線＋創 55 日新高＋爆量，BTC 站上 50 日線才進場，用寬追蹤停損抱波段。',
    stats: [['年化', '+49%'], ['驗證期年化', '+23%'], ['最大回撤', '−45%'], ['勝率', '24%']],
    doc: [
      { h: '進場規則', li: ['同一根日 K 同時成立：大陽線（收盤−開盤 ≥ 1 倍 ATR14）、收盤 ≥ 前 55 天最高價、成交額 ≥ 前 20 天平均的 1.5 倍。', '大盤濾網：BTC 收盤在 50 日線上才開新倉。', '隔天開盤進場。'] },
      { h: '出場規則', li: ['初始停損：訊號那根 K 的最低點。', '之後改追蹤停損＝進場後最高收盤 − 7×ATR14，只往上移；BTC 跌破 50 日線時收緊成 2.5×ATR。', '不設獲利目標，碰到停損才出場。', '部位：每筆最多虧總資金 1%、單檔 ≤ 25%、最多同時 10 檔。'] },
      { h: '策略原理', li: ['價格創新高、又帶量收大陽線，代表有資金強勢進場，常是大波段的開頭。', '勝率只有約 24%：多數單子小賠，靠少數大波段賺回來，所以停損放寬、不設目標。', 'BTC 大盤濾網用來避開空頭裡的假突破。'] },
      { h: '提醒', li: ['數字是用幣安資料回測，改用 BingX 資料後尚未重驗。', '最大回撤 −45%，勝率低，連續虧損是常態；驗證期年化 +23% 低於全期 +49%。'] },
    ] },
  { id: 'vg', mk: '加密＋台股', tf: '15 分～日線', side: '多空', by: '你的規則', title: '維加斯通道',
    note: '價格回踩 EMA 通道、突破確認後進場，每檔依共振與歷史勝率打 0–100 分。',
    stats: [['加密', '15分/1H/4H'], ['台股', '15分/1H/日線'], ['台股日線大通道（排除2026）', '+0.07～+0.12R（含 0）'], ['台股日線全部（排除2026）', '−0.05R']],
    doc: [
      { h: '進場規則（做多，做空全部反過來）', li: ['前提：小通道（EMA144／169）整條在大通道（EMA288／338）之上，最近 30 根都維持、大通道往上、兩通道有拉開。', '① 價格回到通道（碰小通道或大通道）。', '② 第一次收盤站上 EMA12（突破 K）。', '③ 回踩 EMA12 有拒絕（下影線或收紅、收在 EMA12 之上）。', '④ 價格突破「突破 K」的高點＝確認，進場。'] },
      { h: '出場規則', li: ['停損：回踩低點再下 0.1 倍 ATR。', '目標：碰通道前 60 根內的最高價；若沒有高於進場價，就用 2 倍風險（風報比 1:2）。'] },
      { h: '策略原理', li: ['趨勢裡價格回測均線通道後順勢再起，通道提供支撐，停損點明確。', '訊號分數：確認 50／回踩完成 35／突破 EMA12 25／碰通道 10 為底，再加減大時區共振、這檔歷史勝率（±20）、風報比 ≥2、主動買賣與帶量；分數只加減經回測有效的條件。'] },
      { h: '提醒', li: ['2026-11-12 用 1,943 檔台股日線重測（排除 2026）：做多全部 −0.05R，「大通道」子集 +0.07～+0.12R 但區間含 0、後半段轉負；原本卡片的 +0.55R 沒有重現，已拿掉大通道加分。', '其他台股加減分（通道距離）尚未重驗；台股日線沒有穩定優勢，當看圖輔助即可。'] },
    ] },
  { id: 'pk', mk: '台股', tf: '日線', side: '做多', by: '台股選股', title: '大單推升',
    note: '每筆平均成交股數暴增、當日大漲、站上月線：少數大戶在買，隔天開盤買。',
    stats: [['回測筆數（上櫃）', '1,178'], ['每筆平均', '+2.25%'], ['勝過隨機基準', '+1.47%（含 0）'], ['勝率', '32%']],
    doc: [
      { h: '進場規則', li: ['選股條件（收盤後）：每筆平均成交股數 ≥ 平常的 1.5 倍（成交筆數沒變多）、當天收盤漲超過 4%、站上 20 日線、近 5 日均量 ≥ 500 張。', '名單已先排除「簡易 MACD 頂背離」的股票。', '隔天開盤買；開盤比昨日收盤高超過 5% 不買，漲停鎖死買不到就跳過，不追價；每日最多 3 檔。'] },
      { h: '出場規則', li: ['買進後收盤價跌到買價 −12% → 隔天開盤賣出。', '否則最長持有 40 個交易日，第 40 天收盤賣出。'] },
      { h: '策略原理', li: ['散戶單筆小、大戶單筆大。成交筆數沒變多、每筆股數卻突然變大，代表少數人大量買進，價格被大單推上去。', '再用收盤大漲、站上月線、流動性門檻，篩出「大單推升」的股票。'] },
      { h: '提醒', li: ['2026-11-12 用修復後的乾淨資料重測：優勢很弱（勝過隨機的區間已含 0），上市沒有優勢，只當選股參考。', '排除 2026（960 筆）：每筆比 0050 少 0.45%（13 天）／0.66%（40 天停損），後半段更差；5～10 檔投組年化 −3%～+12%，0050 +16%。', '排除頂背離後約等於 0050（每筆 ≈0、區間含 0），不是穩贏，觀察用。', '勝率只有三成多，超過一半的單子會被停損，利潤靠少數大波段。'] },
    ] },
  { id: 'fp', mk: '加密', tf: '4H', side: '多空', by: 'Claude 設計', title: 'Delta 階梯（足跡圖）',
    note: '連 2 根買盤 Delta 強、價格一階階創高，下一根開盤進、4R 出場。',
    stats: [['做多期望（BingX 近似）', '+0.15R'], ['做空期望（BingX 近似）', '+0.13R'], ['幣安真 Delta 多／空', '+0.28／+0.11R'], ['2026-11-07 重測 104 幣', '4R 出場']],
    doc: [
      { h: '進場規則', li: ['做多：連續 2 根 4H，每根都 ① 淨買 Delta 強（≥ 近 50 根平均的 2 倍）② 創新高 ③ 收紅 → 下一根 4H 開盤進場。', '做空：完全相反（連 2 根淨賣 Delta 強、創新低、收綠）。'] },
      { h: '出場規則', li: ['停損：這 2 根的最低點下緣（做空為最高點上緣）。', '目標：4R 出場，賺到風險的 4 倍就賣。'] },
      { h: '策略原理', li: ['足跡圖看每根 K 棒的主動買／賣量（Delta）。買盤一階一階把價格推高，代表買方持續吃單、賣方撐不住。'] },
      { h: '提醒', li: ['BingX 沒有主動買賣量，Delta 用 OHLCV 近似（強度約幣安真 Delta 的 55～65%），期望值比幣安真 Delta 低。'] },
    ] },
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createStrategyTab({ api, el, goto }) {
  el.innerHTML = '<div class="st-cards" id="st-cards" role="tablist" aria-label="策略"></div><div id="st-more"></div><div id="st-s6"></div><div id="st-cs" hidden></div><div id="st-vg" hidden></div><div id="st-pk" hidden></div><div id="st-fp" hidden></div>';
  const kids = {
    s6: createS6Tab({ api, el: el.querySelector('#st-s6') }),
    cs: createClaudeTab({ api, el: el.querySelector('#st-cs') }),
    vg: createVegasTab({ api, el: el.querySelector('#st-vg') }),
    pk: createPickTab({ api, el: el.querySelector('#st-pk') }),
    fp: createFootTab({ api, el: el.querySelector('#st-fp') }),
  };
  let sub = 's6';
  try { const s = localStorage.getItem(LS); if (kids[s]) sub = s; } catch {}

  function cards() {
    el.querySelector('#st-cards').innerHTML = CARDS.map((c) => `<button class="st-card${c.link ? ' st-link' : ''}" type="button" role="tab" data-sub="${c.id}" aria-selected="${c.id === sub}">
      <div class="st-top"><span class="st-title">${esc(c.title)}${c.sub ? `<span class="st-sub">${esc(c.sub)}</span>` : ''}</span><span class="st-by">${esc(c.by)}</span></div>
      <div class="st-tags"><span>${esc(c.mk)}</span><span>${esc(c.tf)}</span><span>${esc(c.side)}</span></div>
      <p>${esc(c.note)}</p>
      <dl class="st-stats">${c.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>
      </button>`).join('');
  }
  const docOpen = {};
  function more() {
    const c = CARDS.find((x) => x.id === sub), box = el.querySelector('#st-more');
    if (!c || !c.doc) { box.innerHTML = ''; return; }
    box.innerHTML = `<details class="fold st-more" ${docOpen[c.id] ? 'open' : ''}><summary><b>「${esc(c.title)}」進出場規則與原理</b><span class="muted small">（點開展開）</span></summary>${c.doc.map((s) => `<section class="st-sec${s.h === '提醒' ? ' st-warn' : ''}"><h4>${esc(s.h)}</h4><ul>${s.li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`).join('')}</details>`;
    box.querySelector('details').addEventListener('toggle', (e) => { docOpen[c.id] = e.currentTarget.open; });
  }
  function show() {
    cards();
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
