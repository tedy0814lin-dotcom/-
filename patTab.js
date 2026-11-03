// 台股型態頁：掃描成交量前 300 檔上市股票的日線，列出「正在形成」（型態已成形、還沒突破頸線）和「已經形成」（最近 6 根內收盤突破頸線）的型態。
// 只做看圖參考：2026-11-03 台股 1,900 檔日線回測（扣 0.585%、前 75% 挑參數、後 25% 驗證），所有型態都沒有通過門檻，所以不計分、不推播。
import { PAT_NAME } from '/lib/chartPat.js';

const KEY = 'wr_pat_v1_';
const TOP = 300, BATCH = 15;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const taipeiDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const cacheGet = (day) => { try { return JSON.parse(localStorage.getItem(KEY + day)); } catch { return null; } };
function cacheSet(day, v) {
  try { Object.keys(localStorage).filter((k) => k.startsWith(KEY) && k !== KEY + day).forEach((k) => localStorage.removeItem(k)); localStorage.setItem(KEY + day, JSON.stringify(v)); } catch {}
}
const px = (v) => (v >= 100 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3)).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));

export function createPatTab({ api, el }) {
  const st = { loading: false, progress: '', error: '', loaded: false, results: {}, names: {}, scanned: 0, total: 0, miss: 0, day: '', kind: '' };

  async function load(force = false) {
    if (st.loading) return;
    const day = taipeiDay();
    const c = !force && cacheGet(day);
    if (c) { Object.assign(st, c, { loaded: true, error: '', progress: '' }); render(); return; }
    st.loading = true; st.error = ''; st.results = {}; st.miss = 0; render();
    try {
      st.progress = '正在取得台股清單…'; render();
      const tw = await api('/api/twstock');
      const rows = (tw.rows || []).filter((r) => r.volume >= 1000 && r.close >= 10 && /^\d{4}$/.test(r.code)).sort((a, b) => b.volume - a.volume).slice(0, TOP);
      st.names = Object.fromEntries(rows.map((r) => [r.code, r.name])); st.total = rows.length; st.scanned = 0;
      const codes = rows.map((r) => r.code);
      for (let i = 0; i < codes.length; i += BATCH) {
        st.progress = `掃描日線型態 ${Math.min(i + BATCH, codes.length)}/${codes.length}…第一次約 1～2 分鐘，今天之後直接用快取`; render();
        const j = await api(`/api/twhist?pat=1&codes=${codes.slice(i, i + BATCH).join(',')}`);
        Object.assign(st.results, j.results); st.miss += (j.miss || []).length; st.scanned = Math.min(i + BATCH, codes.length);
      }
      st.day = day; st.loaded = true; st.progress = '';
      cacheSet(day, { results: st.results, names: st.names, scanned: st.scanned, total: st.total, miss: st.miss, day });
    } catch (e) {
      st.error = `更新失敗：${e.message}`; st.progress = '';
    } finally { st.loading = false; render(); }
  }

  function list() {
    const forming = [], formed = [];
    for (const [code, r] of Object.entries(st.results)) {
      for (const f of r.forming || []) if (!st.kind || f.kind === st.kind) forming.push({ code, ...f });
      for (const f of r.formed || []) if (!st.kind || f.kind === st.kind) formed.push({ code, ...f });
    }
    forming.sort((a, b) => a.distPct - b.distPct);
    formed.sort((a, b) => a.ago - b.ago);
    return { forming, formed };
  }

  const nm = (code) => `<b class="num">${esc(code)}</b> ${esc(st.names[code] || '')}`;
  function tblForming(rows) {
    if (!rows.length) return '<div class="muted small">目前沒有符合的型態。</div>';
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>股票</th><th>型態</th><th class="n">收盤</th><th class="n">頸線（突破價）</th><th class="n">距頸線</th><th class="n">停損參考</th><th class="n">成形</th><th class="n">剩餘等待</th></tr></thead><tbody>${
      rows.map((f) => `<tr><td>${nm(f.code)}</td><td>${esc(PAT_NAME[f.kind] || f.kind)}</td><td class="n num">${px(f.last)}</td><td class="n num">${px(f.neck)}</td><td class="n num">${f.distPct.toFixed(1)}%</td><td class="n num">${px(f.stop)}<span class="muted small">（${((1 - f.stop / f.last) * 100).toFixed(1)}%）</span></td><td class="n num">${f.bornAgo} 根前</td><td class="n num">${f.left} 根</td></tr>`).join('')
    }</tbody></table></div>`;
  }
  function tblFormed(rows) {
    if (!rows.length) return '<div class="muted small">目前沒有符合的型態。</div>';
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>股票</th><th>型態</th><th class="n">收盤</th><th class="n">突破時間</th><th class="n">停損參考</th><th class="n">風險</th></tr></thead><tbody>${
      rows.map((f) => `<tr><td>${nm(f.code)}</td><td>${esc(PAT_NAME[f.kind] || f.kind)}</td><td class="n num">${px(f.last)}</td><td class="n num">${f.ago === 0 ? '最新一根' : f.ago + ' 根前'}</td><td class="n num">${px(f.stop)}</td><td class="n num">${((1 - f.stop / f.last) * 100).toFixed(1)}%</td></tr>`).join('')
    }</tbody></table></div>`;
  }

  function render() {
    if (!el.isConnected) return;
    const status = st.error ? `<div class="status err">${esc(st.error)}</div>` : '';
    if (!st.loaded) { el.innerHTML = `<div class="status">${esc(st.progress || (st.loading ? '準備中…' : ''))}</div>${status}`; return; }
    const { forming, formed } = list();
    const opts = ['<option value="">全部型態</option>', ...Object.entries(PAT_NAME).map(([k, v]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${v}</option>`)].join('');
    el.innerHTML = `
      <div class="toolbar"><div class="status" style="width:auto;flex:1">掃描成交量前 ${st.total} 檔上市股票（日線）・日期 ${esc(st.day)}・正在形成 ${forming.length} 檔／已經形成 ${formed.length} 檔${st.miss ? `・${st.miss} 檔沒抓到` : ''}${st.loading ? '・' + esc(st.progress) : ''}</div>
        <select id="pat-kind" class="sort" aria-label="型態">${opts}</select>
        <button class="refresh" id="pat-refresh" type="button" ${st.loading ? 'disabled' : ''}>${st.loading ? '掃描中…' : '重新掃描'}</button></div>
      ${status}
      <div class="status err" style="border:1px solid var(--down)">只供看圖參考：台股日線型態回測（約 1,900 檔、2020–2026，扣 0.585%、只做多）沒有任何一個型態通過門檻，所以這裡<b>不計分、不推播</b>，不要當作進場訊號。</div>
      <section class="panel">
        <div class="panel-head"><strong>正在形成</strong><span class="muted small">型態已成形（低點、高點確認），收盤還沒站上頸線，離頸線越近越前面</span></div>
        ${tblForming(forming)}
      </section>
      <section class="panel">
        <div class="panel-head"><strong>已經形成</strong><span class="muted small">最近 6 根內收盤突破頸線，現價仍在停損參考之上</span></div>
        ${tblFormed(formed)}
      </section>
      <details class="guide">
        <summary>怎麼判斷的</summary>
        <dl>
          <dt>找高低點</dt><dd>用 ATR 之字轉折：價格反向走超過 2～3 倍 ATR 才確認一個高點或低點，反轉後才確認，不會偷看未來。K 棒影線最多只算到實體外 1 ATR，避免插針。</dd>
          <dt>型態</dt><dd>雙底、三重底、頭肩底、矩形整理、上升三角形、對稱三角形、下降楔形（都是做多方向的底部／整理型態）。兩個高低點允許約 3% 誤差，左右時間要大致對稱。</dd>
          <dt>正在形成／已經形成</dt><dd>型態成形後最多等 15 根日線；收盤站上頸線就算突破。「已經形成」只列最近 6 根內突破的。停損參考＝型態最低點下 0.1 倍 ATR。</dd>
          <dt>限制</dt><dd>只掃成交量前 ${TOP} 檔上市股票；Yahoo 資料偶爾缺漏。偵測邏輯跟加密貨幣頁用同一套（已和 Python 回測逐根對照）；加密貨幣在 4H／12H 有部分型態通過回測，台股日線沒有。</dd>
        </dl>
      </details>`;
    el.querySelector('#pat-refresh').onclick = () => load(true);
    el.querySelector('#pat-kind').onchange = (e) => { st.kind = e.target.value; render(); };
  }

  return { load, render, get loaded() { return st.loaded; }, get loading() { return st.loading; } };
}
