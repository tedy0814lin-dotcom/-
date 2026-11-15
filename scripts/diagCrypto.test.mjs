// 加密持股純函式測試：輸入驗證、匯出匯入、損益算術、不改動原快照、無建議欄位。
import assert from 'node:assert/strict';
import { normalizeCoin, upsertCoin, exportCoins, parseCoins, findRow, diagnoseCoin, summarizeCoins } from '../lib/diagCrypto.js';
let n = 0; const t = (f) => { f(); n++; };
t(() => assert.deepEqual(normalizeCoin({ base: ' btcusdt ', qty: '0.5', cost: '' }).holding, { base: 'BTC', qty: 0.5, cost: null }));
t(() => assert.equal(normalizeCoin({ base: 'eth-usdt' }).holding.base, 'ETH'));
t(() => assert.ok(normalizeCoin({ base: 'B' }).error));
t(() => assert.ok(normalizeCoin({ base: '比特幣' }).error));
t(() => assert.ok(normalizeCoin({ base: 'BTC', qty: -1 }).error));
t(() => assert.ok(normalizeCoin({ base: 'BTC', cost: 0 }).error));
t(() => { let l = upsertCoin([], { base: 'BTC', qty: 1 }).list; l = upsertCoin(l, { base: 'btc', qty: 2, cost: 100 }).list; assert.equal(l.length, 1); assert.equal(l[0].qty, 2); });
t(() => { const l = [{ base: 'BTC', qty: 0.5, cost: 60000 }]; assert.deepEqual(parseCoins(exportCoins(l)).list, l); });
t(() => assert.ok(parseCoins('x').error));
t(() => assert.equal(parseCoins(JSON.stringify([{ base: 'BTC' }, { base: '??' }])).skipped.length, 1));
const rows = [{ base: 'BTC', price: 100, chg24: 2, oi: null, funding: 0.01 }, { base: '1000PEPE', price: 0.01, chg24: -1, oi: null, funding: 0.02 }];
t(() => assert.equal(findRow(rows, 'PEPE').base, '1000PEPE'));
t(() => assert.equal(findRow(rows, 'XXX'), null));
const x = { byBase: { BTC: { OKX: { oiUsd: 3e9, funding: 0.01 }, Bitget: { oiUsd: 1e9, funding: 0.03 } } }, hist: { BTC: {} } };
t(() => { const r = diagnoseCoin({ base: 'BTC', qty: 2, cost: 125 }, rows[0], x); assert.equal(r.status, 'ok'); assert.equal(r.value, 200); assert.ok(Math.abs(r.pnl + 0.2) < 1e-12); assert.equal(r.pnlUsd, -50); assert.ok(Math.abs(r.needGain - 0.25) < 1e-12); assert.equal(r.chip.oi, 4e9); assert.equal(r.chip.oiEx, 2); assert.ok(r.chip.hasXchg); });
t(() => { const r = diagnoseCoin({ base: 'BTC', qty: 1, cost: 50 }, rows[0], x); assert.equal(r.needGain, 0); assert.ok(r.pnl > 0); });
t(() => { const snap = JSON.stringify(rows[0]); diagnoseCoin({ base: 'BTC', qty: 1, cost: 1 }, rows[0], x); assert.equal(JSON.stringify(rows[0]), snap); }); // 不改到原快照
t(() => { const a = diagnoseCoin({ base: 'BTC', qty: 1, cost: 1 }, rows[0], x), b = diagnoseCoin({ base: 'BTC', qty: 1, cost: 99999 }, rows[0], x); assert.deepEqual(a.chip, b.chip); }); // 成本不影響籌碼
t(() => { const r = diagnoseCoin({ base: 'BTC', qty: 1, cost: 1 }, rows[0], null); assert.equal(r.status, 'ok'); assert.equal(r.chip.hasXchg, false); }); // 其他交易所沒抓到也能顯示
t(() => assert.equal(diagnoseCoin({ base: 'ZZZ', qty: 1 }, null, x).status, 'notfound'));
t(() => { const r = diagnoseCoin({ base: 'BTC', qty: 1, cost: 1 }, rows[0], x); assert.ok(!('flags' in r) && !('advice' in r)); }); // 不產生旗標或建議
t(() => { const rs = [diagnoseCoin({ base: 'BTC', qty: 1 }, rows[0], x), diagnoseCoin({ base: 'PEPE', qty: 1000 }, rows[1], x)]; const sm = summarizeCoins(rs); assert.equal(sm.total, 110); assert.equal(sm.warns.length, 1); });
t(() => { const rs = [diagnoseCoin({ base: 'BTC', qty: 2, cost: 125 }, rows[0], x), diagnoseCoin({ base: 'PEPE', qty: 1000, cost: null }, rows[1], x)]; const tt = summarizeCoins(rs).totals; assert.equal(tt.value, 200 + 10); assert.equal(tt.cost, 250); assert.equal(tt.pnl, -50); assert.ok(Math.abs(tt.pnlPct + 0.2) < 1e-12); assert.equal(tt.nWithCost, 1); assert.equal(tt.nHeld, 2); assert.ok(Math.abs(tt.costShare - 200 / 210) < 1e-12); });
console.log('diagCrypto OK', n);
