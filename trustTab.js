// 投信策略分頁（林洸興算籌碼挑股）
// 第 1 招：每日投信買超前 50 名，股本 < 50 億的小型股先看
// 第 2 招：投信新認養股：半年前投信持股市值 < 1 億，半年吃貨後 3–15 億
// 避險：投信有部位的股票，投信開始連賣或大賣 → 先減碼
//
// 半年資料要抓約 120 個交易日，所以按「半個月」分段抓，已經過去的半個月存在瀏覽器，下次不用重抓。

const CACHE_PREFIX = 'wr_trust_v1_';
const SMALL_CAP = 50;        // 億
const ADOPT_MIN = 3, ADOPT_MAX = 15, EARLY_MAX = 1; // 億

const nf = new Intl.NumberFormat('zh-TW');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (v) => (v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
const signed = (v, d = 0) => (v == null ? '—' : (v > 0 ? '+' : '') + (d ? v.toFixed(d) : nf.format(Math.round(v))));

function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function taipeiToday() { return new Date(Date.now() + 8 * 3600e3); }

// 從 6 個月前那半個月，到這半個月，切成 [from, to] 區段
function halfMonths() {
  const now = taipeiToday();
  const start = new Date(now.getTime() - 183 * 864e5);
  const out = [];
  let y = start.getUTCFullYear(), m = start.getUTCMonth(), half = start.getUTCDate() <= 15 ? 0 : 1;
  for (;;) {
    const from = new Date(Date.UTC(y, m, half ? 16 : 1));
    const to = half ? new Date(Date.UTC(y, m + 1, 0)) : new Date(Date.UTC(y, m, 15));
    if (from > now) break;
    out.push([ymd(from), ymd(to > now ? now : to)]);
    if (half) { half = 0; m++; if (m > 11) { m = 0; y++; } } else half = 1;
  }
  return out;
}

function cacheGet(k) { try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + k)); } catch { return null; } }
function cacheSet(k, v) {
  try { localStorage.setItem(CACHE_PREFIX + k, JSON.stringify(v)); } catch {
    // 空間不夠就清掉舊的投信快取再試一次
    try { Object.keys(localStorage).filter((x) => x.startsWith(CACHE_PREFIX)).forEach((x) => localStorage.removeItem(x)); localStorage.setItem(CACHE_PREFIX + k, JSON.stringify(v)); } catch {}
  }
}

