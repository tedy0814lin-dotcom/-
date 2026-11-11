// 台股選股頁：「大單推升」策略（每筆平均成交股數暴增 ＋ 當日大漲 ＋ 站上 20 日線）
// 邏輯：成交筆數少、每筆股數卻突然變大 → 少數大戶在買，不是散戶搶進；配合收盤大漲、站上月線，隔天開盤買進。
// 回測（上櫃 893 檔、2021–2026，扣手續費＋證交稅 0.585%；2026-11-12 起用修復後的乾淨資料）：每日最多 3 檔、隔天開盤跳空 <5% 才買、停損 12%、最長抱 40 天，
// 1,178 筆，每筆平均 +2.25%，比同出場的隨機基準多賺 +1.47%（90% 區間 −0.10～+3.14，已含 0），贏同期 0050 +0.57%／筆，勝率 32%（賺大賠小型）。
// 上市（證交所，2024-11～2026-11，481 日）已回測：沒有優勢，略差於隨機，只列出供參考，不納入策略結論。

const CACHE_PREFIX = 'wr_pick_v1_';
const REL_MIN = 1.5;      // 今日每筆均股數 ≥ 前 20 日均值 × 1.5
const CHG_MIN = 0.04;     // 今日收盤漲 > 4%
const LIQ_MIN = 500;      // 近 5 日均量 ≥ 500 張
const TOP_N = 3;          // 每日最多取筆均倍數最高的 3 檔
const STOP = 0.12, HOLD = 40;

const nf = new Intl.NumberFormat('zh-TW');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const taipeiToday = () => new Date(Date.now() + 8 * 3600e3);
const fmtD = (s) => `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6)}`;

// 以「週一～週日」為固定區段，過去整週存在瀏覽器，之後只抓當週
function weeks() {
  const now = taipeiToday();
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
  const out = [];
  for (let k = 6; k >= 0; k--) {
    const a = new Date(mon.getTime() - k * 7 * 864e5), b = new Date(a.getTime() + 6 * 864e5);
    out.push([ymd(a), ymd(b)]);
  }
  return out;
}
const cacheGet = (k) => { try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + k)); } catch { return null; } };
function cacheSet(k, v) {
  try { localStorage.setItem(CACHE_PREFIX + k, JSON.stringify(v)); } catch {
    try { Object.keys(localStorage).filter((x) => x.startsWith(CACHE_PREFIX)).forEach((x) => localStorage.removeItem(x)); localStorage.setItem(CACHE_PREFIX + k, JSON.stringify(v)); } catch {}
  }
}

