// 維加斯通道分頁：加密（15 分 / 1 小時 / 4 小時）、台股（15 分 / 1 小時 / 日線）
import { volumeProfile, vpSVG, VP_ROWS } from '/vprofile.js';
const TFS = { crypto: ['15m', '1h', '4h'], tw: ['15m', '1h', '1d'] };
const TFN = { '15m': '15 分', '1h': '1 小時', '4h': '4 小時', '1d': '日線' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const pad2 = (n) => String(n).padStart(2, '0');
function fmtT(ts, tf) {
  if (!ts) return '';
  const d = new Date(ts), md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return tf === '1d' ? md : `${md} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
// 畫維加斯通道看圖：K 線＋EMA12＋小通道(144/169)＋大通道(288/338)＋VPVR＋進場/停損/目標
function drawVegas(cd, now, tf) {
  const bars = cd.bars, N = bars.length; if (!N) return '';
  const Wd = 1000, Ht = 430, pt = 8, Hv = 54, pr = 48, px0 = 6, xr = Wd - pr;
  const ph = Ht - pt - 16 - Hv - 6, pw = xr - px0, dx = pw / N, bw = Math.max(1.2, dx * 0.6);
  const X = (i) => px0 + (i + 0.5) * dx;
  const mk = [now?.entry, now?.stop, now?.target].filter((v) => v > 0);
  let lo = Math.min(...bars.map((b) => b[2]), ...cd.bBot.filter((v) => v > 0), ...mk);
  let hi = Math.max(...bars.map((b) => b[1]), ...cd.sTop, ...mk);
  const pdv = (hi - lo) * 0.04; lo -= pdv; hi += pdv;
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph;
  const vmax = Math.max(...bars.map((b) => b[4]), 1), yv = (v) => Ht - 16 - (v / vmax) * Hv;
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" class="pc" role="img" aria-label="維加斯通道 K 線圖">`;
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); s += `<line x1="${px0}" x2="${xr}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="pc-g"/><text x="${xr + 4}" y="${(y + 3).toFixed(1)}" class="pc-t">${px(v)}</text>`; }
  // 通道帶（大在下層、小在上層）
  const band = (top, bot, cls) => { let u = '', d = ''; for (let i = 0; i < N; i++) { u += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(top[i]).toFixed(1)} `; } for (let i = N - 1; i >= 0; i--) d += `L${X(i).toFixed(1)} ${Y(bot[i]).toFixed(1)} `; return `<path d="${u}${d}Z" class="${cls}"/>`; };
  const edge = (arr, cls) => `<polyline points="${arr.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" class="${cls}"/>`;
  // 淡填色＋明亮上下緣線：通道清楚但不蓋住 K 棒
  s += band(cd.bTop, cd.bBot, 'vg-tun-b') + band(cd.sTop, cd.sBot, 'vg-tun-s');
  s += edge(cd.bTop, 'vg-tun-b-ln') + edge(cd.bBot, 'vg-tun-b-ln') + edge(cd.sTop, 'vg-tun-s-ln') + edge(cd.sBot, 'vg-tun-s-ln');
  // VPVR（左）
  const vp = volumeProfile(bars, lo, hi); if (vp) s += vpSVG(vp, { left: px0, right: xr, yOf: Y, rowPix: ph / VP_ROWS, pw: 170, side: 'left', pxfmt: px });
  // K 棒＋量
  bars.forEach((b, i) => {
    const up = b[3] >= b[0], c = up ? 'pc-u' : 'pc-d', x = X(i);
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(b[1]).toFixed(1)}" y2="${Y(b[2]).toFixed(1)}" class="${c}s"/>`;
    const y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3]));
    s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y2 - y1).toFixed(1)}" class="${c}"/>`;
    s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${yv(b[4]).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Ht - 16 - yv(b[4])).toFixed(1)}" class="${c} pc-v"/>`;
  });
  for (const i of [0, 2, 4, 6].map((k) => Math.round((k * (N - 1)) / 6))) s += `<text x="${X(i).toFixed(1)}" y="${Ht - 2}" class="pc-t" text-anchor="${i === 0 ? 'start' : i >= N - 1 ? 'end' : 'middle'}">${esc(fmtT(cd.t[i], tf))}</text>`;
  return s + '</svg>';
}

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
    // 2026-10-29 回測（加密 4H 4 年、台股日線 10 年，扣手續費）加減分，只用在加密 4H、台股日線
    if ((m === 'crypto' && tf === '4h') || (m === 'tw' && tf === '1d')) {
      if (m === 'crypto' && n.dir > 0) {
        if (n.dist != null && n.dist < 2) { sc += 10; notes.push('進場離大通道 <2ATR（回測 +0.19R）'); }
        if (n.spread != null && n.spread < 1) { sc += 8; notes.push('通道還沒拉開 <1ATR（回測 +0.20R）'); }
        if (n.spread != null && n.spread >= 2) { sc -= 8; notes.push('通道拉太開（回測較差）'); }
      }
      if (m === 'crypto' && n.dir < 0) {
        if (n.spread != null && n.spread < 1) { sc += 12; notes.push('通道還沒拉開 <1ATR（做空回測 +0.81R，樣本 153）'); }
        if (n.tunnel === '大') { sc += 8; notes.push('大通道（做空回測 +0.33R）'); }
      }
      if (m === 'tw' && n.dir > 0) {
        if (n.tunnel === '大') { sc += 10; notes.push('大通道（台股回測 +0.55R，隨機做多 +0.20R）'); }
        if (n.spread != null && n.spread < 2) { sc += 6; notes.push('通道距離 <2ATR（回測較好）'); }
        if (n.spread != null && n.spread >= 2 && n.spread < 4) { sc -= 8; notes.push('通道距離 2～4ATR（回測幾乎沒優勢）'); }
      }
      // 諧波共振：同方向、回測有效的型態；D 在通道上再加分
      const h = v.harm, good = m === 'crypto' ? (n.dir > 0 ? ['Gartley', 'Butterfly', 'Crab', 'Deep Crab'] : []) : (n.dir > 0 ? ['Bat', 'Crab', 'Gartley', 'Cypher'] : []);
      if (h && h.dir === n.dir && h.ago <= 10 && good.includes(h.name)) {
        sc += 10; notes.push(`諧波 ${h.name} 同方向${h.inSmall || h.inBig ? '，D 在' + (h.inBig ? '大' : '小') + '通道' : ''}`);
        if (h.inSmall || h.inBig) sc += 5;
      }
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
  const st = { m: 'crypto', list: {}, rows: {}, loading: false, progress: '', error: '', showAll: false, loaded: {}, charts: {} };

  function chartBlock(r, m, ex) {
    const tfBtns = TFS[m].map((tf) => `<button class="chip vg-tf" data-ctf="${esc(r.s)}|${tf}" aria-pressed="${ex.tf === tf}">${TFN[tf]}</button>`).join('');
    const body = ex.loading ? '<div class="muted small" style="padding:10px">載入中…</div>'
      : ex.err ? `<div class="muted small" style="padding:10px">抓不到資料：${esc(ex.err)}</div>`
      : ex.data && ex.data.bars?.length ? drawVegas(ex.data, r.data?.[ex.tf]?.now, ex.tf) : '<div class="muted small" style="padding:10px">資料不足，畫不出來</div>';
    return `<div class="vg-chart"><div class="vg-tfbar">${tfBtns}<span class="muted small">訊號在哪個時區就看哪個；想看整體趨勢、價格在高量牆還是真空帶，就切到高時區</span></div>${body}</div>`;
  }
  async function loadChart(sym, tf) {
    st.charts[sym] = { tf, loading: true }; render();
    const get = () => api(`/api/vegas?chart=1&m=${st.m}&s=${encodeURIComponent(sym)}&tf=${tf}`);
    try { st.charts[sym] = { tf, data: await get() }; }
    catch (e1) { // 幣安偶爾限流（429），隔 1.5 秒自動再試一次
      await new Promise((r) => setTimeout(r, 1500));
      if (st.charts[sym]?.tf !== tf) return;
      try { st.charts[sym] = { tf, data: await get() }; } catch (e2) { st.charts[sym] = { tf, err: e2.message }; }
    }
    render();
  }

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
      const H = v.harm;
      if (H && H.ago <= 10) now += `${now ? '<br>' : ''}<span class="${H.dir > 0 ? 'up' : 'down'}">諧波 ${esc(H.name)} ${H.dir > 0 ? '看漲' : '看跌'}</span> D ${px(H.D)}（${H.ago} 根前）${H.inBig ? '・D 在大通道' : H.inSmall ? '・D 在小通道' : ''}・停損 ${px(H.stop)}`;
      const s = v.stats;
      const stat = s ? `<span class="muted">訊號勝率 ${s.winRate ?? '—'}%（${s.n}）・小通道反應 ${s.small.rate ?? '—'}%（${s.small.n}）・大通道 ${s.big.rate ?? '—'}%（${s.big.n}）</span>` : '';
      return `<div class="vg-row"><span class="k">${TFN[tf]}</span>${tr}${now ? ' ・ ' + now : ''}<div>${stat}</div></div>`;
    }).join('');
    const tip = bt ? `<div class="muted">這檔歷史上 <b>${TFN[bt.tf]}</b> 最有效（勝率 ${bt.rate}%，${bt.n} 次）</div>` : '';
    const ex = st.charts[r.s];
    const cbtn = `<button class="ghost vg-cbtn" data-chart="${esc(r.s)}">${ex ? '收起圖' : '展開看圖（K 線＋通道＋成交量分布）'}</button>`;
    return `<article class="card"><div class="card-head"><span class="sym num">${esc(r.name)}</span>${badge}
      <div class="price"><span class="p num">${px(r.data?.[TFS[m][0]]?.price)}</span></div></div>
      ${g?.notes?.length ? `<div class="muted">${esc(g.notes.join('・'))}</div>` : ''}${rowsHtml}${tip}
      <div class="vg-cwrap">${cbtn}${ex ? chartBlock(r, m, ex) : ''}</div></article>`;
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
    if (b.dataset.chart) {
      const sym = b.dataset.chart;
      if (st.charts[sym]) { delete st.charts[sym]; render(); }
      else { const r = (st.rows[st.m] || []).find((x) => x.s === sym); const tf = grade(r, st.m)?.tf || bestTf(r, st.m)?.tf || TFS[st.m][TFS[st.m].length - 1]; loadChart(sym, tf); }
    }
    else if (b.dataset.ctf) { const [sym, tf] = b.dataset.ctf.split('|'); if (st.charts[sym]?.tf !== tf || st.charts[sym]?.err) loadChart(sym, tf); }
    else if (b.dataset.m) { st.m = b.dataset.m; st.q = ''; render(); if (!st.loaded[st.m]) load(); }
    else if (b.dataset.g) { st.group = st.group === b.dataset.g ? null : b.dataset.g; render(); }
    else if (b.dataset.d) { const d = +b.dataset.d; st.dir = st.dir === d ? 0 : d; render(); }
    else if ('reload' in b.dataset) load(true);
  });
  return { load, render, get loaded() { return !!st.loaded[st.m]; } };
}
