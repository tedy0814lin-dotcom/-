// 持股現價：名單資料較舊時用 list[].q 的較新收盤價；否則用名單收盤價；正2 用 lev
import assert from 'node:assert/strict';
import { quoteOf, priceOf, pickQuote } from '../lib/s6uQuote.js';
const data = { asof: '2026-11-13', lev: { code: '00631L', close: 27.95, day: '2026-11-16' }, list: [
  { code: '2603', close: 100, q: ['2026-11-16', 103.5] },       // 有較新報價
  { code: '2609', close: 50, q: ['2026-11-13', 50] },            // 報價日不晚於 asof → 不採用
  { code: '1102', close: 40 },                                  // 沒有報價欄位
  { code: '9999', close: 10, q: ['2026-11-16', NaN] },          // 壞值 → 不採用
  { code: '8888', close: 10, q: ['2026-11-16', 0] },
] };
assert.deepEqual(priceOf(data, '2603', '00631L'), { close: 103.5, day: '2026-11-16' });
assert.deepEqual(priceOf(data, '2609', '00631L'), { close: 50, day: '2026-11-13' });
assert.deepEqual(priceOf(data, '1102', '00631L'), { close: 40, day: '2026-11-13' });
assert.deepEqual(priceOf(data, '9999', '00631L'), { close: 10, day: '2026-11-13' });
assert.deepEqual(priceOf(data, '8888', '00631L'), { close: 10, day: '2026-11-13' });
assert.deepEqual(priceOf(data, '00631L', '00631L'), { close: 27.95, day: '2026-11-16' });
assert.equal(priceOf(data, '0000', '00631L'), null);
assert.equal(priceOf(null, '2603', '00631L'), null);
assert.equal(priceOf({ asof: '2026-11-13', lev: null, list: [] }, '00631L', '00631L'), null);
assert.equal(quoteOf({ q: '2026-11-16' }, '2026-11-13'), null);
// pickQuote：日線有較新一根 → 用它；沒有（收盤 null）→ 用 meta 報價（台北 13:25 後）
const bars = [['2026-11-12', 250, 251.5], ['2026-11-13', 257.5, 257.5]], tp = (iso) => Date.parse(iso + '+08:00') / 1000;
assert.deepEqual(pickQuote([...bars, ['2026-11-16', 257, 257]], null, '2026-11-13', '2026-11-16', 257.5), ['2026-11-16', 257]);
assert.deepEqual(pickQuote(bars, { t: tp('2026-11-16T13:30:16'), p: 257 }, '2026-11-13', '2026-11-16', 257.5), ['2026-11-16', 257]);
assert.equal(pickQuote(bars, { t: tp('2026-11-16T11:00:00'), p: 257 }, '2026-11-13', '2026-11-16', 257.5), null, '盤中價不收');
assert.equal(pickQuote(bars, { t: tp('2026-11-16T13:30:16'), p: 257 }, '2026-11-13', '2026-11-13', 257.5), null, '超過可接受的最晚日期');
assert.equal(pickQuote(bars, { t: tp('2026-11-13T13:30:00'), p: 257 }, '2026-11-13', '2026-11-16', 257.5), null, '報價日不晚於名單資料日');
assert.equal(pickQuote(bars, { t: tp('2026-11-16T13:30:16'), p: 400 }, '2026-11-13', '2026-11-16', 257.5), null, '差太多視為異常');
assert.equal(pickQuote(bars, null, '2026-11-13', '2026-11-16', 257.5), null);
assert.equal(pickQuote([], { t: tp('2026-11-16T13:30:16'), p: 0 }, '2026-11-13', '2026-11-16', 257.5), null);
console.log('s6uQuote 測試通過');
