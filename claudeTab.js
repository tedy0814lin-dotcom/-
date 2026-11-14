// Claude 策略頁：完全由 Claude 設計、回測的策略（與使用者自己的規則分開放）
// 目前一個：「大陽線突破新高＋大盤濾網＋寬追蹤停損」（加密貨幣日線，只做多）。規則與回測見 lib/claudeStrat.js。
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : Number(v).toPrecision(3));
const nm = (s) => s.replace(/USDT$/, '');
const rc = (r) => (r > 0 ? 'up' : r < 0 ? 'down' : '');

function mini(t) {
  const B = t.bars, N = B.length, W = 360, H = 150, pr = 46, pt = 6, pb = 6;
  const sIdx = N - 1 - t.days; // 訊號那根在陣列裡的位置
  let lo = Math.min(...B.map((b) => b[2]), t.stop, t.stop0), hi = Math.max(...B.map((b) => b[1]), t.entry);
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const dx = (W - pr) / N, bw = Math.max(1, dx * 0.6), X = (i) => (i + 0.5) * dx, Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="cs-mini" role="img" aria-label="${esc(nm(t.sym))} 走勢">`;
  B.forEach((b, i) => {
    const up = b[3] >= b[0], cl = up ? 'pc-u' : 'pc-d', x = X(i);
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(b[1]).toFixed(1)}" y2="${Y(b[2]).toFixed(1)}" class="${cl}s"/>`;
    const y1 = Y(Math.max(b[0], b[3])), y2 = Y(Math.min(b[0], b[3]));
    s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.8, y2 - y1).toFixed(1)}" class="${cl}"/>`;
  });
  const line = (v, cls, lab) => `<line x1="0" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="${cls}"/><text x="${W - pr + 3}" y="${(Y(v) + 3).toFixed(1)}" class="pc-t">${lab}</text>`;
  s += line(t.entry, 'cs-entry', '進場');
  s += line(t.stop, 'pc-stop', '停損');
  if (sIdx >= 0 && sIdx < N) s += `<path d="M${X(sIdx).toFixed(1)} ${(Y(B[sIdx][2]) + 10).toFixed(1)} l-4 7 h8 z" class="pc-brk"/>`;
  return s + '</svg>';
}

