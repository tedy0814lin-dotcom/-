// 因子組合（觀察用）：台股四因子排名＋前瞻記錄。不是買賣訊號、不計分、不推播。
// 研究與規格見 lib/factorTw.js、專案文件「多因子系統設計與網站診斷」。前瞻記錄從上線日起累積（每天收盤後存當天前 20 名與收盤價）。
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v.toFixed(2));
const FNAME = { h250: '近 250 日高', mom: '120 日動能', intra: '日內強', vol: '量增' };

export function createFactTab({ api, el }) {
  const st = { loading: false, error: '', data: null, loaded: false, all: false };

  async function load(force = false) {
    if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try { st.data = await api('/api/factor'); st.loaded = true; }
    catch (e) { st.error = e.message || String(e); }
    finally { st.loading = false; render(); }
  }

  // 前瞻：每個記錄日的前 20 名等權（隔天開盤買的近似＝用當天收盤價），到現在的報酬 vs 0050（未扣成本）
  function forward(d) {
    const rows = [];
    for (const e of d.log || []) {
      if (e.day >= d.asof) continue;
      const rs = e.picks.map(([c, p0]) => (d.closes[c] != null && p0 > 0 ? d.closes[c] / p0 - 1 : null)).filter((x) => x != null);
      if (rs.length < 10) continue;
      const r = rs.reduce((a, b) => a + b, 0) / rs.length, b = e.bm && d.bm ? d.bm / e.bm - 1 : null;
      rows.push({ day: e.day, n: rs.length, r, b, ex: b == null ? null : r - b });
    }
    return rows;
  }

  function render() {
    const d = st.data;
    const head = `<div class="status err" style="border:1px solid var(--down)"><b>觀察用，不是買賣訊號。</b>四因子排名在回測的訓練期 9 組參數全部贏 0050，但驗證期（2025-05 之後的大多頭）只有 1 組贏 0050；回測有倖存者偏誤（下市股不在內），2022 年虧損。所以只從上線日起做前瞻記錄，累積夠久再判斷。</div>`;
    if (st.loading && !d) { el.innerHTML = head + '<div class="status">讀取中…</div>'; return; }
    if (st.error && !d) { el.innerHTML = head + `<div class="status err">${esc(st.error)}</div><button class="refresh" id="fa-r" type="button">重試</button>`; el.querySelector('#fa-r').onclick = () => load(true); return; }
    if (!d) { el.innerHTML = head; return; }
    const top = st.all ? d.top : d.top.slice(0, 20);
    const fw = forward(d), first = (d.log || [])[0]?.day;
    const trs = top.map((t, i) => `<tr><td class="num">${i + 1}</td><td><b class="num">${esc(t.code)}</b> ${esc(t.name)}</td><td class="num">${px(t.c)}</td><td class="num"><b>${(t.score * 100).toFixed(0)}</b></td>
      <td class="num">${Math.round(t.rank.h250 * 100)}<span class="muted small"> (${pct(t.raw.h250 - 1, 0)})</span></td><td class="num">${Math.round(t.rank.mom * 100)}<span class="muted small"> (${pct(t.raw.mom, 0)})</span></td>
      <td class="num">${Math.round(t.rank.intra * 100)}<span class="muted small"> (${pct(t.raw.intra, 0)})</span></td><td class="num">${Math.round(t.rank.vol * 100)}<span class="muted small"> (×${t.raw.vol.toFixed(1)})</span></td></tr>`).join('');
    const frows = fw.slice(-12).reverse().map((r) => `<tr><td class="num">${esc(r.day)}</td><td class="num">${r.n}</td><td class="num ${r.r >= 0 ? 'up' : 'down'}">${pct(r.r)}</td><td class="num">${pct(r.b)}</td><td class="num ${r.ex == null ? '' : r.ex >= 0 ? 'up' : 'down'}">${pct(r.ex)}</td></tr>`).join('');
    const avgEx = fw.filter((r) => r.ex != null);
    el.innerHTML = `${head}
      <div class="toolbar"><div class="status" style="width:auto;flex:1">收盤日 ${esc(d.asof)}・可交易股票 ${d.universe} 檔（近 20 日均量 ≥1000 張、股價 ≥10、近 61 日無除權息／斷點）・四因子百分位平均＝總分</div><button class="refresh" id="fa-r" type="button" ${st.loading ? 'disabled' : ''}>重新讀取</button></div>
      <section class="panel"><div class="panel-head"><strong>今日前 ${top.length} 名</strong><button class="ghost" id="fa-more" type="button">${st.all ? '只看前 20' : '看前 50'}</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>股票</th><th class="n">收盤</th><th class="n">總分</th><th>${FNAME.h250}<br><span class="muted small">百分位（離高點）</span></th><th>${FNAME.mom}<br><span class="muted small">（略過近 20 日）</span></th><th>${FNAME.intra}<br><span class="muted small">（20 日開收和）</span></th><th>${FNAME.vol}<br><span class="muted small">5 日÷60 日均量</span></th></tr></thead><tbody>${trs}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><strong>前瞻記錄</strong><span class="muted small">從 ${esc(first || d.asof)} 起累積（每天收盤後存當天前 20 名）</span></div>
        ${fw.length ? `<div class="status">已有 ${fw.length} 個記錄日可比較；平均贏 0050 ${avgEx.length ? pct(avgEx.reduce((a, r) => a + r.ex, 0) / avgEx.length) : '—'}（各記錄日起算、天數不同、未扣成本，僅供看趨勢）。真正的策略是每 20 個交易日換一次股，要累積 20 個交易日以上才有意義。</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>記錄日</th><th>檔數</th><th>前 20 名等權至今</th><th>0050 至今</th><th>差</th></tr></thead><tbody>${frows}</tbody></table></div>` : '<div class="status">今天是第一筆記錄，明天起才看得到「記錄日至今」的報酬。</div>'}</section>
      <details class="guide"><summary>這個組合是什麼、回測怎麼來的</summary><dl>
        <dt>做法</dt><dd>在「可交易股票」裡，四個因子各自轉成 0～100 百分位，平均＝總分；總分最高的前 20 名等權持有，每 20 個交易日重排、隔天開盤換股。四個因子是從 22 個因子裡<b>只用訓練期（2025-05 以前）</b>挑出、彼此相關 &lt;0.5 的：離 250 日高點近（強勢股）、120 日動能（略過最近 20 日）、日內強（開盤到收盤長期偏強＝盤中買盤強）、量增。</dd>
        <dt>回測（台股約 1,371 檔、2020-10～2026-10、隔天開盤換股、來回 0.585%）</dt><dd>前 20 名／每 20 日：訓練期年化 +31.9%、驗證期 +77.0%、全期 +43.4%、最大回撤 −50%；同期 0050 是 +6.5%、+80.6%、+23.8%、−36%。換 9 組參數（前 10／20／30 名 × 每 10／20／40 日）：訓練期 9/9 贏 0050、全期 8/9，但驗證期只有 1/9 贏。四個因子合起來明顯優於任何單一因子（單因子訓練期只有 −0.7%～+9.3%）。</dd>
        <dt>跟大單推升的關係</dt><dd>兩者都是台股做多強勢股，日報酬相關約 0.6，不算無相關。回測過「大單推升（排除頂背離）＋四因子各半」，全期 +42.2%／回撤 −38%，但「排除頂背離」在上市驗證不成立，所以網站沒有採用。</dd>
        <dt>限制</dt><dd>① 倖存者偏誤（只含現存股票）。② 驗證期是大多頭，這類強勢股策略在大多頭本來就容易跟上。③ 2022 年虧損（−8%～−21%）。④ 最大回撤 −50%，比 0050 深。⑤ 排名用的資料是 Yahoo 日 K（未還原的收盤價，除權息前後 61 日內的股票直接排除）。⑥ 這裡的前瞻績效以記錄日收盤價計，未扣成本、未模擬換股，只是看趨勢。</dd>
      </dl></details>`;
    el.querySelector('#fa-r').onclick = () => load(true);
    el.querySelector('#fa-more').onclick = () => { st.all = !st.all; render(); };
  }

  return { load, render, get loaded() { return st.loaded; }, get loading() { return st.loading; } };
}
