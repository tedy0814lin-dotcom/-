// 足跡圖「Delta 階梯」頁：掃幣安 4H，列出今天完成階梯的做多／做空訊號（含迷你 K 線與 Delta 柱）。
// 規則與回測見 lib/footprint.js。連 2 根買(賣)Delta 強＋價格一階階創高(低) → 下一根開盤進、停損型態低(高)、3R 出場。
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : Number(v).toPrecision(3));
const nm = (s) => s.replace(/USDT$/, '');

// 迷你圖：K 線在上、Delta 柱在下（綠＝淨買、紅＝淨賣），畫進場/停損/目標線
function mini(r) {
  const B = r.bars, N = B.length, W = 360, H = 170, pr = 46, pt = 6, Hd = 38, ph = H - pt - Hd - 6;
  let lo = Math.min(...B.map((b) => b[2]), r.stop, r.target), hi = Math.max(...B.map((b) => b[1]), r.stop, r.target);
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const dx = (W - pr) / N, bw = Math.max(1, dx * 0.6), X = (i) => (i + 0.5) * dx, Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph;
  const dmax = Math.max(...B.map((b) => Math.abs(b[4])), 1), yd = (v) => (H - 6 - Hd / 2) - (v / dmax) * (Hd / 2);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="cs-mini" role="img" aria-label="${esc(nm(r.sym))} Delta 階梯">`;
  // Delta 零線
  s += `<line x1="0" x2="${W - pr}" y1="${(H - 6 - Hd / 2).toFixed(1)}" y2="${(H - 6 - Hd / 2).toFixed(1)}" class="pc-g"/>`;
  B.forEach((b, i) => {
    const up = b[3] >= b[0], cl = up ? 'pc-u' : 'pc-d', x = X(i);
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(b[1]).toFixed(1)}" y2="${Y(b[2]).toFixed(1)}" class="${cl}s"/>`;
    const y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3]));
    s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.8, y2 - y1).toFixed(1)}" class="${cl}"/>`;
    // Delta 柱
    const d0 = H - 6 - Hd / 2, dy = yd(b[4]);
    s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${Math.min(d0, dy).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.6, Math.abs(dy - d0)).toFixed(1)}" class="${b[4] >= 0 ? 'fp-dp' : 'fp-dn'}"/>`;
  });
  const line = (v, cls, lab) => `<line x1="0" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="${cls}"/><text x="${W - pr + 3}" y="${(Y(v) + 3).toFixed(1)}" class="pc-t ${cls}-t">${lab}</text>`;
  s += line(r.close, 'vg-entry', '進');
  s += line(r.stop, 'vg-stop', '損');
  s += line(r.target, 'vg-target', '標');
  return s + '</svg>';
}

function card(r, dir) {
  return `<article class="pc-card"><header><div><b>${esc(nm(r.sym))}</b> <span class="cat ${dir > 0 ? 'cat-long' : 'cat-short'}">${dir > 0 ? '做多' : '做空'}</span></div>
    <div class="muted small">Delta 強度 <b class="num">${r.dn > 0 ? '+' : ''}${r.dn}×</b></div></header>${mini(r)}
    <div class="muted small">進場 <b class="num">${px(r.close)}</b>・停損 <b class="num">${px(r.stop)}</b>（${r.riskPct}%）・目標 <b class="num">${px(r.target)}</b>（3R）</div></article>`;
}

export function createFootTab({ api, el }) {
  const st = { loading: false, error: '', data: null };
  async function load(force = false) {
    if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try { st.data = await api('/api/twhist?fp=1' + (force ? '&force=1' : '')); }
    catch (e) { st.error = `更新失敗：${e.message}`; }
    finally { st.loading = false; render(); }
  }
  function render() {
    if (!el.isConnected) return;
    const d = st.data;
    const head = `<div class="toolbar"><div class="status" style="width:auto;flex:1">${d ? `資料到 ${esc(d.asOf)}（UTC・4H 收盤）・掃描 ${d.scanned} 個 USDT 永續${d.cached ? '・10 分鐘內快取' : ''}` : st.loading ? '掃描中（約 10～30 秒）…' : ''}</div>
      <button class="refresh" id="fp-refresh" type="button" ${st.loading ? 'disabled' : ''}>${st.loading ? '掃描中…' : '重新掃描'}</button></div>${st.error ? `<div class="status err">${esc(st.error)}</div>` : ''}`;
    const rules = `
      <section class="panel"><div class="panel-head"><strong>Delta 階梯（足跡圖訂單流・加密 4H・多空）</strong><span class="muted small">完全由 Claude 設計與回測</span></div>
        <ol class="cs-rules">
          <li><b>概念</b>：足跡圖看每根 K 棒的主動買／賣（Delta）。這裡抓「買盤一階一階把價格推上去」的連續堆疊。</li>
          <li><b>做多訊號</b>：連續 2 根 4H，每根都 ①淨買 Delta 強（≥ 近 50 根平均的 2 倍）②創新高 ③收紅 → <b>下一根 4H 開盤進場</b>。</li>
          <li><b>做空</b>：完全相反（連 2 根淨賣 Delta 強＋創新低＋收綠）。</li>
          <li><b>停損／出場</b>：停損＝這 2 根的最低（最高）點下（上）緣；<b>3R 出場</b>（賺到風險的 3 倍）。</li>
        </ol>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>回測（150 主流幣・4H・扣費・事件層級）</th><th class="n">每筆期望</th><th class="n">贏隨機</th><th class="n">訓練/驗證</th></tr></thead><tbody>
          <tr><td>做多（連 2 根）</td><td class="n num">+0.20R</td><td class="n num">隨機 −0.02</td><td class="n num">+0.19 / +0.20</td></tr>
          <tr><td>做空（連 2 根）</td><td class="n num">+0.11R</td><td class="n num">隨機 −0.03</td><td class="n num">+0.09 / +0.14</td></tr>
        </tbody></table></div>
        <p class="muted small">投組層級（多空、每筆風險 0.5%、複利扣費）：全期年化 +28%、最大回撤 −46%（持有 BTC +44%／−77%）；驗證期 +50%（BTC −11%）。<b>單用普通，真正的價值是分散</b>——和「大陽線突破」合併（相關 −0.07）全期 +55%、回撤 −37%，報酬與風險都贏 BTC；再配台股部位（相關 −0.01）回撤再腰斬。勝率約 30%，靠少數大波段；2022 空頭年做多為負；對手續費敏感。這是訂單流回測研究，不是投資建議。</p>
      </section>`;
    if (!d) { el.innerHTML = head + rules; bind(); return; }
    const sec = (title, arr, dir) => `<section class="panel"><div class="panel-head"><strong>${title}</strong><span class="muted small">${arr.length} 個</span></div>${
      arr.length ? `<div class="cs-grid">${arr.map((r) => card(r, dir)).join('')}</div>` : '<div class="muted small">目前沒有這個方向的新訊號。</div>'}</section>`;
    el.innerHTML = head + sec('今天做多訊號', d.long, 1) + sec('今天做空訊號', d.short, -1) + rules;
    bind();
  }
  function bind() { const b = el.querySelector('#fp-refresh'); if (b) b.onclick = () => load(true); }
  return { load, render, get loaded() { return !!st.data; }, get loading() { return st.loading; } };
}
