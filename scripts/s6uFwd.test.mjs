// 前瞻記錄（lib/s6uFwd.js）：用合成資料驗證建倉、每日標示、月底結算、成本、缺價、補算旗標。
import assert from 'node:assert/strict';
import { step, markEW, rebalanceCost, benchRet, summarize, BUY, SELL, pickHoldings } from '../lib/s6uFwd.js';
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
const names = (p, n) => Array.from({ length: n }, (_, i) => [String(p + i), 'n' + i, 100, i + 1]);
const mk = (month, day, base, R, official = true) => ({ month, day, official, top: base, topM: R });
const bench = [['2026-10-30', 100], ['2026-11-13', 102], ['2026-11-30', 105], ['2026-12-31', 99]];
// pickHoldings：只取前 15
assert.equal(pickHoldings(mk('x', 'd', names(1000, 60), names(2000, 60)), 'top').length, 15);
// markEW：缺價者不入平均、列在 miss
{ const h = [{ code: 'a', px: 100 }, { code: 'b', px: 50 }, { code: 'c', px: 10 }]; const m = markEW(h, new Map([['a', 110], ['b', 45]])); near(m.ret, 0); assert.equal(m.n, 2); assert.deepEqual(m.miss, ['c']); assert.equal(markEW([], new Map()).ret, null); }
// 成本：首次＝只有買進；換 3/15 檔＝0.2×(買＋賣)；完全不換＝0
near(rebalanceCost(null, ['a']), BUY); near(rebalanceCost(names(1, 15).map((x) => x[0]), names(1, 15).map((x) => x[0])), 0);
{ const a = Array.from({ length: 15 }, (_, i) => 'a' + i), b = [...a.slice(0, 12), 'x', 'y', 'z']; near(rebalanceCost(a, b), 0.2 * (BUY + SELL)); }
// 0050 報酬：日期不在表上取前一日
near(benchRet(bench, '2026-10-30', '2026-11-20'), 0.02); assert.equal(benchRet(bench, '2026-01-01', '2026-11-20'), null);
// 流程：10 月底建倉 → 11/13 每日標示 → 11 月底結算並建新倉 → 12 月底再結算
const base1 = names(1000, 20), R1 = names(2000, 20);
let snap = { asof: '2026-11-13', bench, months: [mk('2026-10', '2026-10-30', base1, R1), mk('2026-11', '2026-11-13', names(1000, 20), names(2000, 20), false)], list: [...base1, ...R1].map(([c]) => ({ code: c, close: 110 })) };
let rec = step(null, snap);
assert.equal(rec.periods.length, 1); assert.equal(rec.periods[0].month, '2026-10'); assert.equal(rec.periods[0].holdings.base.length, 15);
near(rec.current.ret.base, 0.10 - BUY); near(rec.current.bench, 0.02); assert.equal(rec.periods[0].end, null);
// 重跑同一天：不重複建倉、結果相同
const rec2 = step(rec, snap); assert.equal(rec2.periods.length, 1); assert.deepEqual(rec2.current, rec.current);
// 11 月底正式：平衡版換掉 3 檔
const R2 = [...R1.slice(0, 12), ['3001', 'x', 200, 13], ['3002', 'y', 200, 14], ['3003', 'z', 200, 15]];
const closes = new Map(); [...base1, ...R1].forEach(([c]) => closes.set(c, 120)); ['3001', '3002', '3003'].forEach((c) => closes.set(c, 220));
snap = { asof: '2026-11-30', bench, months: [mk('2026-10', '2026-10-30', base1, R1), mk('2026-11', '2026-11-30', base1, R2)], list: [...closes].map(([code, close]) => ({ code, close })) };
rec = step(rec, snap);
assert.equal(rec.periods.length, 2); const p0 = rec.periods[0];
near(p0.end.ret.base, 0.20 - BUY); near(p0.end.ret.R, 0.20 - BUY); near(p0.end.bench, 0.05); assert.equal(p0.end.exact, true);
near(rec.periods[1].cost.base, 0); near(rec.periods[1].cost.R, 0.2 * (BUY + SELL)); assert.equal(rec.periods[1].end, null);
// 12 月底：補算（asof 晚於正式月底日）→ exact＝false；有缺價者被記錄
const closes2 = new Map(closes); closes2.delete('1000'); [...closes2.keys()].forEach((c) => closes2.set(c, closes2.get(c) * 0.9));
snap = { asof: '2027-01-04', bench: [...bench, ['2027-01-04', 100]], months: [...snap.months, mk('2026-12', '2026-12-31', base1, R2)], list: [...closes2].map(([code, close]) => ({ code, close })) };
rec = step(rec, snap); const p1 = rec.periods[1];
assert.equal(p1.end.exact, false); assert.deepEqual(p1.end.miss.base, ['1000']); assert.equal(rec.periods.length, 3);
const S = summarize(rec); assert.equal(S.months, 2); assert.equal(S.late, 1); assert.equal(S.canRegress, false);
near(S.cum.bench, (1.05) * (100 / 105) - 1);
// 補價：extra 只補 list 沒有的代號，且不蓋掉 list 內的價
{ const h = [{ code: 'a', px: 100 }, { code: 'z', px: 100 }]; const sn = { asof: '2026-11-13', bench, months: [{ month: '2026-10', day: '2026-10-30', official: true, top: [['a', 'a', 100, 1], ['z', 'z', 100, 2]], topM: [['a', 'a', 100, 1], ['z', 'z', 100, 2]] }], list: [{ code: 'a', close: 110 }], extra: { z: 90, a: 1 } }; const r = step(null, sn); near(r.current.ret.base, 0.0 - BUY); assert.deepEqual(r.current.miss.base, []); const r0 = step(null, { ...sn, extra: undefined }); assert.deepEqual(r0.current.miss.base, ['z']); }
// 輸入不被改動
const frozen = JSON.stringify(rec); step(rec, snap); assert.equal(JSON.stringify(rec), frozen);
console.log('s6uFwd ok');
