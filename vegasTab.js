// 維加斯通道分頁：加密（15 分 / 1 小時 / 4 小時）、台股（15 分 / 1 小時 / 日線）
const TFS = { crypto: ['15m', '1h', '4h'], tw: ['15m', '1h', '1d'] };
const TFN = { '15m': '15 分', '1h': '1 小時', '4h': '4 小時', '1d': '日線' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));

// 等級：確認 = 中；大一級時區剛好在通道裡（同方向）= 強；15 分單獨確認 = 當沖；風報比 < 1 或逆大週期 = 弱
function grade(r, m) {
  const tfs = TFS[m];
  let best = null;
  tfs.forEach((tf, k) => {
    const v = r.data?.[tf];
    if (!v?.now) return;
    const n = v.now, up = r.data[tfs[k + 1]];
    let lv = 0, notes = [];
    if (n.status === '確認') {
      lv = 2;
      if (up && up.inTunnel === n.dir) { lv = 3; notes.push(`${TFN[tfs[k + 1]]}剛好在通道`); }
      if (up && up.trend === -n.dir) { lv = 1; notes.push(`逆${TFN[tfs[k + 1]]}趨勢`); }
      if (n.rr < 1) { lv = 1; notes.push('風報比不足'); }
      if (tf === '15m' && lv === 2) notes.push('當沖');
    } else {
      // 還沒確認也先提醒：碰通道 → 突破 EMA12 → 回踩完成，一步一步升級
      lv = n.status === '回踩完成' ? 0.8 : n.status === '已突破EMA12' ? 0.6 : 0.3;
      if (up && up.inTunnel === n.dir) { lv += 0.1; notes.push(`${TFN[tfs[k + 1]]}也在通道`); }
    }
    if (!best || lv > best.lv) best = { lv, tf, n, notes };
  });
  return best;
}

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
      for (let i = 0; i < L.length; i += size) {
        st.progress = `${Math.min(i + size, L.length)} / ${L.length}`; render();
        const part = await api(`/api/vegas?m=${m}&s=${L.slice(i, i + size).map((x) => x.s).join(',')}`).catch((e) => ({ _err: e.message }));
        for (const r of st.rows[m]) if (part[r.s]) r.data = part[r.s];
        if (part._err) st.error = part._err;
        if (st.m !== m) break;
      }
      st.loaded[m] = true;
    } catch (e) { st.error = e.message; }
    st.loading = false; st.progress = ''; render();
  }

  function card(r, m) {
    const g = grade(r, m), bt = bestTf(r, m);
    const n = g?.n;
    const dirTxt = n ? (n.dir > 0 ? '做多' : '做空') : '';
    const lvTxt = !g ? '' : g.lv >= 3 ? '強' : g.lv >= 2 ? '中' : g.lv >= 1 ? '弱' : g.lv >= 0.8 ? '等突破高點' : g.lv >= 0.6 ? '有機會' : '碰通道';
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
    const graded = rows.filter((r) => r.data).map((r) => ({ r, g: grade(r, m) }));
    const shown = graded.filter((x) => st.showAll || (x.g && x.g.lv >= 0.3)).sort((a, b) => (b.g?.lv || 0) - (a.g?.lv || 0));
    el.innerHTML = `<div class="toolbar">
        <button class="chip" data-m="crypto" aria-pressed="${m === 'crypto'}">加密（15分/1H/4H）</button>
        <button class="chip" data-m="tw" aria-pressed="${m === 'tw'}">台股（15分/1H/日線）</button>
        <button class="chip" data-all aria-pressed="${st.showAll}">顯示全部</button>
        <span class="spacer"></span><button class="ghost" data-reload ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中 ' + st.progress : '重新整理'}</button></div>
      ${st.error ? `<div class="panel warn">${esc(st.error)}</div>` : ''}
      <p class="muted">${m === 'tw' ? '股價 10–200 元、成交值前 120 名。分時資料來自 Yahoo 財經，約延遲 20 分鐘。' : '幣安成交額前 40 名永續合約。'}只要碰到通道、突破 EMA12、回踩完成、確認任何一步就會列出來，越後面的步驟排越前面。</p>
      <div class="grid">${shown.map((x) => card(x.r, m)).join('') || (st.loading ? '' : '<p class="muted">目前沒有符合的標的。</p>')}</div>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m) { st.m = b.dataset.m; render(); if (!st.loaded[st.m]) load(); }
    else if ('all' in b.dataset) { st.showAll = !st.showAll; render(); }
    else if ('reload' in b.dataset) load(true);
  });
  return { load, render, get loaded() { return !!st.loaded[st.m]; } };
}
