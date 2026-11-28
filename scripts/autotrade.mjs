// BingX 自動交易：Delta 階梯（4H）＋BTC 大盤濾網（BTC 4H 在 EMA200 上只做多、下只做空）
// 每筆打到停損賠「永續帳戶餘額 × RISK_PCT%」（預設 0.56%）；比最高點少 10% 時風險 ×0.7、少 20% 時 ×0.5，同時最多 MAX_POS 筆（預設 25），進場同時掛停損與 4R 止盈（照網站訊號價位）。
//
// 需要（GitHub → Settings → Secrets and variables → Actions）：
//   Secrets：BINGX_KEY、BINGX_SECRET（BingX API，只開「合約交易」，不要開提現，建議綁 IP）
//   預設（alert.yml）：TRADE_ENV=vst＋TRADE_LIVE=1 → 在 BingX 模擬盤真的下單；要實盤就在 Variables 設 TRADE_ENV=live
//   TRADE_LIVE=0 → 只用「測試下單」端點驗證、不成交
//   選填 Variables：RISK_PCT（預設 1）、RISK_USD（設了就改用固定金額）、MAX_POS（預設 10）、TRADE_ENV=vst（模擬盤）
// 投組回測（387 幣、90 天成交額前 50、2018–2026、複利、扣費）：25 筆 × 0.56%＋分段減碼 年化約 157%、回撤 −49%、9 年全正；2022 後 81%／−49%（成本加倍 57%／−50%）。
// 防爆倉：每檔改逐倉，槓桿 ≤ 1 ÷（3 × 停損%），強平價約在停損 3 倍遠，停損一定先觸發；單筆最多賠它自己的保證金。
// 回測依據：專案文件 Delta階梯多空2018起長期回測.md、Delta階梯延遲進場檢驗.md（晚 2 小時進場影響很小）。
process.env.SNAPSHOT ??= '1';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { get } from './_api.mjs';

const KEY = process.env.BINGX_KEY, SEC = process.env.BINGX_SECRET;
if (!KEY || !SEC) { console.log('還沒設定 BINGX_KEY / BINGX_SECRET，跳過自動交易'); process.exit(0); }
const LIVE = process.env.TRADE_LIVE === '1';
const PCT = +(process.env.RISK_PCT || 0.56) / 100, MAX_POS = +(process.env.MAX_POS || 25);
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

// 保護單檢查：持倉一定要有停損（止盈價 > 0 才掛止盈）；附帶的止盈止損沒掛上就另外補掛
const ordersOf = async (sym) => { const d = await bx('GET', '/openApi/swap/v2/trade/openOrders', { symbol: sym }); return Array.isArray(d) ? d : d?.orders || []; };
async function protect(sym, o, hedge) {
  const od = await ordersOf(sym), has = (t) => od.some((x) => x.type === t);
  const close = o.side === 'LONG' ? 'SELL' : 'BUY', ps = hedge ? o.side : 'BOTH', fixed = [];
  const put = (type, price) => bx('POST', '/openApi/swap/v2/trade/order', { symbol: sym, side: close, positionSide: ps, type, quantity: o.qty, stopPrice: price, workingType: 'MARK_PRICE', closePosition: 'true' });
  if (!has('STOP_MARKET')) { await put('STOP_MARKET', o.stop); fixed.push('停損 ' + o.stop); }
  if (o.tp > 0 && !has('TAKE_PROFIT_MARKET')) { await put('TAKE_PROFIT_MARKET', o.tp); fixed.push('止盈 ' + o.tp); }
  return fixed;
}
const HOLD = 20 * 864e5; // 回測最長持有 120 根 4H（20 天），到期市價平倉
const fix = (v, d) => +(Math.floor(v * 10 ** d + 1e-9) / 10 ** d).toFixed(d);
const toBx = (s) => s.replace(/USDT$/, '-USDT');

