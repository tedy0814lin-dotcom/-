// BingX 自動交易：Delta 階梯（4H）＋BTC 大盤濾網（BTC 4H 在 EMA200 上只做多、下只做空）
// 每筆打到停損賠「永續帳戶餘額 × RISK_PCT%」（預設 1%）；餘額比最高點少 20% 時風險自動減半（斷路器），同時最多 MAX_POS 筆（預設 10），進場同時掛停損與 4R 止盈（照網站訊號價位）。
//
// 需要（GitHub → Settings → Secrets and variables → Actions）：
//   Secrets：BINGX_KEY、BINGX_SECRET（BingX API，只開「合約交易」，不要開提現，建議綁 IP）
//   預設（alert.yml）：TRADE_ENV=vst＋TRADE_LIVE=1 → 在 BingX 模擬盤真的下單；要實盤就在 Variables 設 TRADE_ENV=live
//   TRADE_LIVE=0 → 只用「測試下單」端點驗證、不成交
//   選填 Variables：RISK_PCT（預設 1）、RISK_USD（設了就改用固定金額）、MAX_POS（預設 10）、TRADE_ENV=vst（模擬盤）
// 投組回測（2018–2026、60 幣、複利、扣費）：1%／10 筆＋斷路器 年化約 113%、最大回撤 −48%（成本加倍 −50%）、9 年全正；使用者選 1%（可接受回撤 −50%）；隨機進場 −4%／年。
// 防爆倉：每檔改逐倉，槓桿 ≤ 1 ÷（3 × 停損%），強平價約在停損 3 倍遠，停損一定先觸發；單筆最多賠它自己的保證金。
// 回測依據：專案文件 Delta階梯多空2018起長期回測.md、Delta階梯延遲進場檢驗.md（晚 2 小時進場影響很小）。
process.env.SNAPSHOT ??= '1';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { get } from './_api.mjs';

const KEY = process.env.BINGX_KEY, SEC = process.env.BINGX_SECRET;
if (!KEY || !SEC) { console.log('還沒設定 BINGX_KEY / BINGX_SECRET，跳過自動交易'); process.exit(0); }
const LIVE = process.env.TRADE_LIVE === '1';
const PCT = +(process.env.RISK_PCT || 1) / 100, MAX_POS = +(process.env.MAX_POS || 10);
const HOST = process.env.TRADE_ENV === 'vst' ? 'https://open-api-vst.bingx.com' : 'https://open-api.bingx.com';
const STATE = '.alert-state/autotrade.json', LINE = process.env.LINE_TOKEN;
const save = () => { fs.mkdirSync('.alert-state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { done: {} }; } })();

// BingX 簽名請求。簽名一律用「依 key 排序、未編碼」的字串（官方範例）。
// POST 有兩種送法：A＝原字串放 body（官方範例）、B＝全部放網址（值含 { [ 才編碼，同 GET）。
// 2026-11-26 實測 A 以外的編碼 body 會回 100001 簽名錯誤；遇 100001 自動換另一種再送一次（簽名錯誤時單子不會成立，重送安全）。
async function bx(method, path, params = {}, mode = 0) {
  const p = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const s = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join('&');
  const sig = crypto.createHmac('sha256', SEC).update(s).digest('hex');
  const q = Object.keys(p).sort().map((k) => { const v = String(p[k]); return `${k}=${/[{[]/.test(v) ? encodeURIComponent(v) : v}`; }).join('&') + `&signature=${sig}`;
  const h = { 'X-BX-APIKEY': KEY, 'X-SOURCE-KEY': 'BX-AI-SKILL' };
  const r = method === 'GET' || mode === 1 ? await fetch(`${HOST}${path}?${q}`, { method, headers: h, signal: AbortSignal.timeout(15000) })
    : await fetch(`${HOST}${path}`, { method, headers: { ...h, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `${s}&signature=${sig}`, signal: AbortSignal.timeout(15000) });
  const t = await r.text(), j = JSON.parse(t.replace(/"orderId":(\d{16,})/g, '"orderId":"$1"'));
  if (j.code === 100001 && method !== 'GET' && mode === 0) { console.log(`${path} 簽名錯誤，改用網址參數重送`); return bx(method, path, params, 1); }
  if (j.code !== 0) throw new Error(`BingX ${j.code} ${j.msg || ''}（${path}）`);
  return j.data;
}
async function line(messages) {
  if (!LINE) return false;
  const r = await fetch('https://api.line.me/v2/bot/message/broadcast', { method: 'POST', headers: { Authorization: 'Bearer ' + LINE, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) }).catch(() => null);
  if (r && !r.ok) console.log('LINE 失敗 ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return !!r?.ok;
}
const push = (text) => line([{ type: 'text', text }]);
// LINE 卡片（Flex）：bubbles 最多 12 張；卡片送失敗就改送純文字
async function card(bubbles, alt) {
  for (let i = 0; i < bubbles.length; i += 12) {
    const b = bubbles.slice(i, i + 12);
    if (!(await line([{ type: 'flex', altText: alt.slice(0, 390), contents: b.length === 1 ? b[0] : { type: 'carousel', contents: b } }]))) await push(alt);
  }
}
const TAG = HOST.includes('vst') ? '模擬盤' : '實盤';
const tpe = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
const row = (k, v, color) => ({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: k, size: 'sm', color: '#8B8D98', flex: 2 }, { type: 'text', text: String(v), size: 'sm', align: 'end', flex: 3, weight: 'bold', color: color || '#EDEEF0' }] });
const bubble = (title, sub, color, rows) => ({
  type: 'bubble', size: 'kilo',
  header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '14px', contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color: '#FFFFFF' }, { type: 'text', text: sub, size: 'xs', color: '#FFFFFFCC' }] },
  body: { type: 'box', layout: 'vertical', spacing: 'sm', backgroundColor: '#18191B', contents: rows },
  footer: { type: 'box', layout: 'vertical', backgroundColor: '#18191B', paddingTop: '0px', contents: [{ type: 'text', text: `🤖 Delta 階梯・${TAG}・${tpe()}`, size: 'xxs', color: '#6F6E77' }] },
});
const coin = (sym) => sym.replace(/-USDT$/, '');
const fix = (v, d) => +(Math.floor(v * 10 ** d + 1e-9) / 10 ** d).toFixed(d);
const toBx = (s) => s.replace(/USDT$/, '-USDT');

