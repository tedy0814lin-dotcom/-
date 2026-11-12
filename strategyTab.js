// 策略頁：把所有「有規則、有回測」的策略放在同一頁。上面是策略總覽卡片（點選切換），下面是該策略的內容。
// 子頁沿用原本的模組：Claude 突破（claudeTab）、維加斯通道（vegasTab）、台股大單推升（pickTab）；底部型態早進場在「型態」頁。
import { createClaudeTab } from '/claudeTab.js';
import { createVegasTab } from '/vegasTab.js';
import { createPickTab } from '/pickTab.js';
import { createFootTab } from '/footTab.js';
import { createFactTab } from '/factTab.js';

const LS = 'wr_strat_sub';
const CARDS = [
  { id: 'cs', mk: '加密', tf: '日線', side: '做多', by: 'Claude 設計', title: '大陽線突破新高',
    note: '大陽線＋收盤創 55 日新高＋帶量，BTC 在 50 日線上才進場；7 倍 ATR 追蹤停損，不設獲利目標。⚠ 數字是幣安資料的回測，改用 BingX 資料後尚未重驗。',
    stats: [['年化', '+49%'], ['驗證期年化', '+23%'], ['最大回撤', '−45%'], ['勝率', '24%']] },
  { id: 'vg', mk: '加密＋台股', tf: '15 分～日線', side: '多空', by: '你的規則', title: '維加斯通道',
    note: '價格回踩 EMA 通道、突破確認後進場；每檔依多時區共振、歷史勝率、風報比打 0–100 分，分數只加減經回測有效的條件。⚠ 2026-11-12 用 1,943 檔台股日線重測（排除 2026）：做多全部 −0.05R，「大通道」子集 +0.07～+0.12R 但區間含 0、後半段轉負，原本卡片的 +0.55R 沒有重現，已拿掉大通道加分；其他台股加減分（通道距離）尚未重驗。',
    stats: [['加密', '15分/1H/4H'], ['台股', '15分/1H/日線'], ['台股日線大通道（排除2026）', '+0.07～+0.12R（含 0）'], ['台股日線全部（排除2026）', '−0.05R']] },
  { id: 'pk', mk: '台股', tf: '日線', side: '做多', by: '台股選股', title: '大單推升',
    note: '每筆平均成交股數暴增＋當日大漲＋站上月線：少數大戶在買，不是散戶搶進；隔天開盤買。⚠ 2026-11-12 用修復後的乾淨資料重測：優勢很弱（勝過隨機的區間已含 0），上市沒有優勢，只當選股參考。',
    stats: [['回測筆數（上櫃）', '1,178'], ['每筆平均', '+2.25%'], ['勝過隨機基準', '+1.47%（含 0）'], ['勝率', '32%']] },
  { id: 'fp', mk: '加密', tf: '4H', side: '多空', by: 'Claude 設計', title: 'Delta 階梯（足跡圖）',
    note: '足跡圖訂單流：連 2 根 Delta 強＋價格一階階創高(低)＝買盤堆疊；下一根開盤進、4R 出場。BingX 沒有主動買賣量，Delta 用 OHLCV 近似（強度約幣安真 Delta 的 55～65%）。',
    stats: [['做多期望（BingX 近似）', '+0.15R'], ['做空期望（BingX 近似）', '+0.13R'], ['幣安真 Delta 多／空', '+0.28／+0.11R'], ['2026-11-07 重測 104 幣', '4R 出場']] },
];
CARDS.push({ id: 'fa', mk: '台股', tf: '日線', side: '做多', by: 'Claude 設計', title: '四因子排名（觀察用）',
  note: '近 250 日高＋120 日動能＋日內強＋量增，四個百分位平均，前 20 名等權、每 20 日換股。⚠ 2026-11-12 用排除 2026 的資料重測：2022～2023 贏 0050、2024～2025 輸 0050，全期沒贏；單因子 IC 只有「近 250 日高」顯著。有倖存者偏誤，所以只當觀察，從上線日起做前瞻記錄；不是買賣訊號。',
  stats: [['年化（排除 2026）', '+17.9%'], ['0050 同期', '+19.4%'], ['2022～23 對 0050', '+13.0% vs −3.3%'], ['2024～25 對 0050', '+23.4% vs +48.7%']] });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createStrategyTab({ api, el, goto }) {
  el.innerHTML = '<div class="st-cards" id="st-cards" role="tablist" aria-label="策略"></div><div id="st-cs"></div><div id="st-vg" hidden></div><div id="st-pk" hidden></div><div id="st-fp" hidden></div><div id="st-fa" hidden></div>';
  const kids = {
    cs: createClaudeTab({ api, el: el.querySelector('#st-cs') }),
    vg: createVegasTab({ api, el: el.querySelector('#st-vg') }),
    pk: createPickTab({ api, el: el.querySelector('#st-pk') }),
    fp: createFootTab({ api, el: el.querySelector('#st-fp') }),
    fa: createFactTab({ api, el: el.querySelector('#st-fa') }),
  };
  let sub = 'cs';
  try { const s = localStorage.getItem(LS); if (kids[s]) sub = s; } catch {}

  function cards() {
    el.querySelector('#st-cards').innerHTML = CARDS.map((c) => `<button class="st-card${c.link ? ' st-link' : ''}" type="button" role="tab" data-sub="${c.id}" aria-selected="${c.id === sub}">
      <div class="st-top"><span class="st-title">${esc(c.title)}</span><span class="st-by">${esc(c.by)}</span></div>
      <div class="st-tags"><span>${esc(c.mk)}</span><span>${esc(c.tf)}</span><span>${esc(c.side)}</span></div>
      <p>${esc(c.note)}</p>
      <dl class="st-stats">${c.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>
      </button>`).join('');
  }
  function show() {
    cards();
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
