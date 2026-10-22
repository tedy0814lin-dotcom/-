// 籌碼雷達前端：讀 /api 的資料，畫成卡片，提供搜尋、排序、訊號篩選
import { buildCrypto, CRYPTO_SIGNALS } from '/lib/cryptoCore.js';

const TW_SIGNALS = {
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
    ['score', '大戶動能分數'],
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
    ['total', '三大法人今日買超'],
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
  sort: { crypto: 'score', tw: 'total' },
  limit: 60,
};

try {
  const saved = JSON.parse(localStorage.getItem('wr_prefs') || '{}');
  if (saved.tab === 'tw' || saved.tab === 'crypto') state.tab = saved.tab;
  if (saved.sort) Object.assign(state.sort, saved.sort);
} catch {}
function savePrefs() {
  try { localStorage.setItem('wr_prefs', JSON.stringify({ tab: state.tab, sort: state.sort })); } catch {}
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

// ---------- 卡片 ----------
function cryptoCard(r) {
  return `<article class="card">
    <div class="card-head">
      <span class="sym">${esc(r.base)}</span>
      <span class="score ${r.score >= 50 ? 'hot' : ''}" title="大戶動能分數">${r.score}</span>
      <div class="price"><span class="p num">${price(r.price)}</span><span class="c num ${cls(r.chg24)}">${signed(r.chg24, 2, '%')}</span></div>
    </div>
    <div class="metrics">
      ${metric('持倉量', '$' + big(r.oi), `<span class="${cls(r.oiChg24)}">24h ${signed(r.oiChg24, 1, '%')}</span>`)}
      ${metric('24h 振幅', r.range24 == null ? '—' : r.range24.toFixed(1) + '%', `持倉 4h <span class="${cls(r.oiChg4)}">${signed(r.oiChg4, 1, '%')}</span>`)}
      ${metric('資金費率', signed(r.funding, 4, '%'), '', r.funding >= 0.05 ? 'up' : r.funding <= -0.03 ? 'down' : '')}
      ${metric('大戶多空比', r.topLS.toFixed(2), `<span class="${cls(r.topLSChg)}">24h ${signed(r.topLSChg, 2)}</span>`)}
      ${metric('散戶多空比', r.globalLS.toFixed(2), `<span class="${cls(r.globalLSChg)}">24h ${signed(r.globalLSChg, 2)}</span>`)}
      ${metric('CVD 24h', r.cvd24 == null ? '—' : (r.cvd24 >= 0 ? '+$' : '-$') + big(Math.abs(r.cvd24)), `<span class="${cls(r.cvdRatio)}">${signed(r.cvdRatio, 1, '%')}</span> 買賣比 ${r.taker == null ? '—' : r.taker.toFixed(2)}`, cls(r.cvd24))}
    </div>
    <div class="spark-row"><span class="k">持倉 24h</span>${spark(r.spark)}</div>
    ${r.cvdSpark && r.cvdSpark.length > 1 ? `<div class="spark-row"><span class="k">CVD 24h</span>${spark(r.cvdSpark)}</div>` : ''}
    ${tags(r.signals, CRYPTO_SIGNALS)}
    ${r.coilWhy && r.coilWhy.length ? `<div class="why">${r.coilWhy.map(esc).join('・')}</div>` : ''}
  </article>`;
}

function twCard(r) {
  return `<article class="card">
    <div class="card-head">
      <span class="sym num">${esc(r.code)}</span>
      <span class="sub">${esc(r.name)}</span>
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
    ${tags(r.signals, TW_SIGNALS)}
  </article>`;
}

// ---------- 排序與篩選 ----------
function sortRows(rows) {
  const key = state.sort[state.tab];
  const get = {
    oiChgAbs: (r) => Math.abs(r.oiChg24 ?? 0),
    fundingLow: (r) => -(r.funding ?? 0),
    totalLow: (r) => -r.total,
    marginDrop: (r) => -(r.marginChg ?? 0),
    cvdLow: (r) => -(r.cvdRatio ?? 0),
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
  if (state.filter.size) rows = rows.filter((r) => [...state.filter].every((f) => r.signals.includes(f)));
  return sortRows(rows);
}

// ---------- 畫面 ----------
function renderChips() {
  const dict = state.tab === 'crypto' ? CRYPTO_SIGNALS : TW_SIGNALS;
  const rows = state.data[state.tab]?.rows || [];
  $('chips').innerHTML = Object.entries(dict).map(([k, s]) => {
    const n = rows.filter((r) => r.signals.includes(k)).length;
    return `<button class="chip" type="button" data-sig="${k}" aria-pressed="${state.filter.has(k)}">${s.label}<b>${n}</b></button>`;
  }).join('');
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
  if (d.stale) parts.push('（這次更新失敗，顯示上一份資料）');
  el.textContent = parts.join('・');
}

// ---------- 蓄力警報 ----------
const ALERT_KEY = 'wr_seen_alerts';
function loadSeen() { try { return new Set(JSON.parse(localStorage.getItem(ALERT_KEY) || '[]')); } catch { return new Set(); } }
function saveSeen(set) { try { localStorage.setItem(ALERT_KEY, JSON.stringify([...set].slice(-400))); } catch {} }
let seen = loadSeen();

function alertRows(tab) {
  const d = state.data[tab];
  if (!d) return [];
  const dict = tab === 'crypto' ? CRYPTO_SIGNALS : TW_SIGNALS;
  const day = tab === 'crypto' ? new Date().toISOString().slice(0, 10) : d.date;
  const out = [];
  for (const r of d.rows) {
    for (const k of r.signals) {
      if (!dict[k]?.alert) continue;
      const id = `${tab}:${r.symbol || r.code}:${k}:${day}`;
      out.push({ r, k, id, isNew: !seen.has(id) });
    }
  }
  return out.sort((a, b) => b.isNew - a.isNew || dict[b.k].dir - dict[a.k].dir);
}

function renderAlerts() {
  const list = alertRows(state.tab);
  const el = $('alerts');
  const dict = state.tab === 'crypto' ? CRYPTO_SIGNALS : TW_SIGNALS;
  if (!state.data[state.tab]) { el.hidden = true; return; }
  el.hidden = false;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const nb = perm === 'default' ? '<button class="ghost" id="notify" type="button">開啟通知</button>'
    : perm === 'granted' ? '<span class="muted small">通知已開啟</span>' : '';
  const items = list.slice(0, 12).map(({ r, k, isNew }) => {
    const s = dict[k]; const c = s.dir > 0 ? 'up' : s.dir < 0 ? 'down' : '';
    const name = r.base || `${r.code} ${r.name}`;
    const move = r.chg24 != null ? `24h ${signed(r.chg24, 1, '%')}・持倉 ${signed(r.oiChg24, 1, '%')}` : `5 日 ${signed(r.chg5, 1, '%')}・法人 5 日 ${lotsFmt(r.total5)} 張`;
    return `<li class="alert-row">${isNew ? '<span class="dot" title="新出現"></span>' : ''}<b>${esc(name)}</b><span class="tag ${c}">${s.label}</span><span class="muted num small">${move}</span></li>`;
  }).join('');
  el.innerHTML = `<div class="alerts-head"><strong>${state.tab === 'crypto' ? '蓄力警報' : '築底警報'}</strong><span class="muted small">價格還沒動、籌碼先動的標的</span><span class="spacer"></span>${nb}</div>
    ${list.length ? `<ul class="alert-list">${items}</ul>${list.length > 12 ? `<div class="muted small">還有 ${list.length - 12} 檔，點下方「${state.tab === 'crypto' ? '築底蓄力' : '築底吸籌'}」標籤看全部</div>` : ''}`
      : '<div class="muted small">目前沒有符合條件的標的。條件很嚴格，沒有訊號是常態。</div>'}`;
  const btn = document.getElementById('notify');
  if (btn) btn.onclick = async () => { try { await Notification.requestPermission(); } catch {} renderAlerts(); };
}

function notifyNew(tab) {
  const fresh = alertRows(tab).filter((a) => a.isNew);
  if (!fresh.length) return;
  const dict = tab === 'crypto' ? CRYPTO_SIGNALS : TW_SIGNALS;
  if ('Notification' in window && Notification.permission === 'granted') {
    const body = fresh.slice(0, 5).map(({ r, k }) => `${r.base || r.code + ' ' + r.name}：${dict[k].label}`).join('\n');
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
  if (d && !rows.length) empty.textContent = state.filter.size ? '目前沒有同時符合這些訊號的標的，試著少選一個。' : '找不到符合的代號或名稱。';
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

// 台股 MACD 背離：只對有籌碼訊號或法人進出最大的股票抓日 K（避免被證交所擋）
async function enrichTwMacd() {
  const d = state.data.tw;
  if (!d || d.macdDone) return;
  d.macdDone = true;
  const liquid = d.rows.filter((r) => r.volume >= 1000);
  const pick = new Set([
    ...liquid.filter((r) => r.signals.some((k) => TW_SIGNALS[k]?.alert)).map((r) => r.code),
    ...[...liquid].sort((a, b) => Math.abs(b.total5) - Math.abs(a.total5)).slice(0, 16).map((r) => r.code),
  ]);
  const codes = [...pick].slice(0, 24);
  for (let i = 0; i < codes.length; i += 8) {
    try {
      const res = await api(`/api/twhist?codes=${codes.slice(i, i + 8).join(',')}`);
      for (const r of d.rows) {
        const m = res[r.code];
        if (!m || m.error) continue;
        r.div = m;
        if (m.bull >= 2) r.signals.push('macdBull2'); else if (m.bull === 1) r.signals.push('macdBull');
        if (m.bear >= 2) r.signals.push('macdBear2'); else if (m.bear === 1) r.signals.push('macdBear');
      }
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
    } else {
      state.data.tw = await api(`/api/twstock${refresh ? '?refresh=1' : ''}`);
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
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  if (state.tab === t.dataset.tab) return;
  state.tab = t.dataset.tab; state.filter.clear(); state.limit = 60; savePrefs();
  render();
  if (!state.data[state.tab]) load(state.tab);
}));
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  const k = b.dataset.sig;
  state.filter.has(k) ? state.filter.delete(k) : state.filter.add(k);
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
api('/api/me').then(() => { render(); load(state.tab); }).catch(() => {});
render();