// 先確認金鑰能用（第一次連上就 LINE 通知一次）
let usdt, balT;
try {
  balT = Date.now(); const bal = await bx('GET', '/openApi/swap/v3/user/balance');
  const B = (Array.isArray(bal) ? bal : [bal]).filter(Boolean); // 模擬盤的資產叫 VST，不是 USDT
  usdt = +((B.find((x) => x.asset === 'USDT' && +x.balance > 0) || B.find((x) => x.asset === 'VST') || B.find((x) => +x.balance > 0) || {}).balance || 0);
} catch (e) { console.log('BingX 金鑰檢查失敗：' + e.message); if (!state.authErr) await push('⚠️ Delta 自動交易｜BingX 金鑰檢查失敗\n' + e.message); state.authErr = 1; save(); process.exit(0); }
// 回撤用「策略淨值」算（像基金淨值）：入金／出金只改變本金、不改變淨值，所以減碼只看策略本身賺賠
// 每輪：本輪賺賠 = 現在餘額 − 上輪餘額 − 這段時間的轉帳；淨值 ×= (1 + 本輪賺賠 ÷ 上輪餘額)
{
  const now = balT; let net = 0;
  if (state.flowT) {
    try {
      const fl = await bx('GET', '/openApi/swap/v2/user/income', { incomeType: 'TRANSFER', startTime: state.flowT + 1, endTime: now, limit: 1000 });
      for (const x of fl || []) net += +x.income;
    } catch (e) { console.log('轉帳紀錄查詢失敗，這輪淨值不更新：' + e.message); net = null; }
  }
  if (net !== null) {
    state.nav ??= 1; state.navPeak ??= 1;
    if (state.lastBal > 0) state.nav *= 1 + (usdt - state.lastBal - net) / state.lastBal;
    if (net) console.log(`偵測到轉帳 ${net > 0 ? '+' : ''}${net}U（不算賺賠）`);
    state.navPeak = Math.max(state.navPeak, state.nav); state.lastBal = usdt; state.flowT = now;
  }
}
const ddp = 1 - state.nav / state.navPeak, k = ddp > 0.2 ? 0.5 : ddp > 0.1 ? 0.7 : 1, brk = k < 1; // 分段減碼：淨值回撤 10% ×0.7、20% ×0.5
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
// 每輪檢查還開著的單：沒有保護單就補掛；持有超過 20 天就平倉（同回測）
{
  const hedge0 = String((await bx('GET', '/openApi/swap/v1/positionSide/dual'))?.dualSidePosition) === 'true', notes = [];
  for (const [sym, o] of Object.entries(state.open)) {
    if (!active.has(sym)) continue;
    try {
      if (Date.now() - o.t > HOLD) {
        const p = (pos || []).find((x) => x.symbol === sym && +x.positionAmt !== 0);
        await bx('POST', '/openApi/swap/v1/trade/closePosition', { positionId: p.positionId });
        notes.push(`⏰ ${coin(sym)} 持有滿 20 天，已市價平倉`); continue;
      }
      const f = await protect(sym, o, hedge0);
      if (f.length) notes.push(`🛡️ ${coin(sym)} 補掛 ${f.join('、')}`);
    } catch (e) { notes.push(`⚠️ ${coin(sym)} 保護單檢查失敗：${e.message.slice(0, 120)}`); }
  }
  if (notes.length) { console.log(notes.join('\n')); await push('🤖 Delta 自動交易｜' + TAG + '\n' + notes.join('\n')); }
}
const fp = process.env.FP_FILE ? JSON.parse(fs.readFileSync(process.env.FP_FILE, 'utf8')) : await get('/api/twhist?fp=1&force=1'); // FP_FILE：測試用
if (fp.btcUp == null) { console.log('BTC 狀態抓不到，這輪不下單'); process.exit(0); }
// 只做真正的加密幣（回測同範圍：排除黃金、穩定幣）；2026-11-26 回測：真加密幣含 BTC 1%／10 筆 年化 159%、回撤 −49%（BTC 本身每筆 +0.32R、隨機 −0.07R）
const NOT_CRYPTO = /^(XAUT|PAXG|WBTC|USDC|FDUSD|TUSD|USD1|DAI|XUSD|RLUSD|RWUSD|U)USDT$|^NC/;
// 只做 BTC 同向；訊號 4H 收盤後 4 小時內才進（sigT 是 K 棒開盤時間）
// 選幣與濾網都由網站同一支掃描決定（r.pass：BTC 同向、90 天成交額前 50、非跌太深空單、非黃金穩定幣），網站看到的＝自動交易會做的
const sigs = [...fp.long, ...fp.short.map((r) => ({ ...r, short: true }))]
  .filter((r) => r.pass === true && Date.now() < r.sigT + 8 * 3600e3 && !state.done[`${r.sym}|${r.sigT}`])
  .sort((a, b) => Math.abs(b.dn) - Math.abs(a.dn));
