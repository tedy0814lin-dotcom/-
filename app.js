// 籌碼雷達前端：讀 /api 的資料，畫成卡片，提供搜尋、排序、訊號篩選
import { buildCrypto, CRYPTO_SIGNALS, cryptoSignals, cryptoScore, structSignals } from '/lib/cryptoCore.js';
import { fetchExchanges, mergeExchanges, normBase, EXCHANGES } from '/lib/exchanges.js';
import { CATS, classify } from '/lib/categories.js';
import { createTrustTab } from '/trustTab.js';

const TW_SIGNALS = {
  dBoxLong:    { label: '日線大箱底做多', dir: 1, alert: true },
  dBoxShort:   { label: '日線大箱頂做空', dir: -1, alert: true },
  boxLong:     { label: '短箱底做多', dir: 1, alert: true },
  boxShort:    { label: '短箱頂做空', dir: -1, alert: true },
  hiBoxBreak:  { label: '高位小箱跌破', dir: -1, alert: true },
  loBoxBreak:  { label: '低位小箱突破', dir: 1, alert: true },
  pullLong:    { label: '多頭回踩箱體反彈', dir: 1, alert: true },
  pullShort:   { label: '空頭反彈箱體遇壓', dir: -1, alert: true },
  boxLongPlus: { label: '多重籌碼確認', dir: 1, alert: true },
  boxShortPlus:{ label: '多重籌碼確認', dir: -1, alert: true },
  baseBreak:   { label: '築底突破', dir: 1, alert: true },
  botTurn:     { label: '大跌後轉強啟動', dir: 1, alert: true },
  topTurn:     { label: '大漲後轉弱啟動', dir: -1, alert: true },
  topWarn:     { label: '大漲後高位警戒', dir: -1, alert: true },
  boxBreakDown:{ label: '整理後跌破', dir: -1, alert: true },
  stealthBuy:  { label: '法人逆勢偷買', dir: 1, alert: true },
  stealthSell: { label: '法人逢高偷賣', dir: -1, alert: true },
  macdBull2:   { label: '日線 MACD 持續底背離', dir: 1, alert: true },
  macdBear2:   { label: '日線 MACD 持續頂背離', dir: -1, alert: true },
  macdBull:    { label: '日線 MACD 底背離', dir: 1 },
  macdBear:    { label: '日線 MACD 頂背離', dir: -1 },
  coilUp:      { label: '築底吸籌', dir: 1, alert: true },
  coilDown:    { label: '高檔出貨', dir: -1, alert: true },
  trustBuy:    { label: '投信連買', dir: 1 },
  foreignBuy:  { label: '外資連買', dir: 1 },
  bothBuy:     { label: '土洋同買', dir: 1 },
  concentrate: { label: '籌碼集中', dir: 1 },
  bigRatio:    { label: '法人買超佔量大', dir: 1 },
  trustSell:   { label: '投信連賣', dir: -1 },
  foreignSell: { label: '外資連賣', dir: -1 },
  shortUp:     { label: '融券大增', dir: 0 },
};

const SORTS = {
  crypto: [
    ['cat', '機會強度（分類）'],
    ['score', '大戶動能分數'],
    ['patFirst', '轉折／突破訊號優先'],
    ['coilFirst', '蓄力警報優先'],
    ['oiChg24', '持倉 24h 增幅'],
    ['oiChgAbs', '持倉 24h 變化（絕對值）'],
    ['topLSChg', '大戶多空比上升'],
    ['funding', '資金費率（高→低）'],
    ['fundingLow', '資金費率（低→高）'],
    ['cvdRatio', 'CVD 淨買入（佔成交額）'],
    ['cvdLow', 'CVD 淨賣出（佔成交額）'],
    ['taker', '主動買賣比'],
    ['vol24', '24h 成交額'],
    ['chg24', '24h 漲幅'],
  ],
  tw: [
    ['cat', '機會強度（分類）'],
    ['total', '三大法人今日買超'],
    ['patFirst', '轉折／突破訊號優先'],
    ['coilFirst', '築底警報優先'],
    ['ratio5', '法人 5 日買超佔量'],
    ['total5', '三大法人 5 日買超'],
    ['trust', '投信今日買超'],
    ['trustStreak', '投信連買天數'],
    ['foreign', '外資今日買超'],
    ['foreignStreak', '外資連買天數'],
    ['ratio', '法人買超佔量'],
    ['marginDrop', '融資減少最多'],
    ['totalLow', '三大法人今日賣超'],
  ],
};

