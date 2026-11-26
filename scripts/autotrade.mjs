// BingX 自動交易：Delta 階梯（4H）＋BTC 大盤濾網（BTC 4H 在 EMA200 上只做多、下只做空）
// 每筆打到停損賠「永續帳戶餘額 × RISK_PCT%」（預設 0.5%），同時最多 MAX_POS 筆（預設 10），進場同時掛停損與 4R 止盈（照網站訊號價位）。
//
// 需要（GitHub → Settings → Secrets and variables → Actions）：
//   Secrets：BINGX_KEY、BINGX_SECRET（BingX API，只開「合約交易」，不要開提現，建議綁 IP）
//   Variables：TRADE_LIVE=1 才真的下單；沒設 = 只用 BingX「測試下單」端點驗證、不成交
//   選填 Variables：RISK_PCT（預設 0.5）、RISK_USD（設了就改用固定金額）、MAX_POS（預設 10）、TRADE_ENV=vst（模擬盤）
// 投組回測（2018–2026、60 幣、複利、扣費）：0.5%／10 筆 年化約 71%、最大回撤 −41%、9 年全正；隨機進場同設定 −4%／年。
// 回測依據：專案文件 Delta階梯多空2018起長期回測.md、Delta階梯延遲進場檢驗.md（晚 2 小時進場影響很小）。
process.env.SNAPSHOT ??= '1';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { get } from './_api.mjs';

const KEY = process.env.BINGX_KEY, SEC = process.env.BINGX_SECRET;
if (!KEY || !SEC) { console.log('還沒設定 BINGX_KEY / BINGX_SECRET，跳過自動交易'); process.exit(0); }
const LIVE = process.env.TRADE_LIVE === '1';
const PCT = +(process.env.RISK_PCT || 0.5) / 100, MAX_POS = +(process.env.MAX_POS || 10);
const HOST = process.env.TRADE_ENV === 'vst' ? 'https://open-api-vst.bingx.com' : 'https://open-api.bingx.com';
const STATE = '.alert-state/autotrade.json', LINE = process.env.LINE_TOKEN;
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { done: {} }; } })();

async function bx(method, path, params = {}) {
  const p = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const s = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join('&');
  const sig = crypto.createHmac('sha256', SEC).update(s).digest('hex');
  const q = Object.keys(p).sort().map((k) => `${k}=${encodeURIComponent(p[k])}`).join('&');
  const r = await fetch(`${HOST}${path}?${q}&signature=${sig}`, { method, headers: { 'X-BX-APIKEY': KEY, 'X-SOURCE-KEY': 'BX-AI-SKILL' }, signal: AbortSignal.timeout(15000) });
  const t = await r.text(), j = JSON.parse(t.replace(/"orderId":(\d{16,})/g, '"orderId":"$1"'));
  if (j.code !== 0) throw new Error(`BingX ${j.code} ${j.msg || ''}（${path}）`);
  return j.data;
}
async function push(text) {
  if (!LINE) return;
  await fetch('https://api.line.me/v2/bot/message/broadcast', { method: 'POST', headers: { Authorization: 'Bearer ' + LINE, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ type: 'text', text }] }) }).catch(() => {});
}
const fix = (v, d) => Math.floor(v * 10 ** d) / 10 ** d;
const toBx = (s) => s.replace(/USDT$/, '-USDT');

const fp = await get('/api/twhist?fp=1&force=1');
if (fp.btcUp == null) { console.log('BTC 狀態抓不到，這輪不下單'); process.exit(0); }
// 只做 BTC 同向；訊號 4H 收盤後 4 小時內才進（sigT 是 K 棒開盤時間）
const sigs = [...fp.long, ...fp.short.map((r) => ({ ...r, short: true }))]
  .filter((r) => r.bOk === true && Date.now() < r.sigT + 8 * 3600e3 && !state.done[`${r.sym}|${r.sigT}`])
  .sort((a, b) => Math.abs(b.dn) - Math.abs(a.dn));
console.log(`BTC ${fp.btcUp ? '在' : '在下'} EMA200；同向新訊號 ${sigs.length} 筆；${LIVE ? '實盤' : '測試模式（不成交）'}`);
if (!sigs.length) process.exit(0);

const [pos, dual, cts, bal] = await Promise.all([bx('GET', '/openApi/swap/v2/user/positions'), bx('GET', '/openApi/swap/v1/positionSide/dual'), bx('GET', '/openApi/swap/v2/quote/contracts'), bx('GET', '/openApi/swap/v3/user/balance')]);
const usdt = +((Array.isArray(bal) ? bal : [bal]).find((x) => x?.asset === 'USDT')?.balance || 0);
const RISK = process.env.RISK_USD ? +process.env.RISK_USD : +(usdt * PCT).toFixed(4);
console.log(`永續 USDT 餘額 ${usdt}，每筆風險 ${RISK}U`);
if (!(RISK > 0)) { console.log('餘額是 0，不下單'); process.exit(0); }
const held = new Set((pos || []).filter((x) => +x.positionAmt !== 0).map((x) => x.symbol));
const hedge = String(dual?.dualSidePosition) === 'true';
const spec = Object.fromEntries((cts || []).map((c) => [c.symbol, c]));
let slots = MAX_POS - held.size;
const log = [];
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
    const lev = Math.max(1, Math.min(20, Math.floor(0.5 / (risk / px)), long ? c.maxLongLeverage : c.maxShortLeverage)); // 停損遠就降槓桿，避免先爆倉
    const side = hedge ? (long ? 'LONG' : 'SHORT') : 'BOTH';
    if (LIVE) await bx('POST', '/openApi/swap/v2/trade/leverage', { symbol: sym, side, leverage: lev });
    const o = await bx('POST', `/openApi/swap/v2/trade/order${LIVE ? '' : '/test'}`, {
      symbol: sym, side: long ? 'BUY' : 'SELL', positionSide: side, type: 'MARKET', quantity: qty,
      stopLoss: JSON.stringify({ type: 'STOP_MARKET', stopPrice: stop, workingType: 'MARK_PRICE' }),
      takeProfit: JSON.stringify({ type: 'TAKE_PROFIT_MARKET', stopPrice: tp, workingType: 'MARK_PRICE' }),
    });
    state.done[id] = LIVE ? 'open' : 'test'; slots--;
    log.push(`${LIVE ? '✅ 已下單' : '🧪 測試通過'} ${long ? '做多' : '做空'} ${sym} ${qty} 顆 @≈${px}｜損 ${stop}｜盈 ${tp}｜槓桿 ${lev}x${o?.order?.orderID ? '｜單號 ' + o.order.orderID : ''}`);
  } catch (e) { log.push(`❌ ${sym} 失敗：${e.message}`); }
}
// 只留 3 天內的紀錄
for (const k of Object.keys(state.done)) if (Date.now() - +k.split('|')[1] > 3 * 864e5) delete state.done[k];
fs.mkdirSync('.alert-state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state));
console.log(log.join('\n'));
const msg = log.filter((x) => /^(✅|🧪|❌)/.test(x));
if (msg.length) await push(`【Delta 自動交易${LIVE ? '' : '・測試'}】\n` + msg.join('\n'));
