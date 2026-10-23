// 維加斯通道分頁：加密（15 分 / 1 小時 / 4 小時）、台股（15 分 / 1 小時 / 日線）
const TFS = { crypto: ['15m', '1h', '4h'], tw: ['15m', '1h', '1d'] };
const TFN = { '15m': '15 分', '1h': '1 小時', '4h': '4 小時', '1d': '日線' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));

// 訊號分數 0–100：步驟（確認 50 / 回踩完成 35 / 突破 EMA12 25 / 碰通道 10）
// ＋ 大一級時區在通道 15、同方向 8、逆向 −20 ＋ 這檔這個時區歷史勝率 ±20 ＋ 其他時區同方向 8 ＋ 風報比 ≥2、主動買賣、帶量各 5
const BASE = { 確認: 50, 回踩完成: 35, 已突破EMA12: 25, 碰通道: 10 };
function grade(r, m) {
  const tfs = TFS[m];
  let best = null;
  tfs.forEach((tf, k) => {
    const v = r.data?.[tf];
    if (!v?.now) return;
    const n = v.now, up = r.data[tfs[k + 1]], notes = [];
    let sc = BASE[n.status] || 0;
    if (up && up.inTunnel === n.dir) { sc += 15; notes.push(`${TFN[tfs[k + 1]]}也在通道`); }
    else if (up && up.trend === n.dir) sc += 8;
    if (up && up.trend === -n.dir) { sc -= 20; notes.push(`逆${TFN[tfs[k + 1]]}趨勢`); }
    const s = v.stats;
    if (s && s.n >= 4 && s.winRate != null) { sc += Math.max(-20, Math.min(20, (s.winRate - 50) * 0.5)); if (s.winRate >= 65) notes.push(`這個時區勝率 ${s.winRate}%`); }
    const others = tfs.filter((t) => t !== tf && r.data[t]?.trend === n.dir).length;
    sc += others * 8;
    if (n.status === '確認') {
      if (n.rr >= 2) sc += 5;
      if (n.rr < 1) { sc -= 25; notes.push('風報比不足'); }
      if (n.flow) sc += 5;
      if (n.volUp) sc += 5;
      if (tf === '15m') notes.push('當沖');
    }
    sc = Math.max(0, Math.min(100, Math.round(sc)));
    if (!best || sc > best.sc) best = { sc, tf, n, notes };
  });
  if (best) best.group = best.n.status === '確認' && best.sc >= 70 ? 'hot' : best.n.status === '確認' || best.n.status === '回踩完成' ? 'ready' : best.sc >= 40 ? 'watch' : 'far';
  return best;
}
const GO = { hot: 0, ready: 1, watch: 2, far: 3 };
const GROUPS = {
  hot: ['強訊號', '已確認、多條件同時成立，可以考慮進場'],
  ready: ['準備進場', '回踩完成等突破高點，或已確認但條件較少'],
  watch: ['注意', '剛突破 EMA12 或碰通道，而且大週期／歷史勝率支持'],
  far: ['觀察', '剛碰通道，還早'],
};

// 這檔哪個時區、哪條通道比較有效（歷史統計）
function bestTf(r, m) {
  let b = null;
  for (const tf of TFS[m]) {
    const s = r.data?.[tf]?.stats;
    if (s && s.n >= 4 && (!b || s.winRate > b.rate)) b = { tf, rate: s.winRate, n: s.n };
  }
  return b;
}