const $ = (id) => document.getElementById(id);
const state = {
  tab: 'crypto',
  data: { crypto: null, tw: null },
  loading: { crypto: false, tw: false },
  error: { crypto: '', tw: '' },
  filter: new Set(),
  q: '',
  sort: { crypto: 'cat', tw: 'cat' },
  cat: null,
  xchg: null,
  xchgLoading: false,
  limit: 60,
};

try {
  const saved = JSON.parse(localStorage.getItem('wr_prefs') || '{}');
  if (['tw', 'crypto', 'trust'].includes(saved.tab)) state.tab = saved.tab;
  if (saved.sort && saved.v === 2) Object.assign(state.sort, saved.sort);
} catch {}
function savePrefs() {
  try { localStorage.setItem('wr_prefs', JSON.stringify({ v: 2, tab: state.tab, sort: state.sort })); } catch {}
}

// ---------- 格式化 ----------
const nf = new Intl.NumberFormat('zh-TW');
function big(v) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}
function price(v) {
  if (v == null) return '—';
  if (v >= 1000) return nf.format(Math.round(v * 100) / 100);
  if (v >= 1) return v.toFixed(v >= 100 ? 2 : 3);
  return v.toPrecision(4);
}
const cls = (v) => (v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
const signed = (v, d = 2, unit = '') => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d) + unit);
const lotsFmt = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + nf.format(v));
const streakFmt = (s) => (s > 0 ? `連買 ${s}` : s < 0 ? `連賣 ${-s}` : '—');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeFmt = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
const dateFmt = (ymd) => `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6)}`;

function spark(values, kind) {
  if (!values || values.length < 2) return '';
  const w = 200, h = 34, pad = 3;
  if (kind === 'bars') {
    const m = Math.max(1, ...values.map(Math.abs));
    const bw = w / values.length;
    const mid = h / 2;
    const bars = values.map((v, i) => {
      const bh = (Math.abs(v) / m) * (h / 2 - pad);
      const y = v >= 0 ? mid - bh : mid;
      return `<rect x="${i * bw + bw * 0.2}" y="${y}" width="${bw * 0.6}" height="${Math.max(bh, 1)}" rx="1.5" fill="var(--${v >= 0 ? 'up' : 'down'})"/>`;
    }).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${mid}" y2="${mid}" stroke="var(--line)"/>${bars}</svg>`;
  }
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - pad - ((v - min) / span) * (h - pad * 2)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const color = values[values.length - 1] >= values[0] ? 'var(--up)' : 'var(--down)';
  const end = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${line} L${w} ${h} L0 ${h} Z" fill="${color}" opacity=".12"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    <circle cx="${end[0]}" cy="${end[1]}" r="2.5" fill="${color}"/></svg>`;
}

function tags(list, dict) {
  if (!list.length) return '';
  return `<div class="tags">${list.map((k) => {
    const s = dict[k]; const c = s.dir > 0 ? 'up' : s.dir < 0 ? 'down' : '';
    return `<span class="tag ${c}">${s.label}</span>`;
  }).join('')}</div>`;
}