export function createPickTab({ api, el }) {
  const st = { loading: false, progress: '', error: '', days: [], rows: {}, names: {}, miss: [], loaded: false, showTwse: false };

  async function load(force = false) {
    if (st.loading) return;
    st.loading = true; st.error = '';
    render();
    try {
      const ws = weeks(), today = ymd(taipeiToday());
      const days = [], rows = {}, names = {}, miss = [];
      for (let i = 0; i < ws.length; i++) {
        const [from, to] = ws[i];
        const past = to < today;
        let c = past && !force ? cacheGet(`${from}`) : null;
        if (!c) {
          st.progress = `正在抓近 7 週成交資料 ${i + 1}/${ws.length}…第一次約 1 分鐘，之後只更新當週`;
          render();
          c = await api(`/api/avgtrade?from=${from}&to=${to}`);
          if (past && c.days.length && !(c.miss || []).length) cacheSet(from, c);
        }
        days.push(...c.days);
        Object.assign(rows, c.rows);
        Object.assign(names, c.names);
        miss.push(...(c.miss || []));
      }
      Object.assign(st, { days, rows, names, miss, loaded: true, progress: '' });
    } catch (e) {
      st.error = `更新失敗：${e.message}`; st.progress = '';
    } finally {
      st.loading = false; render();
    }
  }

  // 算出最新一個交易日符合條件的股票
  function compute() {
    const D = st.days, n = D.length;
    if (n < 21) return { rows: [], n };
    const last = D[n - 1];
    const out = [];
    for (const code of Object.keys(st.rows[last] || {})) {
      const seq = [];
      for (let k = n - 21; k < n; k++) seq.push(st.rows[D[k]][code] || null);
      if (seq.some((x) => !x)) continue;                         // 這 21 天每天都要有交易
      const close = seq.map((x) => x[0]), avg = seq.map((x) => x[1] / x[2]);
      const c0 = close[20], c1 = close[19];
      const chg = c0 / c1 - 1;
      const base = avg.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
      const rel = avg[20] / base;
      const ma20 = close.slice(1).reduce((a, b) => a + b, 0) / 20;
      const vol5 = seq.slice(16).reduce((a, x) => a + x[1], 0) / 5 / 1000; // 近 5 日均量（張）
      const vol20 = seq.slice(0, 20).reduce((a, x) => a + x[1], 0) / 20 / 1000;
      const [name, mkt] = st.names[code] || ['', ''];
      const r = { code, name, mkt, close: c0, chg, rel, avgNow: avg[20], avgBase: base, ma20, aboveMa: c0 / ma20 - 1, vol5, volRatio: seq[20][1] / 1000 / vol20, trades: seq[20][2] };
      r.pass = rel >= REL_MIN && chg > CHG_MIN && c0 > ma20 && vol5 >= LIQ_MIN;
      out.push(r);
    }
    return { rows: out, n, last };
  }

  const pct = (v, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  function table(rows, withRank) {
    if (!rows.length) return '<div class="muted small">今天沒有符合條件的股票。這是正常的：這個策略只在大單推升時才出手，寧可空手。</div>';
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${withRank ? '<th>名次</th>' : ''}<th>股票</th><th class="n">收盤</th><th class="n">今日漲幅</th><th class="n">筆均倍數</th><th class="n">每筆股數</th><th class="n">成交筆數</th><th class="n">量比</th><th class="n">高於月線</th><th class="n">停損參考</th></tr></thead><tbody>${
      rows.map((r, i) => `<tr>${withRank ? `<td class="num">${i + 1}</td>` : ''}<td><b class="num">${esc(r.code)}</b> ${esc(r.name)} <span class="mk">${esc(r.mkt)}</span></td><td class="n num">${r.close}</td><td class="n num ${cls(r.chg)}">${pct(r.chg)}</td><td class="n num"><b>${r.rel.toFixed(1)}×</b></td><td class="n num">${nf.format(Math.round(r.avgNow))}<span class="muted small">（均 ${nf.format(Math.round(r.avgBase))}）</span></td><td class="n num">${nf.format(r.trades)}</td><td class="n num">${r.volRatio.toFixed(1)}×</td><td class="n num">${pct(r.aboveMa)}</td><td class="n num">買價×${(1 - STOP).toFixed(2)}</td></tr>`).join('')
    }</tbody></table></div>`;
  }

  function render() {
    if (!el.isConnected) return;
    const status = st.error ? `<div class="status err">${esc(st.error)}</div>` : '';
    if (!st.loaded) { el.innerHTML = `<div class="status">${esc(st.progress || (st.loading ? '準備中…' : ''))}</div>${status}`; return; }
    const { rows, n, last } = compute();
    if (!last) { el.innerHTML = `<div class="status err">只抓到 ${n} 個交易日，至少需要 21 天。${esc(st.miss.slice(0, 3).join('；'))}</div>`; return; }
    const otc = rows.filter((r) => r.mkt === '上櫃' && r.pass).sort((a, b) => b.rel - a.rel);
    const sii = rows.filter((r) => r.mkt === '上市' && r.pass).sort((a, b) => b.rel - a.rel);
    const missNote = st.miss.length ? `<div class="status err">部分資料沒抓到（${esc(st.miss.slice(0, 3).join('；'))}），名單可能不完整，稍後按「更新」再試。</div>` : '';
    el.innerHTML = `
      <div class="toolbar"><div class="status" style="width:auto;flex:1">資料到 ${fmtD(last)}（共 ${n} 個交易日）・符合條件：上櫃 ${otc.length} 檔／上市 ${sii.length} 檔${st.loading ? '・' + esc(st.progress || '更新中…') : ''}</div><button class="refresh" id="pick-refresh" type="button" ${st.loading ? 'disabled' : ''}>${st.loading ? '更新中…' : '更新最新資料'}</button></div>
      ${status}${missNote}
      <section class="panel">
        <div class="panel-head"><strong>大單推升：上櫃（已回測）</strong><span class="muted small">收盤後選股，隔天開盤買；筆均倍數最高的前 ${TOP_N} 名是回測版本，其餘是備選（不限檔數版也有效，但較薄）</span></div>
        <h4>優先 ${TOP_N} 檔</h4>
        ${table(otc.slice(0, TOP_N), true)}
        ${otc.length > TOP_N ? `<h4>備選 ${otc.length - TOP_N} 檔</h4>${table(otc.slice(TOP_N), false)}` : ''}
        <div class="muted small" style="margin-top:8px">進場：隔天開盤價比今天收盤高超過 5% 就不買（跳空太大，回測也是這樣篩）；漲停鎖死買不到也跳過，不追價。出場：買進後收盤價跌到買價 −12% → 隔天開盤賣；否則最長抱 ${HOLD} 個交易日，第 ${HOLD} 天收盤賣。</div>
      </section>
      <section class="panel">
        <div class="panel-head"><strong>上市（回測沒有優勢，僅供參考）</strong><button class="ghost" id="pick-twse" type="button">${st.showTwse ? '收起' : `展開 ${sii.length} 檔`}</button></div>
        ${st.showTwse ? `<div class="status" style="border:1px solid var(--down)">上市 481 個交易日（2024-11～2026-11）回測：同樣條件比同出場的隨機基準<b>少 1～3%</b>（前後半都是負的），所以這個條件在上市<b>沒有優勢</b>，不要當成策略訊號。</div>${table(sii, false)}` : ''}
      </section>
      <details class="guide" open>
        <summary>這個策略的邏輯與回測</summary>
        <dl>
          <dt>選股邏輯</dt><dd>散戶單筆小，大戶單筆大。當天成交筆數沒變多、但<b>每筆平均股數</b>突然是平常的 1.5 倍以上，代表少數人在大量買進（老師說的「買家少、大戶在買」）。再要求當天收盤漲超過 4%、站上 20 日線、近 5 日均量 ≥500 張（流動性），就是「大單把價格推上去」的股票。</dd>
          <dt>回測（上櫃 893 檔、2021–2026）</dt><dd>扣手續費＋證交稅 0.585%、隔天開盤買（開盤跳空 ≥5% 不買）、每日最多 3 檔、跌 12% 停損、最長 40 天。<b>2026-11-12 起改用修復後的資料</b>（原本有 15 個上櫃日行情檔損壞，造成假的 +411% 交易）：1,178 筆，每筆平均 +2.25%，比同出場的隨機基準多賺 +1.47%（90% 區間 −0.10～+3.14%，已含 0，不能說穩定贏過隨機），贏同期持有 0050 約 +0.57%／筆（訓練期 −0.23%、驗證期 +2.68%），勝率 32%，中位數 −11%。</dd>
          <dt>要有心理準備</dt><dd>勝率只有三成多，超過一半的單子會被停損，利潤靠少數大波段：把最賺的 10% 拿掉後，平均變 −5.9%，比隨機基準還差。年度不是每年都賺：2021 +0.5%、2022 −4.6%、2023 +5.8%、2024 +0.6%、2025 +3.8%、2026 +8.4%，獲利集中在 2023 與 2025–2026。另外約 8 成訊號是收漲停的股票，漲停鎖死買不到的單子回測沒辦法排除，實際成交會比回測少。</dd>
          <dt>對照檢驗（修復前資料，未重測）</dt><dd>只看「大漲＋爆量」、不看筆均：20 日只多賺 +0.19%（幾乎沒優勢）；加上「筆均放大」才有 +0.97%。所以優勢來自筆均股數，不是單純爆量。加上投信買超反而變差，已拿掉。做空版（跌 4% 且筆均放大）沒有優勢，不做。</dd>
          <dt>買賣方式再檢驗（乾淨資料，2026-11-12）</dt><dd>用同一批訊號比較出場。<b>買進持有 13 天</b>（老師的做法）扣掉同期持有 0050 後是 −0.02%，7 天 −0.23%，都沒贏 0050。目前的「跌 12% 停損、最長 40 天」贏同期 0050 +0.57%／筆，但訓練期是負的（−0.23%）、靠驗證期（+2.68%）撐起來，拿掉 2026 年後變 −0.31%。投組層級（最多同時持 5～10 檔）報酬起伏很大，回撤約 −44%～−53%（0050 為 −36%），勝負取決於少數翻倍的單子。再晚一天（第 3 個交易日開盤）才買，優勢幾乎消失；隔日沖與當沖都是負的。所以把它當<b>選股參考</b>，不要當成能穩定取代 0050 的主力。</dd>
          <dt>限制</dt><dd>筆均股數是「買賣家數差」的近似，不是券商分點本身。價格資料有倖存者偏誤（下市股不在內），實際會比回測略差。上市股票回測沒有優勢（略差於隨機）。逐筆統計沒有模擬資金配置與同時持倉。我們另外測過排除 MACD 頂背離、融資增加、成交值門檻等濾網，在上櫃有時看起來更好，但上市驗證不成立或樣本太小，所以都沒有加進來。</dd>
        </dl>
      </details>`;
    el.querySelector('#pick-refresh').onclick = () => load(true);
    el.querySelector('#pick-twse').onclick = () => { st.showTwse = !st.showTwse; render(); };
  }

  return { load, render, get loaded() { return st.loaded; }, get loading() { return st.loading; } };
}