export function createTrustTab({ api, el, getTw }) {
  const st = { loading: false, progress: '', error: '', days: [], net: {}, names: {}, meta: {}, tpexDays: 0, loaded: false };

  async function load(force = false) {
    if (st.loading) return;
    st.loading = true; st.error = '';
    render();
    try {
      const metaP = api(`/api/meta${force ? '?refresh=1' : ''}`).catch((e) => ({ error: e.message, stocks: {} }));
      const ranges = halfMonths();
      const today = ymd(taipeiToday());
      const chunks = [];
      for (let i = 0; i < ranges.length; i++) {
        const [from, to] = ranges[i];
        const key = `${from}_${to}`;
        const past = to < today; // 整段都在今天之前 → 不會再變，可以存
        let c = past && !force ? cacheGet(key) : null;
        if (!c) {
          st.progress = `正在抓投信半年資料 ${i + 1}/${ranges.length}（${from.slice(4, 6)}/${from.slice(6)}–${to.slice(4, 6)}/${to.slice(6)}）…第一次大約要 3–5 分鐘，之後只更新最新半個月`;
          render();
          c = await api(`/api/trust?from=${from}&to=${to}`);
          if (past && c.days.length) cacheSet(key, c);
        }
        chunks.push(c);
      }
      // 合併成「每檔一條每日投信買賣超」
      const days = [], net = {}, names = {};
      let tpexDays = 0;
      for (const c of chunks) {
        const base = days.length;
        days.push(...c.days);
        tpexDays += c.tpexDays || 0;
        for (const [code, arr] of Object.entries(c.net)) {
          if (!net[code]) net[code] = [];
          arr.forEach((v, i) => { net[code][base + i] = v; });
          names[code] = c.names[code];
        }
      }
      for (const k in net) for (let i = 0; i < days.length; i++) net[k][i] = net[k][i] || 0;
      const meta = await metaP;
      Object.assign(st, { days, net, names, meta: meta.stocks || {}, metaStatus: meta.status, tpexDays, loaded: true, progress: '' });
      if (meta.error) st.error = `股本／股價：${meta.error}`;
    } catch (e) {
      st.error = `更新失敗：${e.message}`;
      st.progress = '';
    } finally {
      st.loading = false;
      render();
    }
  }

  function compute() {
    const n = st.days.length;
    const tw = getTw();
    const twRow = new Map((tw?.rows || []).map((r) => [r.code, r]));
    const rows = [];
    for (const [code, arr] of Object.entries(st.net)) {
      const m = st.meta[code] || {};
      const [name, mkt] = st.names[code] || [m.name, m.mkt];
      const close = m.close;
      const toVal = (lots) => (close ? (lots * close) / 1e5 : null); // 張 × 股價 × 1000 ÷ 1 億
      const today = arr[n - 1] || 0;
      let buyStreak = 0, sellStreak = 0;
      for (let i = n - 1; i >= 0 && arr[i] > 0; i--) buyStreak++;
      for (let i = n - 1; i >= 0 && arr[i] < 0; i--) sellStreak++;
      const cum = arr.reduce((a, b) => a + b, 0);
      const early = arr.slice(0, Math.min(20, n)).reduce((a, b) => a + b, 0); // 半年前那個月
      const last5 = arr.slice(-5).reduce((a, b) => a + b, 0);
      const last20 = arr.slice(-20).reduce((a, b) => a + b, 0);
      const r = {
        code, name: name || m.name || '', mkt: mkt || m.mkt || '', cap: m.cap ?? null, close, chg: m.chg ?? null,
        today, buyStreak, sellStreak, cum, cumVal: toVal(cum), earlyVal: toVal(early), last5, last5Val: toVal(last5), last20,
        spark: arr.slice(-20), tw: twRow.get(code),
      };
      // 第 2 招：投信新認養（估算）
      r.adopt = n >= 80 && r.cumVal != null && r.cumVal >= ADOPT_MIN && r.cumVal <= ADOPT_MAX && r.earlyVal < EARLY_MAX;
      // 避險：投信手上有貨（半年累計 ≥ 1 億），開始連賣或近 5 日賣掉 1 成以上
      const why = [];
      if (r.cumVal >= 1) {
        if (sellStreak >= 2) why.push(`投信連賣 ${sellStreak} 天`);
        if (r.last5Val != null && r.last5Val <= -0.1 * r.cumVal) why.push(`近 5 日賣掉約 ${Math.round((-r.last5Val / r.cumVal) * 100)}% 部位`);
      }
      if (why.length) {
        if (r.tw && r.tw.foreign < 0) why.push('外資同步賣');
        if (r.tw && r.tw.marginChg > 0) why.push('融資增加（散戶在接）');
        r.exitLevel = sellStreak >= 3 || (r.last5Val != null && r.last5Val <= -0.2 * r.cumVal) ? 2 : 1;
      }
      r.exitWhy = why;
      rows.push(r);
    }
    return rows;
  }

  function spark(values) {
    const w = 80, h = 22, mx = Math.max(1, ...values.map(Math.abs)), bw = w / values.length;
    return `<svg class="mini" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="var(--line)"/>${values.map((v, i) => {
      const bh = (Math.abs(v) / mx) * (h / 2 - 1);
      return `<rect x="${i * bw + 0.5}" y="${v >= 0 ? h / 2 - bh : h / 2}" width="${Math.max(bw - 1, 1)}" height="${Math.max(bh, 0.5)}" fill="var(--${v >= 0 ? 'up' : 'down'})"/>`;
    }).join('')}</svg>`;
  }

  function table(rows, cols) {
    if (!rows.length) return '<div class="muted small">目前沒有符合的股票。</div>';
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'n' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'n num' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')
    }</tbody></table></div>`;
  }

  const C = {
    stock: { h: '股票', f: (r) => `<b class="num">${esc(r.code)}</b> ${esc(r.name)} <span class="mk">${esc(r.mkt)}</span>` },
    cap: { h: '股本(億)', num: true, f: (r) => (r.cap == null ? '—' : r.cap.toFixed(1)) },
    close: { h: '收盤', num: true, f: (r) => (r.close == null ? '—' : r.close) + ` <span class="${cls(r.chg)}">${r.chg == null ? '' : signed(r.chg, 1) + '%'}</span>` },
    today: { h: '投信今日(張)', num: true, f: (r) => `<span class="${cls(r.today)}">${signed(r.today)}</span>` },
    streak: { h: '連買/賣', num: true, f: (r) => (r.buyStreak ? `<span class="up">買 ${r.buyStreak}</span>` : r.sellStreak ? `<span class="down">賣 ${r.sellStreak}</span>` : '—') },
    cumVal: { h: '半年累計(億)', num: true, f: (r) => (r.cumVal == null ? '—' : `<span class="${cls(r.cumVal)}">${r.cumVal.toFixed(1)}</span>`) },
    early: { h: '半年前那月(億)', num: true, f: (r) => (r.earlyVal == null ? '—' : r.earlyVal.toFixed(1)) },
    trend: { h: '近 20 日', f: (r) => spark(r.spark) },
    why: { h: '原因', f: (r) => `<span class="${r.exitLevel === 2 ? 'down' : ''}">${r.exitWhy.map(esc).join('・')}</span>` },
    level: { h: '', f: (r) => `<span class="tag ${r.exitLevel === 2 ? 'down' : ''}">${r.exitLevel === 2 ? '先減碼' : '注意'}</span>` },
  };

  function render() {
    if (!el.isConnected) return;
    const status = st.error ? `<div class="status err">${esc(st.error)}</div>` : '';
    if (!st.loaded) {
      el.innerHTML = `<div class="status">${esc(st.progress || (st.loading ? '準備中…' : ''))}</div>${status}`;
      return;
    }
    const rows = compute();
    const n = st.days.length;
    const top50 = rows.filter((r) => r.today > 0).sort((a, b) => b.today - a.today).slice(0, 50);
    const small = top50.filter((r) => r.cap != null && r.cap < SMALL_CAP);
    const large = top50.filter((r) => !(r.cap != null && r.cap < SMALL_CAP));
    const adopt = rows.filter((r) => r.adopt).sort((a, b) => b.cumVal - a.cumVal);
    const exit = rows.filter((r) => r.exitWhy.length).sort((a, b) => b.exitLevel - a.exitLevel || (a.last5Val ?? 0) - (b.last5Val ?? 0));
    const adoptExit = adopt.filter((r) => r.exitWhy.length);
    const d0 = st.days[0], d1 = st.days[n - 1];
    const fmt = (s) => `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6)}`;

    el.innerHTML = `
      <div class="toolbar"><div class="status" style="width:auto;flex:1">投信資料 ${fmt(d0)}–${fmt(d1)}，共 ${n} 個交易日（上櫃抓到 ${st.tpexDays} 天）${st.loading ? '・' + esc(st.progress || '更新中…') : ''}</div><button class="refresh" id="trust-refresh" type="button" ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '更新最新資料'}</button></div>
      ${status}
      <section class="panel ${exit.length ? 'warn' : ''}">
        <div class="panel-head"><strong>避險警示：投信開始賣</strong><span class="muted small">投信半年累計有 1 億以上部位，最近開始連賣或大賣</span></div>
        ${adoptExit.length ? `<div class="small"><b class="down">認養股出現賣訊：</b>${adoptExit.map((r) => `${esc(r.code)} ${esc(r.name)}`).join('、')}</div>` : ''}
        ${table(exit.slice(0, 30), [C.level, C.stock, C.close, C.today, C.streak, C.cumVal, C.why])}
      </section>
      <section class="panel">
        <div class="panel-head"><strong>第 1 招：投信今日買超前 50 名</strong><span class="muted small">股本小於 50 億的小型股先看</span></div>
        <h4>小型股（股本 &lt; 50 億）・${small.length} 檔</h4>
        ${table(small, [C.stock, C.cap, C.close, C.today, C.streak, C.cumVal, C.trend])}
        <h4>大型股・${large.length} 檔</h4>
        ${table(large, [C.stock, C.cap, C.close, C.today, C.streak, C.cumVal, C.trend])}
      </section>
      <section class="panel">
        <div class="panel-head"><strong>第 2 招：投信新認養股</strong><span class="muted small">半年前投信持股市值 &lt; 1 億，半年累計買到 3–15 億</span></div>
        ${n < 80 ? `<div class="muted small">資料只有 ${n} 天，至少要 80 個交易日才判斷。</div>` : table(adopt, [C.stock, C.cap, C.close, C.today, C.streak, C.early, C.cumVal, C.trend])}
      </section>
      <details class="guide">
        <summary>投信策略怎麼算</summary>
        <dl>
          <dt>第 1 招</dt><dd>當天投信買超張數最多的前 50 檔（上市＋上櫃），再分成股本小於 50 億的小型股和大型股。投信資金規模小，買小型股比較推得動股價。</dd>
          <dt>第 2 招（估算）</dt><dd>交易所沒有公開投信持股，所以用「近半年投信每日買賣超加總 × 現價」估算投信這半年買進的市值。半年累計在 3–15 億，而且最早那一個月幾乎沒買（小於 1 億），就視為投信新認養股。這是假設半年前投信持股接近 0，跟 XQ 的實際持股數字會有差距，可以拿 XQ 對照。</dd>
          <dt>避險警示</dt><dd>投信半年累計 1 億以上的股票，連賣 2 天以上，或近 5 日賣掉估計部位 1 成以上，就列出來。連賣 3 天或近 5 日賣掉 2 成以上標成「先減碼」。如果外資也在賣、融資在增加（散戶接貨），會一起註明。</dd>
          <dt>做不到的部分</dt><dd>XQ 畫面裡的「買賣家數差」要用券商分點資料、「內外盤比」要用逐筆成交，這兩種交易所沒有免費 API，所以沒有做。</dd>
        </dl>
      </details>`;
    const btn = el.querySelector('#trust-refresh');
    if (btn) btn.onclick = () => load();
  }

  return { load, render, get loaded() { return st.loaded; }, get loading() { return st.loading; } };
}