const metric = (k, v, d = '', vc = '') =>
  `<div class="m"><div class="k">${k}</div><div class="v ${vc}">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;

// ---------- 分類 ----------
const dictOf = (tab) => (tab === 'crypto' ? CRYPTO_SIGNALS : TW_SIGNALS);
function classifyAll(tab) {
  const d = state.data[tab];
  if (!d) return;
  for (const r of d.rows) classify(r, dictOf(tab));
}
function catBadge(r) {
  if (!r.cat) return '';
  const c = CATS[r.cat];
  return `<span class="cat cat-${r.cat} lv-${r.catLevel === '強' ? 3 : r.catLevel === '中' ? 2 : 1}">${c.label}<b>${r.catLevel}</b></span>`;
}
function catBlock(r, why) {
  const lines = [];
  if (r.cat) lines.push(`<div class="why why-pat"><span class="muted">依據</span> ${r.catWhy.map(esc).join('・')}</div>`);
  if (why && why.length) lines.push(`<div class="why">${why.map(esc).join('・')}</div>`);
  if (r.catConflict?.length) lines.push(`<div class="why warn-text">注意：同時有${r.catConflict.map(esc).join('、')}的訊號，方向打架</div>`);
  if (r.otherSignals?.length) lines.push(`<div class="why"><span class="muted">其他</span> ${r.otherSignals.map(esc).join('・')}</div>`);
  return lines.join('');
}

// ---------- 卡片 ----------
function cryptoCard(r) {
  return `<article class="card">
    <div class="card-head">
      <span class="sym">${esc(r.base)}</span>
      ${catBadge(r)}
      <div class="price"><span class="p num">${price(r.price)}</span><span class="c num ${cls(r.chg24)}">${signed(r.chg24, 2, '%')}</span></div>
    </div>
    <div class="metrics">
      ${r.oiAll ? metric(`全市場持倉`, '$' + big(r.oiAll), `<span class="${cls(r.oiChg24)}">24h ${signed(r.oiChg24, 1, '%')}</span> <span class="muted">${r.oiSources}所</span>`)
        : metric('持倉量（幣安）', '$' + big(r.oi), `<span class="${cls(r.oiChg24)}">24h ${signed(r.oiChg24, 1, '%')}</span>`)}
      ${metric('24h 振幅', r.range24 == null ? '—' : r.range24.toFixed(1) + '%', `持倉 4h <span class="${cls(r.oiChg4)}">${signed(r.oiChg4, 1, '%')}</span>`)}
      ${metric(r.fundingAll != null ? '資金費率（加權）' : '資金費率', signed(r.funding, 4, '%'), r.fundingMax && r.fundingMin && r.fundingMax.ex !== r.fundingMin.ex ? `${esc(r.fundingMin.ex)} ${signed(r.fundingMin.funding, 3)} ~ ${esc(r.fundingMax.ex)} ${signed(r.fundingMax.funding, 3)}` : '', r.funding >= 0.05 ? 'up' : r.funding <= -0.03 ? 'down' : '')}
      ${metric('大戶多空比', r.topLS.toFixed(2), `<span class="${cls(r.topLSChg)}">24h ${signed(r.topLSChg, 2)}</span>`)}
      ${metric('散戶多空比', r.globalLS.toFixed(2), `<span class="${cls(r.globalLSChg)}">24h ${signed(r.globalLSChg, 2)}</span>`)}
      ${metric('CVD 24h', r.cvd24 == null ? '—' : (r.cvd24 >= 0 ? '+$' : '-$') + big(Math.abs(r.cvd24)), `<span class="${cls(r.cvdRatio)}">${signed(r.cvdRatio, 1, '%')}</span> 買賣比 ${r.taker == null ? '—' : r.taker.toFixed(2)}`, cls(r.cvd24))}
    </div>
    <div class="spark-row"><span class="k">持倉 24h</span>${spark(r.spark)}</div>
    ${r.cvdSpark && r.cvdSpark.length > 1 ? `<div class="spark-row"><span class="k">CVD 24h</span>${spark(r.cvdSpark)}</div>` : ''}
    ${r.exList ? `<div class="xline"><span class="k">持倉分布</span>${r.exList.filter((v) => v.share != null).slice(0, 5).map((v) => `<span>${esc(v.ex)} <b class="num">${v.share.toFixed(0)}%</b></span>`).join('')}</div>` : ''}
    ${catBlock(r, [...(r.boxWhy || []), ...(r.patWhy || []), ...(r.coilWhy || [])])}
  </article>`;
}

function twCard(r) {
  return `<article class="card">
    <div class="card-head">
      <span class="sym num">${esc(r.code)}</span>
      <span class="sub">${esc(r.name)}</span>
      ${catBadge(r)}
      <div class="price"><span class="p num">${r.close == null ? '—' : price(r.close)}</span><span class="c num ${cls(r.chg)}">${signed(r.chg, 2, '%')}</span><span class="c num ${cls(r.chg5)}">5 日 ${signed(r.chg5, 1, '%')}</span></div>
    </div>
    <div class="metrics">
      ${metric('外資', lotsFmt(r.foreign), streakFmt(r.foreignStreak), cls(r.foreign))}
      ${metric('投信', lotsFmt(r.trust), streakFmt(r.trustStreak), cls(r.trust))}
      ${metric('自營商', lotsFmt(r.dealer), '', cls(r.dealer))}
      ${metric('法人 5 日', lotsFmt(r.total5), '', cls(r.total5))}
      ${metric('融資增減', lotsFmt(r.marginChg), r.marginBal != null ? `餘 ${nf.format(r.marginBal)}` : '', cls(r.marginChg))}
      ${metric('融券增減', lotsFmt(r.shortChg), r.shortBal != null ? `餘 ${nf.format(r.shortBal)}` : '', cls(r.shortChg))}
    </div>
    <div class="spark-row"><span class="k">法人 5 日</span>${spark(r.trend, 'bars')}<span class="k num">${r.ratio == null ? '' : '佔量 ' + r.ratio.toFixed(0) + '%'}</span></div>
    ${catBlock(r, [...(r.boxWhy || []), ...(r.patWhy || [])])}
  </article>`;
}

// ---------- 排序與篩選 ----------
function sortRows(rows) {
  const key = state.sort[state.tab];
  const get = {
    cat: (r) => ({ 強: 3, 中: 2, 弱: 1 }[r.catLevel] || 0) * 1e5 + (r.catScore || 0) * 1000 + (r.score ?? Math.abs(r.total5 ?? 0) / 1e6),
    oiChgAbs: (r) => Math.abs(r.oiChg24 ?? 0),
    fundingLow: (r) => -(r.funding ?? 0),
    totalLow: (r) => -r.total,
    marginDrop: (r) => -(r.marginChg ?? 0),
    cvdLow: (r) => -(r.cvdRatio ?? 0),
    patFirst: (r) => (r.signals.some((k) => ['baseBreak', 'botTurn', 'topTurn', 'topWarn', 'boxBreakDown', 'dBoxLong', 'dBoxShort', 'boxLong', 'boxShort', 'hiBoxBreak', 'loBoxBreak', 'pullLong', 'pullShort'].includes(k)) ? 1e9 : 0) + (r.score ?? Math.abs(r.total5 ?? 0)),
    coilFirst: (r) => (r.signals.some((k) => k.startsWith('coil')) ? 1e9 : 0) + (r.score ?? r.ratio5 ?? 0),
  }[key] || ((r) => r[key] ?? -Infinity);
  return [...rows].sort((a, b) => get(b) - get(a));
}

function visibleRows() {
  const d = state.data[state.tab];
  if (!d) return [];
  const q = state.q.trim().toUpperCase();
  let rows = d.rows;
  if (q) rows = rows.filter((r) => (r.base || r.code).toUpperCase().includes(q) || (r.name || '').includes(state.q.trim()));
  if (state.cat) rows = rows.filter((r) => r.cat === state.cat);
  return sortRows(rows);
}

// ---------- 畫面 ----------
function renderChips() {
  const rows = state.data[state.tab]?.rows || [];
  const n = (c) => rows.filter((r) => r.cat === c).length;
  const chip = (c, label) => `<button class="chip ${c ? 'chip-' + c : ''}" type="button" data-cat="${c || ''}" aria-pressed="${state.cat === c}">${label}<b>${c ? n(c) : rows.filter((r) => r.cat).length}</b></button>`;
  $('chips').innerHTML = `${chip(null, '全部有訊號')}<span class="chip-sep">交易機會</span>${chip('long', '做多機會')}${chip('short', '做空機會')}<span class="chip-sep">潛在反轉</span>${chip('bottom', '見底轉強')}${chip('top', '見頂轉弱')}`;
}

function renderStatus() {
  const d = state.data[state.tab];
  const el = $('status');
  el.classList.toggle('err', !!state.error[state.tab]);
  if (state.error[state.tab]) { el.textContent = state.error[state.tab]; return; }
  if (state.loading[state.tab] && !d) {
    el.textContent = state.tab === 'tw' ? '正在向證交所抓近 5 日資料，第一次大約要 10 秒…' : '正在向幣安抓合約資料…';
    return;
  }
  if (!d) { el.textContent = ''; return; }
  const parts = [d.source];
  if (d.date) parts.push(`資料日 ${dateFmt(d.date)}`);
  parts.push(`${d.rows.length} 檔`);
  parts.push(`${timeFmt(d.updatedAt)} 更新`);
  if (d.viaBrowser) parts.push('由你的瀏覽器直接抓取');
  if (state.tab === 'crypto') {
    if (state.xchg) {
      const ok = Object.values(state.xchg.status || {}).filter((v) => String(v).startsWith('ok')).length + 1;
      const bad = Object.entries(state.xchg.status || {}).filter(([, v]) => !String(v).startsWith('ok')).map(([k]) => k);
      parts.push(`交易所 ${ok}/${EXCHANGES.length} 家${bad.length ? `（沒抓到：${bad.join('、')}）` : ''}`);
    } else if (state.xchgLoading) parts.push('正在抓其他交易所…');
  }
  if (d.stale) parts.push('（這次更新失敗，顯示上一份資料）');
  el.textContent = parts.join('・');
}

// ---------- 蓄力警報 ----------
const ALERT_KEY = 'wr_seen_alerts';
function loadSeen() { try { return new Set(JSON.parse(localStorage.getItem(ALERT_KEY) || '[]')); } catch { return new Set(); } }
function saveSeen(set) { try { localStorage.setItem(ALERT_KEY, JSON.stringify([...set].slice(-400))); } catch {} }
let seen = loadSeen();

// 只提醒「中」以上強度的分類結論
function alertRows(tab) {
  const d = state.data[tab];
  if (!d) return [];
  const day = tab === 'crypto' ? new Date().toISOString().slice(0, 10) : d.date;
  return d.rows
    .filter((r) => r.cat && r.catLevel !== '弱')
    .map((r) => { const id = `${tab}:${r.symbol || r.code}:${r.cat}:${day}`; return { r, k: r.cat, id, isNew: !seen.has(id) }; })
    .sort((a, b) => b.isNew - a.isNew || b.r.catScore - a.r.catScore);
}

function renderAlerts() {
  const list = alertRows(state.tab);
  const el = $('alerts');
  if (!state.data[state.tab]) { el.hidden = true; return; }
  el.hidden = false;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const nb = perm === 'default' ? '<button class="ghost" id="notify" type="button">開啟通知</button>'
    : perm === 'granted' ? '<span class="muted small">通知已開啟</span>' : '';
  const row = ({ r, isNew }) => {
    const name = r.base || `${r.code} ${r.name}`;
    return `<li class="alert-row">${isNew ? '<span class="dot" title="新出現"></span>' : ''}<b>${esc(name)}</b>${catBadge(r)}<span class="muted small">${esc(r.catWhy.slice(0, 2).join('・'))}</span></li>`;
  };
  const group = (title, cats) => {
    const g = list.filter((a) => cats.includes(a.k));
    return `<div class="alert-group"><div class="muted small">${title}・${g.length}</div>${g.length ? `<ul class="alert-list">${g.slice(0, 6).map(row).join('')}</ul>` : '<div class="muted small">目前沒有</div>'}</div>`;
  };
  el.innerHTML = `<div class="alerts-head"><strong>警報</strong><span class="muted small">只列強度「中」以上</span><span class="spacer"></span>${nb}</div>
    <div class="alert-groups">${group('交易機會（做多／做空）', ['long', 'short'])}${group('潛在反轉（見底／見頂）', ['bottom', 'top'])}</div>`;
  const btn = document.getElementById('notify');
  if (btn) btn.onclick = async () => { try { await Notification.requestPermission(); } catch {} renderAlerts(); };
}

function notifyNew(tab) {
  const fresh = alertRows(tab).filter((a) => a.isNew);
  if (!fresh.length) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    const body = fresh.slice(0, 5).map(({ r }) => `${r.base || r.code + ' ' + r.name}：${CATS[r.cat].label}（${r.catLevel}）`).join('\n');
    try { new Notification(`籌碼雷達：${fresh.length} 個新警報`, { body, tag: 'wr-' + tab }); } catch {}
  }
  document.title = `(${fresh.length}) 籌碼雷達`;
}

function markSeen() {
  for (const a of alertRows(state.tab)) seen.add(a.id);
  saveSeen(seen);
  document.title = '籌碼雷達';
}

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  $('trust-view').hidden = state.tab !== 'trust';
  $('main-view').hidden = state.tab === 'trust';
  if (state.tab === 'trust') { trust.render(); return; }
  $('guide-crypto').hidden = state.tab !== 'crypto';
  $('guide-tw').hidden = state.tab !== 'tw';
  $('sort').innerHTML = SORTS[state.tab].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('sort').value = state.sort[state.tab];
  $('refresh').disabled = state.loading[state.tab];
  $('refresh').textContent = state.loading[state.tab] ? '更新中…' : '重新整理';
  renderStatus();
  renderAlerts();
  renderChips();
  const rows = visibleRows();
  const shown = rows.slice(0, state.limit);
  $('grid').innerHTML = shown.map(state.tab === 'crypto' ? cryptoCard : twCard).join('');
  const d = state.data[state.tab];
  const empty = $('empty');
  empty.hidden = !d || rows.length > 0;
  if (d && !rows.length) empty.textContent = state.cat ? `目前沒有「${CATS[state.cat].label}」的標的。沒有訊號是常態，代表現在沒有明確機會。` : '找不到符合的代號或名稱。';
  $('more').hidden = rows.length <= state.limit;
  $('more').textContent = `顯示更多（還有 ${rows.length - state.limit} 檔）`;
}

// ---------- 抓資料 ----------
async function api(path) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (r.status === 401) { location.replace('/login'); throw new Error('未登入'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `伺服器錯誤 ${r.status}`);
  return j;
}

// 伺服器被幣安擋（例如機房在美國）時，改用你自己的瀏覽器直接抓
async function cryptoFromBrowser() {
  const getJSON = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const pool = async (items, limit, fn) => {
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
    return out;
  };
  const d = await buildCrypto(50, { getJSON, pool });
  return { ...d, viaBrowser: true };
}

// 其他交易所：先問伺服器，伺服器失敗再用瀏覽器直接抓
async function enrichCryptoExchanges(refresh = false) {
  const d = state.data.crypto;
  if (!d || state.xchgLoading) return;
  state.xchgLoading = true;
  const bases = [...new Set(d.rows.map((r) => normBase(r.base)))];
  try {
    let x;
    try {
      x = await api(`/api/xchg?bases=${bases.join(',')}${refresh ? '&refresh=1' : ''}`);
    } catch (e) {
      if (e.message === '未登入') throw e;
      const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
      const postJSON = async (u, b) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
      const pool = async (items, limit, fn) => { let i = 0; await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) await fn(items[i++]); })); };
      x = await fetchExchanges(bases, { getJSON, postJSON, pool });
    }
    state.xchg = x;
    applyExchanges();
  } catch {} finally {
    state.xchgLoading = false;
    if (state.tab === 'crypto') render();
  }
}
function applyExchanges() {
  const d = state.data.crypto, x = state.xchg;
  if (!d || !x) return;
  for (const r of d.rows) {
    mergeExchanges(r, x);
    r.coilWhy = null;
    r.signals = cryptoSignals(r);
    r.score = cryptoScore(r);
  }
  classifyAll('crypto');
  notifyNew('crypto');
}

// 台股型態訊號：日 K 型態 + 當天法人與融資確認
// 台股的籌碼確認：資金流 = 法人今天買 / 投信連買 / 外資連買；輔助 = 融資減少、法人 5 日買超
function confirmTw(r, dir) {
  const flow = [], ctx = [];
  if (dir > 0) {
    if (r.total > 0) flow.push('法人今日買超');
    if (r.trustStreak >= 2) flow.push(`投信連買 ${r.trustStreak} 天`);
    if (r.foreignStreak >= 2) flow.push(`外資連買 ${r.foreignStreak} 天`);
    if (r.marginChg != null && r.marginChg < 0) ctx.push('融資減少（籌碼集中）');
    if (r.total5 > 0) ctx.push('法人 5 日買超');
  } else {
    if (r.total < 0) flow.push('法人今日賣超');
    if (r.trustStreak <= -2) flow.push(`投信連賣 ${-r.trustStreak} 天`);
    if (r.foreignStreak <= -2) flow.push(`外資連賣 ${-r.foreignStreak} 天`);
    if (r.marginChg != null && r.marginChg > 0) ctx.push('融資增加（散戶在接）');
    if (r.total5 < 0) ctx.push('法人 5 日賣超');
  }
  return { flow, ctx };
}
const TW_UNITS = { small: '短箱', big: '日線大箱', tr: '日線', lenUnit: 1, lenName: '天', bigLenName: '天' };

function twPatternSignals(r) {
  const boxOut = structSignals(r, r.div?.st, confirmTw, TW_UNITS);
  const pat = twPatternOnly(r);
  return [...boxOut, ...pat.filter((k) => !(k === 'baseBreak' && boxOut.includes('loBoxBreak')) && !(k === 'boxBreakDown' && boxOut.includes('hiBoxBreak')))];
}

function twPatternOnly(r) {
  const p = r.div?.pat;
  if (!p) return [];
  const out = [], why = [];
  if (p.rise >= 30 && p.hiAgo <= 10) {
    let score = 0; const w = [];
    if (r.total < 0) { score++; w.push('法人今日賣超'); }
    if (r.marginChg > 0) { score++; w.push('融資增加（散戶在接）'); }
    if (p.volRatio >= 2 && Math.abs(r.chg ?? 0) < 1) { score++; w.push('爆量不漲'); }
    if (r.div.bear >= 1) { score++; w.push('日線 MACD 頂背離'); }
    if (p.dd >= 3 && p.dd <= 15 && r.total < 0 && (r.foreignStreak <= -1 || r.trustStreak <= -1)) {
      out.push('topTurn'); why.push(`漲 ${p.rise.toFixed(0)}% 後回落 ${p.dd.toFixed(1)}%`, ...w);
    } else if (p.dd <= 4 && score >= 2) {
      out.push('topWarn'); why.push(`漲 ${p.rise.toFixed(0)}% 仍在高點`, ...w);
    }
  }
  if (p.drop >= 30 && p.loAgo <= 10 && p.bounce >= 3 && p.bounce <= 15 && r.total > 0 && (r.foreign > 0 || r.trust > 0)) {
    out.push('botTurn'); why.push(`跌 ${p.drop.toFixed(0)}% 後反彈 ${p.bounce.toFixed(1)}%`, '法人轉買');
    if (r.div.bull >= 1) why.push('日線 MACD 底背離');
  }
  if (p.breakUp && p.volRatio >= 2 && r.total > 0) {
    out.push('baseBreak'); why.push(`20 日箱型 ${p.boxRange.toFixed(1)}% 帶量突破`, `量 ${p.volRatio.toFixed(1)} 倍`, '法人買超');
    if (r.total5 > 0) why.push('整理期間法人已在買');
    if (r.marginChg != null && r.marginChg <= 0) why.push('融資沒增加');
  }
  if (p.breakDown && p.volRatio >= 2 && r.total < 0) {
    out.push('boxBreakDown'); why.push(`20 日箱型 ${p.boxRange.toFixed(1)}% 帶量跌破`, '法人賣超');
  }
  r.patWhy = why;
  return out;
}

// 台股日 K：只對有籌碼訊號、今天大漲大跌、或法人進出最大的股票抓（避免被證交所擋）
async function enrichTwMacd() {
  const d = state.data.tw;
  if (!d || d.macdDone) return;
  d.macdDone = true;
  const liquid = d.rows.filter((r) => r.volume >= 1000);
  const pick = new Set([
    ...liquid.filter((r) => r.signals.some((k) => TW_SIGNALS[k]?.alert)).map((r) => r.code),
    ...[...liquid].filter((r) => Math.abs(r.chg ?? 0) >= 3).sort((a, b) => b.volume - a.volume).slice(0, 16).map((r) => r.code),
    ...[...liquid].sort((a, b) => Math.abs(b.total5) - Math.abs(a.total5)).slice(0, 16).map((r) => r.code),
  ]);
  const codes = [...pick].slice(0, 40);
  for (let i = 0; i < codes.length; i += 8) {
    try {
      const res = await api(`/api/twhist?codes=${codes.slice(i, i + 8).join(',')}`);
      for (const r of d.rows) {
        const m = res[r.code];
        if (!m || m.error) continue;
        r.div = m;
        if (m.bull >= 2) r.signals.push('macdBull2'); else if (m.bull === 1) r.signals.push('macdBull');
        if (m.bear >= 2) r.signals.push('macdBear2'); else if (m.bear === 1) r.signals.push('macdBear');
        r.signals.unshift(...twPatternSignals(r));
      }
      classifyAll('tw');
      if (state.tab === 'tw') render();
    } catch { break; }
  }
  notifyNew('tw');
}

async function load(tab, refresh = false) {
  if (state.loading[tab]) return;
  state.loading[tab] = true; state.error[tab] = '';
  if (tab === state.tab) render();
  try {
    if (tab === 'crypto') {
      try {
        state.data.crypto = await api(`/api/crypto?n=50${refresh ? '&refresh=1' : ''}`);
      } catch (e) {
        if (e.message === '未登入') throw e;
        state.data.crypto = await cryptoFromBrowser();
      }
      if (state.xchg) applyExchanges(); // 先用上一份交易所資料，背景再更新
      classifyAll('crypto');
      setTimeout(() => enrichCryptoExchanges(refresh), 0);
    } else {
      state.data.tw = await api(`/api/twstock${refresh ? '?refresh=1' : ''}`);
      classifyAll('tw');
      setTimeout(enrichTwMacd, 0);
    }
  } catch (e) {
    state.error[tab] = e.message === '未登入' ? '' : `更新失敗：${e.message}`;
  } finally {
    state.loading[tab] = false;
    if (state.data[tab]) notifyNew(tab);
    if (tab === state.tab) render();
  }
}

// ---------- 事件 ----------
const trust = createTrustTab({ api, el: $('trust-view'), getTw: () => state.data.tw });

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  if (state.tab === t.dataset.tab) return;
  state.tab = t.dataset.tab; state.cat = null; state.limit = 60; savePrefs();
  render();
  if (state.tab === 'trust') { if (!trust.loaded) trust.load(); if (!state.data.tw) load('tw'); return; }
  if (!state.data[state.tab]) load(state.tab);
}));
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  const c = b.dataset.cat || null;
  state.cat = state.cat === c ? null : c;
  state.limit = 60; render();
});
$('q').addEventListener('input', (e) => { state.q = e.target.value; state.limit = 60; render(); });
$('sort').addEventListener('change', (e) => { state.sort[state.tab] = e.target.value; savePrefs(); render(); });
$('refresh').addEventListener('click', () => load(state.tab, true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(markSeen, 4000); });
$('alerts').addEventListener('click', (e) => { if (e.target.closest('.alert-row')) markSeen(); });
$('more').addEventListener('click', () => { state.limit += 60; render(); });
$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.replace('/login');
});

// 加密貨幣每 5 分鐘自動更新（分頁在背景時不更新）
setInterval(() => { if (state.tab === 'crypto' && !document.hidden) load('crypto'); }, 5 * 60 * 1000);

// 先確認有登入，再開始抓
api('/api/me').then(() => {
  render();
  if (state.tab === 'trust') { trust.load(); load('tw'); } else load(state.tab);
}).catch(() => {});
render();