export function createClaudeTab({ api, el }) {
  const st = { loading: false, error: '', data: null, rulesOpen: false };
  async function load(force = false) {
    if (st.loading) return;
    st.loading = true; st.error = ''; render();
    try { st.data = await api('/api/twhist?cs=1' + (force ? '&force=1' : '')); }
    catch (e) { st.error = `更新失敗：${e.message}`; }
    finally { st.loading = false; render(); }
  }
  function render() {
    if (!el.isConnected) return;
    const d = st.data;
    const head = `<div class="toolbar"><div class="status" style="width:auto;flex:1">${d ? `資料到 ${esc(d.asOf)}（UTC 日 K 收盤）・掃描 ${d.scanned} 個 USDT 永續・BTC 大盤：<b class="${d.btc.up ? 'up' : 'down'}">${d.btc.up ? '多頭（收盤在 50 日線上，可以開新倉）' : '空頭（收盤在 50 日線下，不開新倉、持倉停損收緊到 2.5 ATR）'}</b>${d.cached ? '・10 分鐘內快取' : ''}` : st.loading ? '掃描中（約 10～30 秒）…' : ''}</div>
      <button class="refresh" id="cs-refresh" type="button" ${st.loading ? 'disabled' : ''}>${st.loading ? '掃描中…' : '重新掃描'}</button></div>${st.error ? `<div class="status err">${esc(st.error)}</div>` : ''}`;
    const rules = `
      <section class="panel">
        <details class="fold" ${st.rulesOpen ? 'open' : ''}><summary><strong>大陽線突破新高＋寬追蹤停損（加密日線，只做多）</strong><span class="muted small">規則與回測（點開展開）</span></summary>
        <p class="muted small">完全由 Claude 設計與回測；借用你的「大陽線」「BTC 大盤濾網」規則</p>
        <ol class="cs-rules">
          <li><b>可交易</b>：近 20 天平均成交額 ≥2,000 萬美元、上市滿 120 天。</li>
          <li><b>大盤</b>：BTC 日線收盤在 50 日均線之上才開新倉。</li>
          <li><b>訊號</b>（同一根日 K 同時成立）：大陽線（收−開 ≥1 倍 ATR14）、收盤 ≥ 前 55 天最高價、成交額 ≥ 前 20 天平均 1.5 倍 → <b>隔天開盤進場</b>。</li>
          <li><b>停損</b>：訊號那根最低點。之後追蹤停損＝進場後最高收盤 − 7×ATR14，只往上移；BTC 跌破 50 日線時收緊成 2.5×ATR。碰到就出場，<b>不設獲利目標</b>。</li>
          <li><b>資金</b>（回測設定）：每筆最多虧總資金 1%（部位＝1% ÷ 停損距離）、單檔 ≤25%、最多同時 10 檔、總曝險 ≤2 倍；訊號多於空位時，成交額倍數大的優先。</li>
        </ol>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>回測（820 幣含已下市、扣手續費＋資金費率）</th><th class="n">全期</th><th class="n">年化</th><th class="n">最大回撤</th><th class="n">驗證期年化<br><span class="muted small">2025-02 起</span></th></tr></thead><tbody>
          <tr><td>本策略（每筆風險 1%）</td><td class="n num">14.4 倍</td><td class="n num">+49%</td><td class="n num">−45%</td><td class="n num">+23%</td></tr>
          <tr><td>本策略（每筆風險 2%）</td><td class="n num">27.9 倍</td><td class="n num">+64%</td><td class="n num">−71%</td><td class="n num">+39%</td></tr>
          <tr><td>持有 BTC</td><td class="n num">11.6 倍</td><td class="n num">+44%</td><td class="n num">−77%</td><td class="n num">−11%</td></tr>
        </tbody></table></div>
        <p class="muted small">勝率約 24%、平均 +1.5R，靠少數大波段（最大一筆 +162R，前 10 筆佔總獲利 64%）——漏掉幾個訊號結果就會差很多。逐年：2021 +457%、2022 −27%、2023 +90%、2024 +1%（BTC +121%）、2025 −10%、2026 至 9 月 +52%。參數換成相近的組合，驗證期年化在 +7%～+39% 之間，合理預期約 +15～25%。手續費加倍、資金費率 3 倍時驗證期剩 +12%。資料沒有涵蓋所有下市幣，結果偏樂觀。這是回測研究，不是投資建議。</p>
      </details></section>`;
    if (!d) { el.innerHTML = head + rules; bind(); return; }
    const fresh = d.fresh.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>幣</th><th>訊號日</th><th class="n">收盤</th><th class="n">初始停損</th><th class="n">停損距離</th><th class="n">建議部位<br><span class="muted small">風險 1%</span></th><th class="n">成交額倍數</th></tr></thead><tbody>${
      d.fresh.map((f) => `<tr><td><b>${esc(nm(f.sym))}</b></td><td class="num">${esc(f.sigDay)}</td><td class="n num">${px(f.close)}</td><td class="n num">${px(f.stop0)}</td><td class="n num">${f.riskPct.toFixed(1)}%</td><td class="n num">${Math.min(25, 100 / f.riskPct).toFixed(0)}%</td><td class="n num">${f.volX.toFixed(1)}×</td></tr>`).join('')}</tbody></table></div><p class="muted small">明天 UTC 0 點（台灣 8 點）開盤進場；開盤若已低於停損就放棄。建議部位＝總資金的百分比（1% ÷ 停損距離，最多 25%）。</p>`
      : `<div class="muted small">今天沒有新訊號${d.btc.up ? '' : '（BTC 在 50 日線下，規則不開新倉）'}。</div>`;
    const open = d.open.length ? `<div class="cs-grid">${d.open.map((t) => `<article class="pc-card"><header><div><b>${esc(nm(t.sym))}</b> <span class="muted small">${esc(t.entryDay)} 進場・${t.days} 天</span></div><div><b class="num ${rc(t.R)}">${t.R >= 0 ? '+' : ''}${t.R.toFixed(1)}R</b> <span class="muted small">停損鎖住 ${t.lockR >= 0 ? '+' : ''}${t.lockR.toFixed(1)}R</span></div></header>${mini(t)}<div class="muted small">進場 <b class="num">${px(t.entry)}</b>・收盤 <b class="num">${px(t.close)}</b>・目前追蹤停損 <b class="num">${px(t.stop)}</b>（初始 ${px(t.stop0)}）</div></article>`).join('')}</div>`
      : '<div class="muted small">目前沒有依規則仍持有的部位。</div>';
    const closed = d.closed.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>幣</th><th>進場日</th><th class="n">進場</th><th>出場日</th><th class="n">出場</th><th class="n">結果</th></tr></thead><tbody>${
      d.closed.map((t) => `<tr><td><b>${esc(nm(t.sym))}</b></td><td class="num">${esc(t.entryDay)}</td><td class="n num">${px(t.entry)}</td><td class="num">${esc(t.exitDay)}</td><td class="n num">${px(t.exitPx)}</td><td class="n num ${rc(t.R)}">${t.R >= 0 ? '+' : ''}${t.R.toFixed(2)}R</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="muted small">最近 30 天沒有出場紀錄。</div>';
    el.innerHTML = head + `
      <section class="panel"><div class="panel-head"><strong>今天新訊號</strong><span class="muted small">${d.fresh.length} 個${d.fresh.length > 10 ? '・回測最多同時 10 檔，成交額倍數大的優先' : ''}</span></div>${fresh}</section>
      <section class="panel"><div class="panel-head"><strong>持倉中</strong><span class="muted small">依規則推算：假設每個訊號都有進場（回測最多 10 檔，實際可能沒全部進）；R＝（收盤−進場）÷ 初始風險</span></div>${open}</section>
      <section class="panel"><div class="panel-head"><strong>最近 30 天出場</strong></div>${closed}</section>` + rules + `
      <details class="guide"><summary>為什麼沒有「機會多」的版本</summary><dl>
        <dt>試過的做法</dt><dd>放寬條件（10／20 日新高、實體 0.5 倍 ATR）、趨勢回檔續攻、4 小時版本、把日線底部早進場併進同一個投組。</dd>
        <dt>結果</dt><dd>交易次數可以從每年約 60 筆拉到 150～300 筆，挑選期年化甚至更高（+43%～+93%），但驗證期（2025-02 起）全部比原版差：放寬版 −12%、4 小時版 −12%～−30%、合併投組 +3%～+9%、只用底部早進場＋追蹤停損 +13%～+18%（而且它的參數有用到部分驗證期資料）。這個策略的優勢來自少數大行情，多做的交易品質較差，反而稀釋報酬。台股同一套規則全期年化 +38%（0050 +26%），但驗證期 +75% 沒贏 0050 的 +81%，所以沒放。</dd>
      </dl></details>`;
    bind();
  }
  function bind() {
    const b = el.querySelector('#cs-refresh'); if (b) b.onclick = () => load(true);
    const f = el.querySelector('details.fold'); if (f) f.addEventListener('toggle', () => { st.rulesOpen = f.open; });
  }
  return { load, render, get loaded() { return !!st.data; } };
}
