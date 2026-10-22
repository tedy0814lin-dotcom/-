// 籌碼雷達前端：讀 /api 的資料，畫成卡片，提供搜尋、排序、訊號篩選
import { buildCrypto, CRYPTO_SIGNALS } from '/lib/cryptoCore.js';

const TW_SIGNALS = {
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
    ['oiChg24', '持倉 24h 增幅'],
    ['oiChgAbs', '持倉 24h 變化（絕對值）'],
    ['topLSChg', '大戶多空比上升'],
    ['funding', '資金費率（高→低）'],
    ['fundingLow', '資金費率（低→高）'],
    ['taker', '主動買賣比'],
    ['vol24', '24h 成交額'],
    ['chg24', '24h 漲幅'],
  ],
  tw: [
    ['total', '三大法人今日買超'],
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
      ${metric('持倉 4h', signed(r.oiChg4, 1, '%'), '', cls(r.oiChg4))}
      ${metric('資金費率', signed(r.funding, 4, '%'), '', r.funding >= 0.05 ? 'up' : r.funding <= -0.03 ? 'down' : '')}
      ${metric('大戶多空比', r.topLS.toFixed(2), `<span class="${cls(r.topLSChg)}">24h ${signed(r.topLSChg, 2)}</span>`)}
      ${metric('散戶多空比', r.globalLS.toFixed(2), `<span class="${cls(r.globalLSChg)}">24h ${signed(r.globalLSChg, 2)}</span>`)}
      ${metric('主動買賣比', r.taker == null ? '—' : r.taker.toFixed(2), '', r.taker >= 1.2 ? 'up' : r.taker <= 0.83 ? 'down' : '')}
    </div>
    <div class="spark-row"><span class="k">持倉 24h</span>${spark(r.spark)}</div>
    ${tags(r.signals, CRYPTO_SIGNALS)}
  </article>`;
}

function twCard(r) {
  return `<article class="card">
    <div class="card-head">
      <span class="sym num">${esc(r.code)}</span>
      <span class="sub">${esc(r.name)}</span>
      <div class="price"><span class="p num">${r.close == null ? '—' : price(r.close)}</span><span class="c num ${cls(r.chg)}">${signed(r.chg, 2, '%')}</span></div>
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

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  $('guide-crypto').hidden = state.tab !== 'crypto';
  $('guide-tw').hidden = state.tab !== 'tw';
  $('sort').innerHTML = SORTS[state.tab].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('sort').value = state.sort[state.tab];
  $('refresh').disabled = state.loading[state.tab];
  $('refresh').textContent = state.loading[state.tab] ? '更新中…' : '重新整理';
  renderStatus();
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
    }
  } catch (e) {
    state.error[tab] = e.message === '未登入' ? '' : `更新失敗：${e.message}`;
  } finally {
    state.loading[tab] = false;
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
