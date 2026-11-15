// 持股診斷純函式測試：輸入驗證、匯出匯入、診斷分支、組合摘要。
import assert from 'node:assert/strict';
import { normalizeHolding, upsertHolding, exportHoldings, parseHoldings, diagnose, summarize, flagsOf, statRow, baseRow } from '../lib/diagHold.js';
let n = 0; const t = (f) => { f(); n++; };
t(() => assert.ok(normalizeHolding({ code: '12' }).error));
t(() => assert.ok(normalizeHolding({ code: '2330', shares: -1 }).error));
t(() => assert.ok(normalizeHolding({ code: '2330', cost: 0 }).error));
t(() => assert.deepEqual(normalizeHolding({ code: ' 2330 ', shares: '1000', cost: '' }).holding, { code: '2330', shares: 1000, cost: null }));
t(() => { let l = upsertHolding([], { code: '2330', shares: 1 }).list; l = upsertHolding(l, { code: '2330', shares: 5, cost: 10 }).list; assert.equal(l.length, 1); assert.equal(l[0].shares, 5); });
t(() => { const l = [{ code: '2330', shares: 1000, cost: 1800 }]; assert.deepEqual(parseHoldings(exportHoldings(l)).list, l); });
t(() => assert.ok(parseHoldings('{bad').error));
t(() => assert.equal(parseHoldings(JSON.stringify([{ code: '2330' }, { code: 'x' }])).skipped.length, 1));
t(() => assert.deepEqual(flagsOf(1 | 16), { A: true, B: false, C: false, D: false, S: true }));
const row = (o) => ({ name: 'X', px: 100, ma200: 90, hi250: 120, mom: 0.1, near: 0.83, tScore: 0.5, tPct: 0.5, flags: 0, v20: 5000, ok: 1, ...o });
t(() => assert.equal(diagnose({ code: '1111', shares: 1, cost: null }, null, null).status, 'notfound'));
t(() => assert.equal(diagnose({ code: '1111', shares: 1, cost: null }, row({ ok: 0 }), null).status, 'outside'));
t(() => { const r = diagnose({ code: '1111', shares: 10, cost: 125 }, row({ flags: 1 }), null); assert.equal(r.status, 'ok'); assert.ok(r.flags.A); assert.equal(r.value, 1000); assert.ok(Math.abs(r.needGain - 0.25) < 1e-9); assert.ok(Math.abs(r.pnl + 0.2) < 1e-9); });
t(() => { const r = diagnose({ code: '1111', shares: 10, cost: 50 }, row(), null); assert.equal(r.needGain, 0); }); // 賺錢時不顯示回本幅度
t(() => assert.equal(diagnose({ code: '1111', shares: 1, cost: null }, row({ v20: 999 }), null).liqLow, true));
// 成本價不影響旗標與統計
t(() => { const a = diagnose({ code: '1', shares: 1, cost: 1 }, row({ flags: 1 }), null), b = diagnose({ code: '1', shares: 1, cost: 999 }, row({ flags: 1 }), null); assert.deepEqual(a.flags, b.flags); assert.equal(a.tPct, b.tPct); });
t(() => { const rs = [diagnose({ code: 'a', shares: 100, cost: null }, row({ flags: 1 }), null), diagnose({ code: 'b', shares: 100, cost: null }, row({ flags: 16 }), null)]; const sm = summarize(rs); assert.equal(sm.total, 20000); assert.equal(sm.weakShare, 0.5); assert.equal(sm.strongShare, 0.5); assert.equal(sm.warns.length, 2); });
t(() => { const sm = summarize([diagnose({ code: 'a', shares: 100, cost: null }, row(), null)]); assert.equal(sm.warns.length, 1); }); // 單檔 100% → 集中度提醒
t(() => { const s = statRow('A', 3), b = baseRow(3); assert.ok(s.ex < 0 && s.pWeak + s.pMid + s.pStrong === 100 && b.pMid + b.pWeak + b.pStrong === 100); assert.ok(statRow('S', 3).ex > 0); });
console.log('diagHold OK', n);
import { diagnose as dg2 } from '../lib/diagHold.js';
assert.equal(dg2({ code: '0050', shares: 1, cost: null }, { name: 'ETF', px: 100, ma200: 90, hi250: 120, mom: 0.1, near: 0.8, tScore: 0.5, tPct: 0.5, flags: 16, v20: 5000, ok: 1 }, null).status, 'etf');
console.log('etf OK');
import { recoverBucket, recoverRows } from '../lib/diagHold.js';
assert.equal(recoverBucket(0.05), null);                       // 太小不列
assert.equal(recoverBucket(0.0799), null); assert.equal(recoverBucket(0.08).x, 10);
assert.equal(recoverBucket(0.24).x, 20); assert.equal(recoverBucket(0.25).x, 30); assert.equal(recoverBucket(0.35).x, 30); assert.equal(recoverBucket(0.40).x, 50); assert.equal(recoverBucket(0.70).x, 50);
assert.equal(recoverBucket(1.0).x, 100); assert.equal(recoverBucket(5).x, 100); assert.ok(recoverBucket(5).beyond); assert.ok(!recoverBucket(1.2).beyond);
assert.equal(recoverBucket(0.2).exact, true); assert.equal(recoverBucket(0.40).exact, false);
{ const r = recoverRows({ A: true, B: false, C: true, D: false, S: false }, 0.2); assert.deepEqual(r.rows.map((x) => x.g), ['弱A', '全體']); // C 沒有統計，不列
  assert.equal(r.rows[0].m6.p, 28.2); assert.equal(r.rows[1].m6.p, 32.1); assert.ok(r.rows[0].m6.p < r.rows[1].m6.p); assert.equal(r.rows[0].m12.p, 44.6); assert.equal(r.rows[0].v6.p, 28.6); }
{ const r = recoverRows({ A: false, B: false, C: false, D: false, S: true }, 0.5); assert.deepEqual(r.rows.map((x) => x.g), ['強', '全體']); }
console.log('recover OK');