export function createVegasTab({ api, el }) {
  const st = { m: 'crypto', list: {}, rows: {}, loading: false, progress: '', error: '', showAll: false, loaded: {} };

  async function load(force = false) {
    const m = st.m;
    if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try {
      if (!st.list[m] || force) st.list[m] = await api(`/api/vegas?list=${m}`);
      const L = st.list[m], size = m === 'tw' ? 6 : 8;
      st.rows[m] = L.map((x) => ({ ...x, data: null }));
      const fetchPart = async (syms) => {
        for (let t = 0; t < 2; t++) {
          const part = await api(`/api/vegas?m=${m}&s=${syms.join(',')}`).catch(() => null);
          if (part) return part;
        }
        return {};
      };
      for (let i = 0; i < L.length; i += size) {
        st.progress = `${Math.min(i + size, L.length)} / ${L.length}`; render();
        const part = await fetchPart(L.slice(i, i + size).map((x) => x.s));
        for (const r of st.rows[m]) if (part[r.s]) r.data = part[r.s];
        if (st.m !== m) break;
      }
      // 第一次沒抓到的再補抓一次
      const miss = st.rows[m].filter((r) => !r.data || r.data.error);
      for (let i = 0; i < miss.length && st.m === m; i += size) {
        st.progress = `補抓 ${Math.min(i + size, miss.length)} / ${miss.length}`; render();
        const part = await fetchPart(miss.slice(i, i + size).map((r) => r.s));
        for (const r of miss) if (part[r.s] && !part[r.s].error) r.data = part[r.s];
      }
      const fail = st.rows[m].filter((r) => !r.data || r.data.error).length;
      st.error = fail ? `${fail} 檔資料來源暫時抓不到（已重試），可以稍後按「重新整理」。` : '';
      st.loaded[m] = true;
    } catch (e) { st.error = e.message; }
    st.loading = false; st.progress = ''; render();
  }

  function card(r, m) {
    const g = grade(r, m), bt = bestTf(r, m);
    const n = g?.n;
    const dirTxt = n ? (n.dir > 0 ? '做多' : '做空') : '';
    const lvTxt = !g ? '' : `${GROUPS[g.group][0]} ${g.sc}分・${TFN[g.tf]}${g.n.status}`;
    const badge = n ? `<span class="cat ${n.dir > 0 ? 'cat-long' : 'cat-short'}">${dirTxt} <b>${lvTxt}</b></span>` : '';
    const rowsHtml = TFS[m].map((tf) => {
      const v = r.data?.[tf];
      if (!v) return `<div class="vg-row"><span class="k">${TFN[tf]}</span><span class="muted">資料不足</span></div>`;
      const tr = !v.trend ? '<span class="muted">通道糾纏</span>' : `<span class="${v.trend > 0 ? 'up' : 'down'}">${v.trend > 0 ? '多頭' : '空頭'}${v.smooth ? '' : '（不平滑）'}</span>`;
      let now = '';
      if (v.now) {
        const t = v.now;
        now = t.status === '確認' ? `<b class="${t.dir > 0 ? 'up' : 'down'}">確認${t.dir > 0 ? '做多' : '做空'}</b>（${t.tunnel}通道）進 ${px(t.entry)}・停損 ${px(t.stop)}・目標 ${px(t.target)}・風報比 1:${t.rr.toFixed(1)}${t.flow === true ? '・主動買賣確認' : ''}${t.volUp ? '・突破帶量' : ''}`
          : t.status === '回踩完成' ? `回踩 EMA12 完成，等突破 <b>${px(t.trigger)}</b>（${t.tunnel}通道）`
          : t.status === '已突破EMA12' ? `已站上 EMA12，等回踩（${t.tunnel}通道）` : `碰到${t.tunnel}通道，等突破 EMA12`;
      }
      const s = v.stats;
      const stat = s ? `<span class="muted">訊號勝率 ${s.winRate ?? '—'}%（${s.n}）・小通道反應 ${s.small.rate ?? '—'}%（${s.small.n}）・大通道 ${s.big.rate ?? '—'}%（${s.big.n}）</span>` : '';
      return `<div class="vg-row"><span class="k">${TFN[tf]}</span>${tr}${now ? ' ・ ' + now : ''}<div>${stat}</div></div>`;
    }).join('');
    const tip = bt ? `<div class="muted">這檔歷史上 <b>${TFN[bt.tf]}</b> 最有效（勝率 ${bt.rate}%，${bt.n} 次）</div>` : '';
    return `<article class="card"><div class="card-head"><span class="sym num">${esc(r.name)}</span>${badge}
      <div class="price"><span class="p num">${px(r.data?.[TFS[m][0]]?.price)}</span></div></div>
      ${g?.notes?.length ? `<div class="muted">${esc(g.notes.join('・'))}</div>` : ''}${rowsHtml}${tip}</article>`;
  }

  function render() {
    const m = st.m, rows = st.rows[m] || [];
    if (st.q) return renderSearch(m, rows);
    // 台股：日線通道糾纏（不是平滑的多頭或空頭）的直接跳過
    const skipped = m === 'tw' ? rows.filter((r) => r.data && !r.data['1d']?.smooth).length : 0;
    const graded = rows.filter((r) => r.data && (m !== 'tw' || r.data['1d']?.smooth)).map((r) => ({ r, g: grade(r, m) })).filter((x) => x.g);
    const cnt = { hot: 0, ready: 0, watch: 0, far: 0 };
    graded.forEach((x) => cnt[x.g.group]++);
    const shown = graded.filter((x) => (st.group ? x.g.group === st.group : st.showAll || x.g.group !== 'far') && (!st.dir || x.g.n.dir === st.dir))
      .sort((a, b) => GO[a.g.group] - GO[b.g.group] || b.g.sc - a.g.sc);
    let html = '', cur = null;
    for (const x of shown) {
      if (x.g.group !== cur) { cur = x.g.group; html += `<h3 class="vg-h">${GROUPS[cur][0]}（${cnt[cur]}）<span class="muted"> ${GROUPS[cur][1]}</span></h3>`; }
      html += card(x.r, m);
    }
    const chip = (k) => `<button class="chip" data-g="${k}" aria-pressed="${st.group === k}">${GROUPS[k][0]} <b>${cnt[k]}</b></button>`;
    el.innerHTML = toolbar(m) + `
      <div class="toolbar">${['hot', 'ready', 'watch', 'far'].map(chip).join('')}
        <button class="chip chip-long" data-d="1" aria-pressed="${st.dir === 1}">只看做多</button>
        <button class="chip chip-short" data-d="-1" aria-pressed="${st.dir === -1}">只看做空</button></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      <p class="muted">${m === 'tw' ? `股價 10–200 元、成交值前 120 名，日線通道糾纏的已跳過（${skipped} 檔）。分時資料來自 Yahoo 財經，約延遲 20 分鐘。` : '幣安成交額前 80 名永續合約。'}依分數由高到低排序；「觀察」預設收起，點上面的按鈕可以只看某一類。</p>
      <style>.vg-h{grid-column:1/-1;font-size:15px;margin:14px 0 0}.vg-h .muted{font-size:12.5px;font-weight:400}</style><div class="grid">${html || (st.loading ? '' : '<p class="muted">目前沒有符合的標的。</p>')}</div>`;
  }

  const toolbar = (m) => `<div class="toolbar">
        <button class="chip" data-m="crypto" aria-pressed="${m === 'crypto'}">加密（15分/1H/4H）</button>
        <button class="chip" data-m="tw" aria-pressed="${m === 'tw'}">台股（15分/1H/日線）</button>
        <input id="vg-q" class="search" type="search" placeholder="搜尋代號或名稱，按 Enter（例如 1815、富喬、BTC）" value="${esc(st.q || '')}" style="max-width:260px">
        <span class="spacer"></span><button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中 ' + st.progress : '重新整理'}</button></div>`;

  // 搜尋：不管有沒有訊號、有沒有被日線過濾、在不在清單裡都顯示
  function renderSearch(m, rows) {
    const q = st.q.toUpperCase();
    const hit = rows.filter((r) => r.s.toUpperCase().startsWith(q) || r.name.toUpperCase().includes(q));
    const why = (r) => {
      if (!r.data) return '資料還在載入';
      if (r.data.error) return '抓不到資料：' + r.data.error;
      if (m === 'tw' && !r.data['1d']?.smooth) return '日線通道糾纏，平常會被跳過';
      return grade(r, m) ? '' : '三個時區目前都沒有訊號';
    };
    el.innerHTML = toolbar(m) + `<p class="muted">搜尋「${esc(st.q)}」：${hit.length} 筆${st.searching ? '，查詢中…' : ''}</p><div class="grid">${hit.map((r) => { const w = why(r); return (w ? `<p class="muted" style="grid-column:1/-1;margin:6px 0 0">${esc(r.name)}：${esc(w)}</p>` : '') + (r.data && !r.data.error ? card(r, m) : ''); }).join('')}</div>`;
  }

  // 清單裡沒有的代號：直接向伺服器查
  async function lookup(m, q) {
    const rows = (st.rows[m] ||= []);
    const Q = q.toUpperCase();
    const have = rows.filter((r) => r.s.toUpperCase().startsWith(Q) || r.name.toUpperCase().includes(Q));
    // 在清單裡但還沒抓到資料（或抓失敗）→ 馬上單獨抓
    const need = have.filter((r) => !r.data || r.data.error);
    if (have.length && !need.length) return render();
    if (need.length) {
      st.searching = true; render();
      const res = await api(`/api/vegas?m=${m}&s=${need.slice(0, 6).map((r) => r.s).join(',')}`).catch(() => ({}));
      for (const r of need) if (res[r.s]) r.data = res[r.s];
      st.searching = false; return render();
    }
    let cands = m === 'tw' ? (/^\d{4}$/.test(Q) ? [Q + '.TW', Q + '.TWO'] : []) : [Q.endsWith('USDT') ? Q : Q + 'USDT'];
    // 台股用中文名稱搜尋：查全部上市櫃名單找代號
    if (m === 'tw' && !cands.length) {
      st.all ||= await api('/api/vegas?list=twall').catch(() => []);
      cands = st.all.filter((x) => x.name.includes(q)).slice(0, 3).map((x) => x.s);
    }
    if (!cands.length) return render();
    st.searching = true; render();
    for (const s of cands) {
      const res = await api(`/api/vegas?m=${m}&s=${s}`).catch(() => ({}));
      const d = res[s];
      const nm = st.all?.find((x) => x.s === s)?.name;
      if (d && !d.error && d['1h']) { rows.push({ s, name: m === 'tw' ? `${nm || s.replace(/\..*/, '')}${s.endsWith('.TWO') ? '（上櫃）' : ''}` : Q.replace(/USDT$/, ''), data: d }); if (/^\d{4}$/.test(Q) || m !== 'tw') break; }
    }
    st.searching = false; render();
  }

  el.addEventListener('keydown', (e) => {
    if (e.target.id !== 'vg-q' || e.key !== 'Enter') return;
    st.q = e.target.value.trim();
    if (st.q) lookup(st.m, st.q); else render();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m) { st.m = b.dataset.m; st.q = ''; render(); if (!st.loaded[st.m]) load(); }
    else if (b.dataset.g) { st.group = st.group === b.dataset.g ? null : b.dataset.g; render(); }
    else if (b.dataset.d) { const d = +b.dataset.d; st.dir = st.dir === d ? 0 : d; render(); }
    else if ('reload' in b.dataset) load(true);
  });
  return { load, render, get loaded() { return !!st.loaded[st.m]; } };
}