console.log(`BTC ${fp.btcUp ? '在' : '在下'} EMA200；同向新訊號 ${sigs.length} 筆；${LIVE ? '實盤' : '測試模式（不成交）'}`);
if (!sigs.length) { save(); process.exit(0); }

const [dual, cts] = await Promise.all([bx('GET', '/openApi/swap/v1/positionSide/dual'), bx('GET', '/openApi/swap/v2/quote/contracts')]);
const RISK = process.env.RISK_USD ? +process.env.RISK_USD : +(usdt * PCT * k).toFixed(4);
console.log(`永續 USDT 餘額 ${usdt}，策略淨值 ${state.nav.toFixed(4)}（最高 ${state.navPeak.toFixed(4)}，回撤 ${(ddp * 100).toFixed(1)}%），每筆風險 ${RISK}U${brk ? `（回撤減碼：×${k}）` : ''}`);
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
      ...(tp > 0 ? { takeProfit: JSON.stringify({ type: 'TAKE_PROFIT_MARKET', stopPrice: tp, workingType: 'MARK_PRICE' }) } : {}),
    });
    state.done[id] = LIVE ? 'open' : 'test'; slots--;
    if (LIVE) {
      state.open[sym] = { side: long ? 'LONG' : 'SHORT', entry: px, stop, tp, qty, t: Date.now() };
      await new Promise((ok) => setTimeout(ok, 1500));
      try { const f = await protect(sym, state.open[sym], hedge); if (f.length) log.push(`🛡️ ${sym} 附帶止盈止損沒掛上，已補掛 ${f.join('、')}`); }
      catch (e) { log.push(`❌ ${sym} 補掛停損失敗：${e.message}`); }
    }
    opens.push(bubble(`${long ? '📈 做多' : '📉 做空'} ${coin(sym)}`, LIVE ? '✅ 已下單' : '🧪 測試通過（未成交）', long ? '#30A46C' : '#E5484D', [
      row('進場', '≈ ' + px), row('停損 🛑', stop, '#FF6369'), row('止盈 🎯', tp > 0 ? tp + `（${(Math.abs(tp - px) / risk).toFixed(2).replace(/\.?0+$/, '')}R）` : '不設（最多持有 20 天）', '#3DD68C'),
      row('數量', qty), row('槓桿', lev + 'x 逐倉'), row('風險', RISK + ' U（' + (RISK / usdt * 100).toFixed(1) + '%）'),
    ]));
    log.push(`${LIVE ? '✅ 已下單' : '🧪 測試通過'} ${long ? '做多' : '做空'} ${sym} ${qty} 顆 @≈${px}｜損 ${stop}｜盈 ${tp}｜槓桿 ${lev}x${o?.order?.orderID ? '｜單號 ' + o.order.orderID : ''}`);
  } catch (e) { log.push(`❌ ${sym} 失敗：${e.message}`); opens.push(bubble(`⚠️ ${coin(sym)} 下單失敗`, long ? '做多' : '做空', '#6F6E77', [{ type: 'text', text: e.message.slice(0, 200), size: 'xs', color: '#B5B3AD', wrap: true }])); }
}
// 只留 3 天內的紀錄
for (const k of Object.keys(state.done)) if (Date.now() - +k.split('|')[1] > 3 * 864e5) delete state.done[k];
save();
console.log(log.join('\n'));
const msg = log.filter((x) => /^(✅|🧪|❌|🛡️)/.test(x));
if (opens.length) await card(opens, `🤖 Delta 自動交易｜${TAG}新單 ${msg.length} 筆\n` + msg.join('\n'));
