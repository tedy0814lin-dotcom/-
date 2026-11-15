// 診斷頁（階段 1：台股持股診斷）。輸入代號、股數、成本價（成本可留空）→ 顯示弱勢／強勢旗標、趨勢分數百分位、
// 三因子分數（來自策略頁名單，前 300 大才有）、同條件股票的歷史機率，以及三種做法（換強勢股／買 0050／續抱）的歷史統計。
// 只描述歷史統計，不給買賣指令；成本價只用來算損益與回本幅度。持股只存在你的瀏覽器，可匯出備份。規格：專案文件《持股診斷頁規格》。
import { FLAG_TEXT, rowObj, diagnose, summarize, statRow, baseRow, recoverRows, upsertHolding, exportHoldings, parseHoldings, ACTION_STATS } from '/lib/diagHold.js';
import { DIAG_STATS } from '/lib/diagStats.js';
import { compareHoldings, FACTORS, GAP_WEAK } from '/lib/diagCompare.js';
import { upsertCoin, exportCoins, parseCoins, findRow, diagnoseCoin, summarizeCoins } from '/lib/diagCrypto.js';
import { normBase } from '/lib/exchanges.js';

const LSK = 'wr_diag_v1', LSKC = 'wr_diag_crypto_v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = (v) => v != null && Number.isFinite(v);
const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString('en-US') : '—');
const px = (v) => (!ok(v) ? '—' : v >= 100 ? v.toFixed(1) : v.toFixed(2));
const pc = (v, d = 1) => (!ok(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const pn = (v, d = 1) => (!ok(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%'); // 已是百分數
const cls = (v) => (!ok(v) ? '' : v >= 0 ? 'up' : 'down');
const WEAK_ORDER = ['A', 'B', 'C', 'D'];
const DIAG_ACTION_NOTE = '這是策略規則（平衡含濾網，每月定期定額、名次掉出才賣、不設停損）套用在你的持股上的結果，不是個人化的買賣建議，也沒有考慮你的稅務、風險承受度與其他資產。證據：2005-10 起回測（含 2008）年化 25.1%、0050 14.8%，對 0050 的 alpha 約 +17.6%（t 3.7，但有挑選偏差，營收濾網是看過結果才追加，t 值最膨脹）；2008 年沒有比較抗跌（最大回撤 −56%，0050 −54%）；台積電領漲的年份（2019、2020、2024、2025）策略落後 0050，持有台積電的人用這套規則會賣出它，要把這點算進去；2026 前 10 個月 +79.1% 對 0050 +63.2%，仍在前瞻驗證中，不保證贏 0050。成本價不影響規則。';

export function createDiagTab({ api, el }) {
  const S = { openCard: {}, cash: 0, sub: 'tw', cx: { loading: false, error: '', data: null, xchg: null, msg: '', msgBad: false, holdings: [] }, loading: false, error: '', data: null, s6: null, holdings: [], msg: '', msgBad: false, storeOk: true, openStats: false, openAct: false };
  try { const raw = localStorage.getItem(LSK); if (raw) { const r = parseHoldings(raw); if (r.list) { S.holdings = r.list; S.cash = r.cash || 0; } } } catch { /* 無痕模式或被封鎖：頁面照常運作，只是不保存 */ }
  try { const raw = localStorage.getItem(LSKC); if (raw) { const r = parseCoins(raw); if (r.list) S.cx.holdings = r.list; } } catch { /* 同上 */ }
  const saveC = () => { try { localStorage.setItem(LSKC, JSON.stringify({ v: 1, kind: 'wr_diag_crypto', holdings: S.cx.holdings })); S.storeOk = true; } catch { S.storeOk = false; } };
  const save = () => { try { localStorage.setItem(LSK, JSON.stringify({ v: 1, kind: 'wr_diag', holdings: S.holdings, cash: S.cash })); S.storeOk = true; } catch { S.storeOk = false; } };
  el.addEventListener('toggle', (e) => { const t = e.target; if (t.matches?.('details[data-k]')) S[t.dataset.k] = t.open; else if (t.matches?.('details[data-card]')) S.openCard[t.dataset.card] = t.open; }, true);

  async function load() {
    if (S.loading) return;
    S.loading = true; S.error = ''; render();
    try {
      S.data = await api('/api/diag');
      try { S.s6 = await api('/api/s6u'); } catch { S.s6 = null; } // 三因子名單讀不到不影響旗標診斷
    } catch (e) { S.error = e.message || String(e); }
    finally { S.loading = false; render(); }
  }
  const rowOf = (code) => (S.data?.rows?.[code] ? rowObj(S.data.rows[code], S.data.cols) : null);
  const s6Of = (code) => S.s6?.list?.find((x) => x.code === code) || null;
  const results = () => S.holdings.map((h) => diagnose(h, rowOf(h.code), s6Of(h.code)));

  function say(msg, bad) { S.msg = msg; S.msgBad = !!bad; }

  // ---------- 畫面 ----------
  const flagChips = (r) => {
    const out = WEAK_ORDER.filter((k) => r.flags[k]).map((k) => `<span class="dg-flag weak" title="${esc(FLAG_TEXT[k].rule)}">${FLAG_TEXT[k].name}</span>`);
    if (r.flags.S) out.push(`<span class="dg-flag strong" title="${esc(FLAG_TEXT.S.rule)}">${FLAG_TEXT.S.name}</span>`);
    return out.length ? out.join('') : '<span class="dg-flag none" title="沒有觸發任何弱勢旗標，也不在趨勢分數前 20%">中性</span>';
  };
  function histRows(r) {
    const base = baseRow(3), out = [];
    const keys = WEAK_ORDER.filter((k) => r.flags[k]); if (r.flags.S) keys.push('S');
    for (const k of keys) {
      const s = statRow(k, 3); if (!s) continue;
      out.push(`<div class="dg-hist"><div><b>${FLAG_TEXT[k].name}</b><span class="muted small"> 過去同條件的股票，之後 3 個月</span></div><dl>
        <dt>相對全體平均</dt><dd><b class="num ${cls(s.ex)}">${pn(s.ex, 2)}</b><span class="muted small">（90% 區間 ${s.lo.toFixed(1)}～${s.hi.toFixed(1)}）</span></dd>
        <dt>續弱／震盪／轉強</dt><dd><b class="num">${s.pWeak}%／${s.pMid}%／${s.pStrong}%</b><span class="muted small">（全體 ${base.pWeak}%／${base.pMid}%／${base.pStrong}%）</span></dd>
        <dt>上漲機率</dt><dd><b class="num">${s.pUp}%</b><span class="muted small">（全體 ${base.pUp}%）</span></dd>
        <dt>2026 年驗證</dt><dd>${s.val ? `<b class="num ${cls(s.val.ex)}">${pn(s.val.ex, 1)}</b><span class="muted small">（${s.val.months} 個訊號月，只當觀察）</span>` : '—'}</dd></dl></div>`);
    }
    return out.join('');
  }
  function recoverBlock(r) {
    if (r.cost == null || !(r.needGain > 0)) return '';
    const rec = recoverRows(r.flags, r.needGain);
    if (!rec) return `<div class="dg-note muted">距離成本只差 ${pc(r.needGain)}，幅度很小，不另列回本機率統計。</div>`;
    const { b } = rec, f = (c) => (c ? `<b class="num">${c.p.toFixed(0)}%</b><span class="muted small"> (${c.lo.toFixed(0)}～${c.hi.toFixed(0)})</span>` : '—');
    const lines = rec.rows.map((x) => `<tr><td>${x.g === '全體' ? '<span class="muted">全體基準</span>' : esc(x.g)}</td><td class="n">${f(x.m6)}</td><td class="n">${f(x.m12)}</td><td class="n">${x.v6 ? x.v6.p.toFixed(0) + '%' : '—'}</td><td class="n">${x.m12 ? x.m12.dn20.toFixed(0) + '%' : '—'}</td></tr>`).join('');
    const where = b.beyond ? `你需要漲 ${pc(r.needGain)}，已超過統計的最高檔，以下用「再漲 ${b.x}%」代表，實際機率更低` : b.exact ? `你要回到成本需要再漲 ${pc(r.needGain)}` : `你要回到成本需要再漲 ${pc(r.needGain)}，以下用最接近的「再漲 ${b.x}%」檔位`;
    return `<div class="dg-hist"><div><b>回本機率</b><span class="muted small"> ${where}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>同條件股票</th><th class="n">6 個月內回到</th><th class="n">12 個月內回到</th><th class="n">2026 驗證 6 個月</th><th class="n">12 個月內再跌 ≥20%</th></tr></thead><tbody>${lines}</tbody></table></div>
      <div class="muted small">歷史上，月底收盤價在期間內「曾經」回到現價再漲 ${b.x}% 的比例（括號為 90% 區間；2026 只有 ${rec.valMonths['6']} 個訊號月，只當觀察）。只看月底收盤，盤中高點沒算，會略低估。這個機率不會因為你的成本價而改變，成本價只用來換算要漲多少；回本也不代表繼續持有比較好。</div></div>`;
  }
  function s6Block(r) {
    if (!r.s6) return `<div class="dg-note muted">三因子分數：這檔不在策略頁的名單內（名單只涵蓋成交值前 300 大的上市股），所以只顯示趨勢旗標。</div>`;
    const t = r.s6;
    return `<div class="dg-s6"><span class="muted">三因子分數（名單內百分位，越高越好）</span><span>價值 <b class="num">${n0(t.value * 100)}</b></span><span>低波動 <b class="num">${n0(t.lowvol * 100)}</b></span><span>趨勢 <b class="num">${n0(t.trend * 100)}</b></span>${t.rank ? `<span class="muted">保守版排名第 ${t.rank}</span>` : ''}</div>`;
  }
  function card(r, w) {
    const title = `<div class="dg-head"><b>${esc(r.code)} ${esc(r.name)}</b><button type="button" class="dg-x" data-del="${esc(r.code)}" aria-label="刪除 ${esc(r.code)}">移除</button></div>`;
    if (r.status === 'etf') return `<section class="panel dg-card">${title}<div class="dg-note muted">${esc(r.code)} 是 ETF。旗標與歷史機率只用個股回測，不適用於 ETF，所以不顯示診斷。</div></section>`;
    if (r.status === 'notfound') return `<section class="panel dg-card">${title}<div class="dg-note bad">資料裡找不到 ${esc(r.code)}（可能是興櫃、ETF、剛上市，或代號打錯）。目前只支援上市櫃的一般個股。</div></section>`;
    const money = `<div class="dg-grid"><div><span class="muted">現價</span><b class="num">${px(r.px)}</b></div>${r.shares ? `<div><span class="muted">股數</span><b class="num">${n0(r.shares)}</b></div><div><span class="muted">市值</span><b class="num">${n0(r.value)}</b>${w != null ? `<span class="muted small"> 占 ${(w * 100).toFixed(0)}%</span>` : ''}</div>` : ''}${r.cost != null ? `<div><span class="muted">成本</span><b class="num">${px(r.cost)}</b></div><div><span class="muted">損益</span><b class="num ${cls(r.pnl)}">${pc(r.pnl)}</b></div>${r.needGain > 0 ? `<div><span class="muted">回到成本需漲</span><b class="num">${pc(r.needGain)}</b></div>` : ''}` : ''}</div>`;
    const liq = r.liqLow ? `<div class="dg-note warn">近 20 日平均成交量只有 ${n0(r.v20)} 張，流動性偏低，實際成交價可能與現價有落差，歷史統計也不一定適用。</div>` : '';
    if (r.status === 'outside') return `<section class="panel dg-card">${title}${money}<div class="dg-note muted">這檔股價低於 10 元或上市時間不足，不在歷史統計的母體內，不顯示旗標與機率。</div>${liq}</section>`;
    const v = r.vals;
    const detail = `<div class="dg-grid small"><div><span class="muted">200 日均線</span><b class="num">${px(v.ma200)}</b><span class="${cls(v.px / v.ma200 - 1)} small"> ${pc(v.px / v.ma200 - 1)}</span></div><div><span class="muted">250 日高點</span><b class="num">${px(v.hi250)}</b><span class="down small"> ${pc(v.near - 1)}</span></div><div><span class="muted">6-1 動能</span><b class="num ${cls(v.mom)}">${pc(v.mom)}</b></div><div><span class="muted">趨勢分數</span><b class="num">前 ${Math.max(1, Math.round((1 - r.tPct) * 100))}%</b></div></div>`;
    const mixed = WEAK_ORDER.some((k) => r.flags[k]) && r.flags.S ? '<div class="dg-note muted">同時出現弱勢旗標與強勢，代表各指標互相矛盾（例如價格離高點很遠、但半年動能很強），兩組歷史統計都不能直接套用，請看個別指標。</div>' : '';
    const sub = `<span class="dg-sumsub">${flagChips(r)}<span class="num">${px(r.px)}</span>${r.cost != null ? `<span class="num ${cls(r.pnl)}">${pc(r.pnl)}</span>` : ''}${r.liqLow ? '<span class="dg-flag none">流動性低</span>' : ''}</span>`;
    return `<section class="panel dg-card"><details data-card="${esc(r.code)}" ${S.openCard[r.code] ? 'open' : ''}><summary class="dg-sum"><span class="dg-sumtop"><b>${esc(r.code)} ${esc(r.name)}</b><button type="button" class="dg-x" data-del="${esc(r.code)}" aria-label="刪除 ${esc(r.code)}">移除</button></span>${sub}</summary><div class="dg-body">${money}${detail}${s6Block(r)}${mixed}${histRows(r)}${recoverBlock(r)}${liq}</div></details></section>`;
  }

  // ---------- 與三因子（平衡含濾網）名單比較 ----------
  const STATUS = { core: ['規則目標名單內', 'ok'], buffer: ['名次在緩衝區，規則不賣也不加碼', 'mid'], sell: ['依規則會賣出', 'bad'], outside: ['不在規則母體內', 'muted'] };
  const fpc = (v) => (ok(v) ? Math.round(v * 100) : '—');
  const gapTxt = (g) => { if (!ok(g)) return '—'; const v = Math.round(g * 100); return v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v); };
  function compareBlock(rs) {
    const holds = rs.filter((r) => (r.status === 'ok' || r.status === 'outside') && r.shares > 0 && r.px > 0).map((r) => ({ code: r.code, shares: r.shares, px: r.px }));
    const cashIn = `<form class="dg-cash" id="dg-cash"><label>可再投入的現金（選填）<input name="cash" inputmode="numeric" value="${S.cash > 0 ? S.cash : ''}" placeholder="0" autocomplete="off"></label><button type="submit" class="refresh">更新</button></form>`;
    const head = `<div class="panel-head"><h4 style="margin:0">與三因子（平衡含濾網）名單比較</h4><span class="muted small">策略規則的對照，不是買賣建議</span></div>`;
    if (!holds.length) return `<section class="panel">${head}<div class="dg-note muted">輸入持股並填股數後，會和策略頁的平衡版（含營收濾網）名單比較：每檔落在規則的哪個位置、組合缺哪個因子、規則會怎麼調整。</div>${cashIn}</section>`;
    if (!S.s6) return `<section class="panel">${head}<div class="dg-note bad">三因子名單讀不到（策略頁的名單快照），暫時無法比較。</div></section>`;
    const c = compareHoldings({ data: S.s6, holds, cash: S.cash });
    if (c.error) return `<section class="panel">${head}<div class="dg-note bad">${esc(c.error)}</div></section>`;
    const nm = (code) => rs.find((x) => x.code === code)?.name || c.rows.find((x) => x.code === code)?.name || '';
    const prof = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>因子</th><th class="n">你的</th><th class="n">前 ${c.N} 名</th><th class="n">差距</th><th>判讀</th></tr></thead><tbody>${c.profile.map((x) => `<tr><td>${x.label}</td><td class="n">${fpc(x.port)}</td><td class="n">${fpc(x.target)}</td><td class="n ${x.verdict === 'weak' ? 'down' : x.verdict === 'strong' ? 'up' : ''}">${gapTxt(x.gap)}</td><td>${x.verdict === 'weak' ? '偏弱' : x.verdict === 'strong' ? '較強' : x.verdict === 'same' ? '相近' : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    const covNote = c.coverage == null ? '' : c.coverage < 0.5 ? `<div class="dg-note warn">只有 ${(c.coverage * 100).toFixed(0)}% 的市值在三因子名單內（其餘是名單以外的股票），組合因子輪廓代表性不足。</div>` : c.coverage < 0.999 ? `<div class="dg-note muted">因子輪廓只含名單內的持股，占組合市值 ${(c.coverage * 100).toFixed(0)}%。</div>` : '';
    const weakTxt = c.weakest && c.weakest.verdict === 'weak' ? `<div class="dg-note">相對規則名單，你的組合最缺的是「<b>${c.weakest.label}</b>」（比規則名單低 ${Math.abs(Math.round(c.weakest.gap * 100))} 個百分位）。` : '<div class="dg-note">三個因子相對規則名單沒有明顯偏弱的（偏弱的門檻是低 ' + GAP_WEAK * 100 + ' 個百分位，是慣例值，沒有回測支持）。';
    const tbl = `<div class="tbl-wrap"><table class="tbl dg-pos"><thead><tr><th>持股</th><th class="n">名次</th><th>與規則的關係</th></tr></thead><tbody>${c.rows.map((r) => {
      const [lab, k] = STATUS[r.status];
      const rk = r.status === 'outside' ? '—' : r.rank != null ? r.rank : '60 外';
      const note = r.status === 'sell' ? (r.rank == null ? '（名次 60 外或掉出名單）' : `（名次 ${r.rank} > ${c.lim}）`) : '';
      const fac = r.status === 'outside' ? '' : `<div class="muted small">價值 ${fpc(r.value)}・低波動 ${fpc(r.lowvol)}・趨勢 ${fpc(r.trend)}</div>`;
      return `<tr><td>${esc(r.code)}<div class="small">${esc(r.name || nm(r.code))}</div></td><td class="n">${rk}</td><td class="dg-st ${k}">${lab}${note}${r.filteredNow && r.status !== 'sell' ? '<div class="muted small">最新資料已被營收濾網排除</div>' : ''}${fac}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    const sells = c.plan.sells.length ? c.plan.sells.map((x) => `<li>賣出 ${esc(x.code)} ${esc(x.name || nm(x.code))} ${n0(x.shares)} 股（約 ${n0(x.proceeds)} 元，已扣手續費與證交稅）：${esc(x.reason)}</li>`).join('') : '<li class="muted">沒有持股需要賣出。</li>';
    const buys = c.plan.buys.length ? c.plan.buys.map((x) => `<li>買進 ${esc(x.code)} ${esc(x.name)}（名次 ${x.rank}）${n0(x.shares)} 股，約 ${n0(x.amount)} 元${x.isNew ? '' : '（補到目標金額）'}</li>`).join('') : `<li class="muted">${c.V < 1 ? '' : '沒有可買進的項目（現金不足或每檔缺口低於最低單筆 3,000 元）。'}</li>`;
    const cand = c.cands.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>你沒持有的前 ${c.N} 名</th><th class="n">名次</th><th class="n">價值</th><th class="n">低波</th><th class="n">趨勢</th></tr></thead><tbody>${c.cands.map((x) => `<tr><td>${esc(x.code)}<div class="small">${esc(x.name)}${x.ind ? '・' + esc(x.ind) : ''}</div></td><td class="n">${x.rank}</td><td class="n ${c.weakest?.k === 'value' ? 'up' : ''}">${fpc(x.value)}</td><td class="n ${c.weakest?.k === 'lowvol' ? 'up' : ''}">${fpc(x.lowvol)}</td><td class="n ${c.weakest?.k === 'trend' ? 'up' : ''}">${fpc(x.trend)}</td></tr>`).join('')}</tbody></table></div>` : '';
    const stl = DIAG_ACTION_NOTE;
    const nSell = c.plan.sells.length, nBuy = c.plan.buys.length;
    const brief = [c.weakest && c.weakest.verdict === 'weak' ? `最缺${c.weakest.label}` : '因子無明顯偏弱', `規則會賣出 ${nSell} 檔${nBuy ? `、買進 ${nBuy} 檔` : ''}`].join('；');
    return `<section class="panel"><details class="fold" data-k="openCmp" ${S.openCmp ? 'open' : ''}><summary><b>與三因子（平衡含濾網）名單比較</b><span class="muted small">${esc(brief)}（點開展開）</span></summary>
      <div class="muted small">策略規則套用在你的持股上的對照，不是買賣建議。</div>
      <div class="muted small">名單：${c.info.kind === 'final' ? '月底正式名單 ' + esc(c.info.month) : '最新預覽名單'}（規則只在月底換股），三因子分數為 ${esc(c.asof)} 最新資料；依總資金約 ${n0(c.V)} 元，規則的目標檔數 ${c.N} 檔、名次超過 ${c.lim} 才賣。</div>
      <h4>因子輪廓：你的組合缺什麼</h4><div class="muted small">數字是百分位（0～100，越高越好）；「你的」是組合市值加權，「前 ${c.N} 名」是規則目標名單的平均。</div>${prof}${covNote}${weakTxt}${c.weakest && c.weakest.verdict === 'weak' ? '最下面「規則名單裡你還沒持有的」表中，標綠的是你最缺的那個因子的分數。' : ''}</div>
      <h4>每檔持股在規則裡的位置</h4>${tbl}
      <h4>規則會怎麼調整（把整個組合照規則做的對照）</h4>${cashIn}<ul class="s6-ul">${sells}${buys}</ul>
      ${cand ? '<h4>規則名單裡你還沒持有的</h4>' + cand : ''}
      <div class="muted small">${stl}</div></details></section>`;
  }
  function summaryBlock(rs, sm) {
    const valid = rs.filter((r) => r.status === 'ok');
    if (rs.length < 2 && !sm.warns.length) return '';
    const lines = [];
    if (sm.weakShare != null && sm.total > 0) lines.push(`組合市值中，觸發弱 A 的占 <b class="num">${(sm.weakShare * 100).toFixed(0)}%</b>、強勢的占 <b class="num">${(sm.strongShare * 100).toFixed(0)}%</b>。`);
    if (valid.length) lines.push(`${valid.length} 檔有旗標資料，其中弱 A ${valid.filter((r) => r.flags.A).length} 檔、強勢 ${valid.filter((r) => r.flags.S).length} 檔。`);
    return `<section class="panel"><h4>組合摘要</h4>${lines.map((x) => `<div>${x}</div>`).join('')}${sm.warns.map((x) => `<div class="dg-note warn">${esc(x)}</div>`).join('')}</section>`;
  }
  function actionBlock() {
    const a = ACTION_STATS, b = a.weakVs0050.bt, v = a.weakVs0050.val, s = a.s6u;
    return `<details class="fold" data-k="openAct" ${S.openAct ? 'open' : ''}><summary><b>三種做法的歷史統計</b><span class="muted small">換強勢股、買 0050、續抱（點開展開）</span></summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>做法（弱 A 股票出現後 3 個月）</th><th class="n">回測 ${b.months} 個月</th><th class="n">2026 驗證 ${v.months} 個月</th></tr></thead><tbody>
      <tr><td>續抱弱 A 股票，相對 0050</td><td class="n ${cls(b.diff)}">${pn(b.diff, 2)}（區間 ${b.lo.toFixed(1)}～${b.hi.toFixed(1)}）</td><td class="n ${cls(v.diff)}">${pn(v.diff, 1)}</td></tr>
      <tr><td>其中輸給 0050 的月份比例</td><td class="n">${b.losePct}%</td><td class="n">${v.losePct}%</td></tr>
      <tr><td>改持有 0050，比續抱多賺（已扣換股成本）</td><td class="n ${cls(b.swap0050)}">${pn(b.swap0050, 2)}</td><td class="n ${cls(v.swap0050)}">${pn(v.swap0050, 1)}</td></tr>
      <tr><td>改持有趨勢分數前 20 名，比續抱多賺（已扣成本）</td><td class="n ${cls(b.swapTop20)}">${pn(b.swapTop20, 2)}</td><td class="n ${cls(v.swapTop20)}">${pn(v.swapTop20, 1)}</td></tr></tbody></table></div>
      <ul class="s6-ul"><li>${esc(a.strongTop20vs0050)}</li>
      <li>三因子策略（策略頁）：年化 保守 ${s.bt.base.cagr}%／平衡 ${s.bt.bal.cagr}%／平衡含濾網 ${s.bt.balF.cagr}%，0050 ${s.bt.etf.cagr}%；最大回撤 ${s.bt.base.mdd}%／${s.bt.bal.mdd}%／${s.bt.balF.mdd}%，0050 ${s.bt.etf.mdd}%。2026 年前 ${s.y2026.months} 個月：${s.y2026.base}%／${s.y2026.bal}%／${s.y2026.balF}%，0050 ${s.y2026.etf}%。${esc(s.note)}</li>
      <li>${esc(s.alpha)}。</li></ul>
      <div class="muted small">資料來源：${esc(a.source)}。這些都是過去的統計，只能說明「過去同樣情況下平均發生什麼」，不能保證你這一檔會怎樣；你的成本價不會改變這些統計。</div></details>`;
  }
  function statsBlock() {
    const bt = DIAG_STATS.bt, vl = DIAG_STATS.val;
    return `<details class="fold" data-k="openStats" ${S.openStats ? 'open' : ''}><summary><b>旗標怎麼定義、統計怎麼算</b><span class="muted small">（點開展開）</span></summary><ul class="s6-ul">
      ${['A', 'B', 'C', 'D', 'S'].map((k) => `<li><b>${FLAG_TEXT[k].name}</b>：${esc(FLAG_TEXT[k].rule)}。</li>`).join('')}
      <li>趨勢分數＝6-1 動能、距 250 日高點的接近度、相對 200 日線的幅度，三者在全體股票中的百分位平均。全體＝上市櫃股價 ≥ 10 元、有成交的個股。</li>
      <li>統計方式：每個月底找出符合旗標的股票，看之後 3 個月的報酬相對全體平均多或少（已排除 2026 年；2026 年另列作驗證）。回測 ${bt.months?.['3'] ?? ''} 個月、2026 驗證 ${vl.months?.['3'] ?? ''} 個訊號月；同一股票不同月份高度重疊，區間用自助法估計，仍可能偏窄。</li>
      <li>表中「續弱／震盪／轉強」＝之後 3 個月相對全體落在最差 20%、中間、最好 20% 的比例；全體基準就是沒有任何條件時的比例，用來避免把正常機率誤讀成訊號。</li>
      <li>這個旗標是月線等級的訊號，不適合短線進出；空頭市場時是否仍有效尚未確定（2026 年沒有空頭月份）。</li>
      <li>價格採未還原股利的收盤價，ETF 與興櫃不在範圍內。統計來源：${esc(DIAG_STATS.source)}（${esc(DIAG_STATS.built)}）。</li></ul></details>`;
  }

  const switchHtml = () => `<div class="dg-sw" role="tablist"><button type="button" role="tab" data-sub="tw" aria-selected="${S.sub === 'tw'}">台股持股</button><button type="button" role="tab" data-sub="crypto" aria-selected="${S.sub === 'crypto'}">加密貨幣持倉</button></div>`;

  function render() {
    const d = S.data;
    const head0 = `<section class="panel dg-top"><div class="panel-head"><h2 style="margin:0;font-size:18px">持股診斷</h2><span class="muted small">台股個股；只存在這個瀏覽器</span></div>
      <div class="dg-note muted">輸入你的持股，看每一檔目前有沒有觸發弱勢旗標、趨勢分數在哪、過去同條件的股票之後怎麼走。僅為歷史統計，不構成投資建議；你的成本價只用來算損益與回本幅度，不影響任何判斷。</div></section>`;
    const head = head0 + switchHtml();
    if (S.sub === 'crypto') { renderCrypto(head); return; }
    const form = `<form class="panel dg-form" id="dg-form"><div class="dg-fields">
      <label>代號<input name="code" inputmode="numeric" maxlength="4" placeholder="2330" autocomplete="off" required></label>
      <label>股數<input name="shares" inputmode="numeric" placeholder="1000" autocomplete="off"></label>
      <label>成本價（可留空）<input name="cost" inputmode="decimal" placeholder="選填" autocomplete="off"></label>
      <button type="submit" class="refresh">加入／更新</button></div>${S.msg ? `<div class="dg-note ${S.msgBad ? 'bad' : 'muted'}">${esc(S.msg)}</div>` : ''}</form>`;
    if (S.loading && !d) { el.innerHTML = head + form + '<div class="status">讀取全市場資料中…</div>'; bind(); return; }
    if (S.error && !d) { el.innerHTML = head + form + `<div class="dg-note bad">讀不到資料：${esc(S.error)}</div><button class="refresh" id="dg-reload" type="button">重試</button>`; bind(); return; }
    const rs = d ? results() : [], sm = summarize(rs);
    const age = d ? Math.floor((Date.now() + 8 * 3600e3 - Date.parse(d.asof + 'T00:00:00Z')) / 864e5) : 0;
    const asof = d ? `<div class="muted small">資料日期 ${esc(d.asof)}（每個交易日收盤後更新；涵蓋 ${n0(d.nOk)} 檔）${age > 5 ? `<span class="down"> ，已經 ${age} 天沒有更新，旗標可能過期</span>` : ''}</div>` : '';
    const body = rs.length ? rs.map((r) => card(r, sm.weights[r.code])).join('') : '<div class="dg-empty muted">還沒有持股。在上面輸入代號與股數就會顯示診斷。</div>';
    const tools = `<div class="dg-tools"><button type="button" class="refresh" id="dg-exp" ${rs.length ? '' : 'disabled'}>匯出備份</button><label class="refresh dg-imp">匯入<input type="file" id="dg-imp" accept=".json,application/json" hidden></label>${S.storeOk ? '' : '<span class="down small">瀏覽器無法保存資料（可能是無痕模式），請用匯出備份。</span>'}</div>`;
    el.innerHTML = head + form + asof + summaryBlock(rs, sm) + (d ? compareBlock(rs) : '') + body + actionBlock() + statsBlock() + tools;
    bind();
  }

  function bind() {
    el.querySelector('#dg-cash')?.addEventListener('submit', (e) => { e.preventDefault(); const v = Number(String(new FormData(e.target).get('cash') ?? '').replace(/[,\s]/g, '')); S.cash = Number.isFinite(v) && v > 0 ? v : 0; save(); render(); });
    el.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => { S.sub = b.dataset.sub; if (S.sub === 'crypto') loadC(); render(); }));
    el.querySelector('#dg-reload')?.addEventListener('click', load);
    el.querySelector('#dg-form')?.addEventListener('submit', (e) => {
      e.preventDefault(); const f = new FormData(e.target); say('');
      const r = upsertHolding(S.holdings, { code: f.get('code'), shares: f.get('shares'), cost: f.get('cost') });
      if (r.error) say(r.error, true); else { S.holdings = r.list; save(); say(''); }
      render();
    });
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); S.holdings = S.holdings.filter((h) => h.code !== b.dataset.del); save(); render(); }));
    el.querySelector('#dg-exp')?.addEventListener('click', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportHoldings(S.holdings, S.cash)], { type: 'application/json' }));
      a.download = `持股診斷備份-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    el.querySelector('#dg-imp')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const r = parseHoldings(await f.text());
      if (r.error) say(r.error, true); else { S.holdings = r.list; S.cash = r.cash || 0; save(); say(`已匯入 ${r.list.length} 檔` + (r.skipped?.length ? `，略過 ${r.skipped.length} 筆格式不正確的` : '')); }
      render();
    });
  }

  // ---------- 加密貨幣持倉（只記錄，不給建議） ----------
  const usd = (v) => (!ok(v) ? '—' : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : n0(v));
  const cpx = (v) => (!ok(v) ? '—' : v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toPrecision(3));
  async function loadC() {
    const C = S.cx; if (C.loading || C.data) return;
    C.loading = true; C.error = ''; render();
    try {
      C.data = await api('/api/crypto');
      const bases = [...new Set(['BTC', ...C.holdings.map((h) => normBase(h.base))])];
      try { C.xchg = await api('/api/xchg?bases=' + bases.join(',')); } catch { C.xchg = null; } // 其他交易所讀不到也能顯示價格與損益
    } catch (e) { C.error = e.message || String(e); }
    finally { C.loading = false; render(); }
  }
  function coinCard(r, w) {
    const title = `<div class="dg-head"><b>${esc(r.base)}</b><button type="button" class="dg-x" data-cdel="${esc(r.base)}" aria-label="移除 ${esc(r.base)}">移除</button></div>`;
    if (r.status === 'notfound') return `<section class="panel dg-card">${title}<div class="dg-note bad">加密頁的快照裡找不到 ${esc(r.base)}（只涵蓋 BingX USDT 永續合約成交額前 120 名，或代號打錯）。</div></section>`;
    const money = `<div class="dg-grid"><div><span class="muted">現價（USDT）</span><b class="num">${cpx(r.px)}</b>${ok(r.chg24) ? `<span class="${cls(r.chg24)} small"> 24h ${pn(r.chg24, 2)}</span>` : ''}</div>${r.qty ? `<div><span class="muted">數量</span><b class="num">${esc(String(r.qty))}</b></div><div><span class="muted">市值</span><b class="num">${usd(r.value)}</b>${w != null ? `<span class="muted small"> 占 ${(w * 100).toFixed(0)}%</span>` : ''}</div>` : ''}${r.cost != null ? `<div><span class="muted">成本</span><b class="num">${cpx(r.cost)}</b></div><div><span class="muted">損益</span><b class="num ${cls(r.pnl)}">${pc(r.pnl)}</b>${ok(r.pnlUsd) ? `<span class="${cls(r.pnlUsd)} small"> ${r.pnlUsd >= 0 ? '+' : '−'}${usd(Math.abs(r.pnlUsd))}</span>` : ''}</div>${r.needGain > 0 ? `<div><span class="muted">回到成本需漲</span><b class="num">${pc(r.needGain)}</b></div>` : ''}` : ''}</div>`;
    const c = r.chip, f = (x) => (ok(x) ? (x >= 0 ? '+' : '') + x.toFixed(4) + '%' : '—');
    const chip = `<div class="dg-hist"><div><b>籌碼數據</b><span class="muted small"> 現況，不是買賣訊號</span></div><dl>
      <dt>全市場持倉</dt><dd>${ok(c.oi) ? `<b class="num">$${usd(c.oi)}</b>` : '—'}${ok(c.oiChg24) ? `<span class="${cls(c.oiChg24)} small"> 24h ${pn(c.oiChg24, 1)}</span>` : ''}${c.oiEx ? `<span class="muted small">（${c.oiEx} 所合計${c.oiChgSrc ? `；24h 變化只含 ${c.oiChgSrc} 所` : ''}）</span>` : ''}</dd>
      <dt>資金費率</dt><dd><b class="num">${f(c.funding)}</b>${c.fundingMax && c.fundingMin ? `<span class="muted small">（${esc(c.fundingMin.ex)} ${f(c.fundingMin.funding)}～${esc(c.fundingMax.ex)} ${f(c.fundingMax.funding)}）</span>` : ''}</dd>
      <dt>大戶多空比</dt><dd>${c.topLS ? `<b class="num">${c.topLS.now.toFixed(2)}</b><span class="muted small">（OKX，24h ${pn(c.topLS.chg, 2)}）</span>` : '<span class="muted">—（這個幣沒有資料）</span>'}</dd>
      <dt>散戶多空比</dt><dd>${c.accLS ? `<b class="num">${c.accLS.now.toFixed(2)}</b><span class="muted small">（OKX，24h ${pn(c.accLS.chg, 2)}）</span>` : '<span class="muted">—</span>'}</dd></dl>
      ${c.hasXchg ? '' : '<div class="dg-note muted">其他交易所的資料沒有讀到，持倉與資金費率只用 BingX。</div>'}</div>`;
    return `<section class="panel dg-card">${title}${money}${chip}</section>`;
  }
  function renderCrypto(head) {
    const C = S.cx;
    const form = `<form class="panel dg-form" id="dc-form"><div class="dg-fields">
      <label>幣種<input name="base" maxlength="15" placeholder="BTC" autocomplete="off" autocapitalize="characters" required></label>
      <label>數量<input name="qty" inputmode="decimal" placeholder="0.5" autocomplete="off"></label>
      <label>成本價 USDT（可留空）<input name="cost" inputmode="decimal" placeholder="選填" autocomplete="off"></label>
      <button type="submit" class="refresh">加入／更新</button></div>${C.msg ? `<div class="dg-note ${C.msgBad ? 'bad' : 'muted'}">${esc(C.msg)}</div>` : ''}</form>`;
    const note = `<div class="dg-note muted dg-pad">加密貨幣只記錄損益並顯示現有籌碼數據，<b>不提供旗標、換股或買賣建議</b>：台股的汰弱留強與三因子回測不能套用在加密貨幣，加密版目前沒有做過回測。價格來自加密頁快照（BingX USDT 永續合約），非即時；持倉只存在這個瀏覽器。</div>`;
    if (C.loading && !C.data) { el.innerHTML = head + note + form + '<div class="status">讀取加密貨幣資料中…</div>'; bind(); bindC(); return; }
    if (C.error && !C.data) { el.innerHTML = head + note + form + `<div class="dg-note bad">讀不到資料：${esc(C.error)}</div><button class="refresh" id="dc-reload" type="button">重試</button>`; bind(); bindC(); return; }
    const rs = C.holdings.map((h) => diagnoseCoin(h, C.data ? findRow(C.data.rows, h.base) : null, C.xchg)), sm = summarizeCoins(rs);
    const age = C.data?.updatedAt ? Math.round((Date.now() - C.data.updatedAt) / 60000) : null;
    const asof = C.data ? `<div class="muted small">快照更新於 ${age != null ? (age < 90 ? age + ' 分鐘前' : Math.round(age / 60) + ' 小時前') : '—'}（${esc(C.data.source || '')}）${age > 180 ? '<span class="down">，資料偏舊</span>' : ''}</div>` : '';
    const body = rs.length ? rs.map((r) => coinCard(r, sm.weights[r.base])).join('') : '<div class="dg-empty muted">還沒有加密貨幣持倉。在上面輸入幣種與數量就會顯示損益與籌碼數據。</div>';
    const warn = sm.warns.length ? `<section class="panel">${sm.warns.map((x) => `<div class="dg-note warn">${esc(x)}</div>`).join('')}</section>` : '';
    const tools = `<div class="dg-tools"><button type="button" class="refresh" id="dc-exp" ${rs.length ? '' : 'disabled'}>匯出備份</button><label class="refresh dg-imp">匯入<input type="file" id="dc-imp" accept=".json,application/json" hidden></label>${S.storeOk ? '' : '<span class="down small">瀏覽器無法保存資料（可能是無痕模式），請用匯出備份。</span>'}</div>`;
    el.innerHTML = head + note + form + asof + warn + body + tools; bind(); bindC();
  }
  function bindC() {
    const C = S.cx;
    el.querySelector('#dc-reload')?.addEventListener('click', () => { C.error = ''; loadC(); });
    el.querySelector('#dc-form')?.addEventListener('submit', (e) => {
      e.preventDefault(); const f = new FormData(e.target); C.msg = ''; C.msgBad = false;
      const r = upsertCoin(C.holdings, { base: f.get('base'), qty: f.get('qty'), cost: f.get('cost') });
      if (r.error) { C.msg = r.error; C.msgBad = true; } else { C.holdings = r.list; saveC(); if (C.data && !C.xchg?.byBase?.[normBase(r.list[r.list.length - 1].base)]) { C.data = null; C.xchg = null; loadC(); return; } }
      render();
    });
    el.querySelectorAll('[data-cdel]').forEach((b) => b.addEventListener('click', () => { C.holdings = C.holdings.filter((h) => h.base !== b.dataset.cdel); saveC(); render(); }));
    el.querySelector('#dc-exp')?.addEventListener('click', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportCoins(C.holdings)], { type: 'application/json' }));
      a.download = `加密持倉備份-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    el.querySelector('#dc-imp')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return; const r = parseCoins(await f.text());
      if (r.error) { C.msg = r.error; C.msgBad = true; } else { C.holdings = r.list; saveC(); C.msg = `已匯入 ${r.list.length} 檔` + (r.skipped?.length ? `，略過 ${r.skipped.length} 筆格式不正確的` : ''); C.msgBad = false; C.data = null; C.xchg = null; loadC(); return; }
      render();
    });
  }
  return { load, render, state: S };
}
