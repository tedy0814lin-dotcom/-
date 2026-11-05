// 策略頁：把所有「有規則、有回測」的策略放在同一頁。上面是策略總覽卡片（點選切換），下面是該策略的內容。
// 子頁沿用原本的模組：Claude 突破（claudeTab）、維加斯通道（vegasTab）、台股大單推升（pickTab）；底部型態早進場在「型態」頁。
import { createClaudeTab } from '/claudeTab.js';
import { createVegasTab } from '/vegasTab.js';
import { createPickTab } from '/pickTab.js';
import { createFootTab } from '/footTab.js';

const LS = 'wr_strat_sub';
const CARDS = [
  { id: 'cs', mk: '加密', tf: '日線', side: '做多', by: 'Claude 設計', title: '大陽線突破新高',
    note: '大陽線＋收盤創 55 日新高＋帶量，BTC 在 50 日線上才進場；7 倍 ATR 追蹤停損，不設獲利目標。',
    stats: [['年化', '+49%'], ['驗證期年化', '+23%'], ['最大回撤', '−45%'], ['勝率', '24%']] },
  { id: 'vg', mk: '加密＋台股', tf: '15 分～日線', side: '多空', by: '你的規則', title: '維加斯通道',
    note: '價格回踩 EMA 通道、突破確認後進場；每檔依多時區共振、歷史勝率、風報比打 0–100 分，分數只加減經回測有效的條件。',
    stats: [['加密', '15分/1H/4H'], ['台股', '15分/1H/日線'], ['台股大通道', '+0.55R'], ['隨機做多', '+0.20R']] },
  { id: 'pk', mk: '台股', tf: '日線', side: '做多', by: '台股選股', title: '大單推升',
    note: '每筆平均成交股數暴增＋當日大漲＋站上月線：少數大戶在買，不是散戶搶進；隔天開盤買。',
    stats: [['回測筆數', '1,114'], ['每筆平均', '+2.45%'], ['勝過同日平均', '+2.36%'], ['勝率', '33%']] },
  { id: 'fp', mk: '加密', tf: '4H', side: '多空', by: 'Claude 設計', title: 'Delta 階梯（足跡圖）',
    note: '足跡圖訂單流：連 2 根主動買(賣)Delta 強＋價格一階階創高(低)＝買盤堆疊；下一根開盤進、4R 出場。',
    stats: [['做多期望', '+0.26R'], ['做空期望', '+0.13R'], ['配大陽線突破', '+61%'], ['單用回撤', '−49%']] },
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createStrategyTab({ api, el, goto }) {
  el.innerHTML = '<div class="st-cards" id="st-cards" role="tablist" aria-label="策略"></div><div id="st-cs"></div><div id="st-vg" hidden></div><div id="st-pk" hidden></div><div id="st-fp" hidden></div>';
  const kids = {
    cs: createClaudeTab({ api, el: el.querySelector('#st-cs') }),
    vg: createVegasTab({ api, el: el.querySelector('#st-vg') }),
    pk: createPickTab({ api, el: el.querySelector('#st-pk') }),
    fp: createFootTab({ api, el: el.querySelector('#st-fp') }),
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