// 先確認金鑰能用（第一次連上就 LINE 通知一次）
let usdt;
try {
  const bal = await bx('GET', '/openApi/swap/v3/user/balance');
  const B = (Array.isArray(bal) ? bal : [bal]).filter(Boolean); // 模擬盤的資產叫 VST，不是 USDT
  usdt = +((B.find((x) => x.asset === 'USDT' && +x.balance > 0) || B.find((x) => x.asset === 'VST') || B.find((x) => +x.balance > 0) || {}).balance || 0);
} catch (e) { console.log('BingX 金鑰檢查失敗：' + e.message); if (!state.authErr) await push('⚠️ Delta 自動交易｜BingX 金鑰檢查失敗\n' + e.message); state.authErr = 1; save(); process.exit(0); }
if (!state.authOk || state.authErr) await push(`✅ Delta 自動交易｜已連上 BingX ${TAG}${LIVE ? '' : '（測試模式）'}\n💰 永續 USDT 餘額 ${usdt}`);
state.authOk = 1; state.authErr = 0;
// 平倉回報：之前下的單如果持倉已經不見，查歷史倉位判斷止盈或止損，LINE 通知
const pos = await bx('GET', '/openApi/swap/v2/user/positions');
const active = new Set((pos || []).filter((x) => +x.positionAmt !== 0).map((x) => x.symbol));
state.open ||= {};
const closes = [], closeTxt = [];
for (const [sym, o] of Object.entries(state.open)) {
  if (active.has(sym) || Date.now() - o.t < 60e3) continue;
  let px = null, pnl = null;
  try {
    const h = await bx('GET', '/openApi/swap/v1/trade/positionHistory', { symbol: sym, startTs: o.t - 60e3, endTs: Date.now() });
    const r = (h?.positionHistory || []).sort((a, b) => +(b.updateTime || b.closeTime || 0) - +(a.updateTime || a.closeTime || 0))[0];
    if (r) { px = +(r.avgClosePrice ?? r.closeAvgPrice ?? r.avgPrice) || null; pnl = +(r.netProfit ?? r.realisedProfit) ; if (!Number.isFinite(pnl)) pnl = null; }
  } catch (e) { console.log(`${sym} 查歷史倉位失敗：${e.message}`); }
  if (px == null) px = +(await bx('GET', '/openApi/swap/v2/quote/price', { symbol: sym }).catch(() => ({}))).price || null;
  const long = o.side === 'LONG', R = px == null ? null : (long ? px - o.entry : o.entry - px) / Math.abs(o.entry - o.stop);
  const kind = px == null ? '已平倉' : Math.abs(px - o.tp) < Math.abs(px - o.stop) ? '🎯 止盈' : '🛑 止損';
  const win = kind.includes('止盈'), Rt = R == null ? '' : (R >= 0 ? '+' : '') + R.toFixed(2) + 'R';
  closes.push(bubble(`${kind} ${Rt}`, `${coin(sym)}・${long ? '做多 📈' : '做空 📉'}`, win ? '#30A46C' : kind.includes('止損') ? '#E5484D' : '#5B5BD6', [
    row('進場', o.entry), row('平倉', px ?? '?'), row('結果', Rt || '-', win ? '#3DD68C' : '#FF6369'),
    ...(pnl == null ? [] : [row('盈虧', (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' U', pnl >= 0 ? '#3DD68C' : '#FF6369')]),
  ]));
  closeTxt.push(`${kind} ${long ? '做多' : '做空'} ${coin(sym)} ${Rt}${pnl == null ? '' : '｜' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + 'U'}`);
  console.log(`${sym} ${kind} ${px} R=${R}`);
  delete state.open[sym];
}
if (closes.length) await card(closes, '📊 Delta 自動交易平倉\n' + closeTxt.join('\n'));
const fp = process.env.FP_FILE ? JSON.parse(fs.readFileSync(process.env.FP_FILE, 'utf8')) : await get('/api/twhist?fp=1&force=1'); // FP_FILE：測試用
if (fp.btcUp == null) { console.log('BTC 狀態抓不到，這輪不下單'); process.exit(0); }
// 只做 BTC 同向；訊號 4H 收盤後 4 小時內才進（sigT 是 K 棒開盤時間）
const sigs = [...fp.long, ...fp.short.map((r) => ({ ...r, short: true }))]
  .filter((r) => r.bOk === true && Date.now() < r.sigT + 8 * 3600e3 && !state.done[`${r.sym}|${r.sigT}`])
  .sort((a, b) => Math.abs(b.dn) - Math.abs(a.dn));
console.log(`BTC ${fp.btcUp ? '在' : '在下'} EMA200；同向新訊號 ${sigs.length} 筆；${LIVE ? '實盤' : '測試模式（不成交）'}`);
if (!sigs.length) { save(); process.exit(0); }

const [dual, cts] = await Promise.all([bx('GET', '/openApi/swap/v1/positionSide/dual'), bx('GET', '/openApi/swap/v2/quote/contracts')]);
state.peak = Math.max(state.peak || 0, usdt);
const brk = usdt < state.peak * 0.8; // 比最高點少 20% → 風險減半，回到 80% 以上恢復
const RISK = process.env.RISK_USD ? +process.env.RISK_USD : +(usdt * PCT * (brk ? 0.5 : 1)).toFixed(4);
console.log(`永續 USDT 餘額 ${usdt}（最高 ${state.peak}），每筆風險 ${RISK}U${brk ? '（斷路器：已減半）' : ''}`);
if (!(RISK > 0)) { console.log('餘額是 0，不下單'); process.exit(0); }
const held = active;
const hedge = String(dual?.dualSidePosition) === 'true';
const spec = Object.fromEntries((cts || []).map((c) => [c.symbol, c]));
let slots = MAX_POS - held.size;
const log = [], opens = [];
for (const r of sigs) {
  if (slots <= 0) { log.push(`${r.sym} 略過：已達同時 ${MAX_POS} 筆上限`); continue; }
  const sym = toBx(r.sym), c = spec[sym], long = !r.short, id = `${r.sym}|${r.sigT}`;
  if (!c || c.apiStateOpen === 'false') { log.push(`${sym} 略過：BingX 不能用 API 開倉`); state.done[id] = 'skip'; continue; }
  if (held.has(sym)) { log.push(`${sym} 略過：已有持倉`); state.done[id] = 'skip'; continue; }
  try {
    const px = +(await bx('GET', '/openApi/swap/v2/quote/price', { symbol: sym })).price;
    const stop = fix(r.stop, c.pricePrecision), tp = fix(r.target, c.pricePrecision), risk = long ? px - stop : stop - px;
    if (risk <= 0 || (long ? px >= tp : px <= tp)) { log.push(`${sym} 略過：價格已過停損或目標`); state.done[id] = 'skip'; continue; }
    const qty = fix(RISK / risk, c.quantityPrecision);
    if (qty < +c.tradeMinQuantity || qty * px < +(c.tradeMinUSDT || 0)) { log.push(`${sym} 略過：${RISK}U 風險下數量低於 BingX 最小下單量`); state.done[id] = 'skip'; continue; }
    const L = await bx('GET', '/openApi/swap/v2/trade/leverage', { symbol: sym });
    const mx = +(long ? L?.maxLongLeverage : L?.maxShortLeverage) || 20;
    const lev = Math.max(1, Math.min(20, mx, Math.floor(1 / (3 * risk / px)))); // 強平距離 ≈ 3 倍停損距離
    const side = hedge ? (long ? 'LONG' : 'SHORT') : 'BOTH';
    if (LIVE) {
      await bx('POST', '/openApi/swap/v2/trade/marginType', { symbol: sym, marginType: 'ISOLATED' }).catch((e) => console.log(`${sym} 逐倉設定：${e.message}（已是逐倉時會出現，忽略）`));
      await bx('POST', '/openApi/swap/v2/trade/leverage', { symbol: sym, side, leverage: lev });
    }
    const o = await bx('POST', `/openApi/swap/v2/trade/order${LIVE ? '' : '/test'}`, {
      symbol: sym, side: long ? 'BUY' : 'SELL', positionSide: side, type: 'MARKET', quantity: qty,
      stopLoss: JSON.stringify({ type: 'STOP_MARKET', stopPrice: stop, workingType: 'MARK_PRICE' }),
      takeProfit: JSON.stringify({ type: 'TAKE_PROFIT_MARKET', stopPrice: tp, workingType: 'MARK_PRICE' }),
    });
    state.done[id] = LIVE ? 'open' : 'test'; slots--;
    if (LIVE) state.open[sym] = { side: long ? 'LONG' : 'SHORT', entry: px, stop, tp, qty, t: Date.now() };
    opens.push(bubble(`${long ? '📈 做多' : '📉 做空'} ${coin(sym)}`, LIVE ? '✅ 已下單' : '🧪 測試通過（未成交）', long ? '#30A46C' : '#E5484D', [
      row('進場', '≈ ' + px), row('停損 🛑', stop, '#FF6369'), row('止盈 🎯', tp + '（4R）', '#3DD68C'),
      row('數量', qty), row('槓桿', lev + 'x 逐倉'), row('風險', RISK + ' U（' + (RISK / usdt * 100).toFixed(1) + '%）'),
    ]));
    log.push(`${LIVE ? '✅ 已下單' : '🧪 測試通過'} ${long ? '做多' : '做空'} ${sym} ${qty} 顆 @≈${px}｜損 ${stop}｜盈 ${tp}｜槓桿 ${lev}x${o?.order?.orderID ? '｜單號 ' + o.order.orderID : ''}`);
  } catch (e) { log.push(`❌ ${sym} 失敗：${e.message}`); opens.push(bubble(`⚠️ ${coin(sym)} 下單失敗`, long ? '做多' : '做空', '#6F6E77', [{ type: 'text', text: e.message.slice(0, 200), size: 'xs', color: '#B5B3AD', wrap: true }])); }
}
// 只留 3 天內的紀錄
for (const k of Object.keys(state.done)) if (Date.now() - +k.split('|')[1] > 3 * 864e5) delete state.done[k];
save();
console.log(log.join('\n'));
const msg = log.filter((x) => /^(✅|🧪|❌)/.test(x));
if (opens.length) await card(opens, `🤖 Delta 自動交易｜${TAG}新單 ${msg.length} 筆\n` + msg.join('\n'));
