// 三版本設定、「指定／排除」功能的測試
import assert from 'node:assert/strict';
import { planMonth, applyExclude } from '../lib/s6uPlan.js';
import { TIERS, buildListInfo, newState, makePlan, parseImport, exportState, planArgs } from '../lib/s6uState.js';

const mk = (n) => Array.from({ length: n }, (_, i) => ({ code: String(1000 + i), name: 'S' + i, close: 50 + i, rank: i + 1, ind: i % 2 ? '金融保險' : '半導體' }));
const L = mk(40);
// ---- 三版本最大檔數 ----
assert.deepEqual(['base', 'R', 'A'].map((k) => TIERS[k].nMax), [10, 10, 10]);
for (const [ver, exp] of [['base', 10], ['R', 10], ['A', 10]]) {
  const st = newState({ start: '2026-11-01', monthly: 100000, cash: 1000000 }); st.ver = ver;
  const r = planMonth({ list: L, holdings: [], cash: 1000000, ...planArgs(st, ver) });
  assert.equal(r.N, exp, 'nMax ' + ver); assert.equal(r.buys.filter((b) => b.status === 'buy').length, exp);
}
// 小資金：三版本檔數規則相同（資金夠就 5 檔起、每多 3 萬加一檔）
{ const r = planMonth({ list: L, holdings: [], cash: 60000, ...planArgs(newState({ start: '2026-11-01' }), 'A') }); assert.equal(r.N, 5); }

// ---- 排除：該檔不會被買，後面的名次遞補，名次重新編 ----
{
  const r = planMonth({ list: L, holdings: [], cash: 300000, params: { nMax: 10 }, exclude: ['1000', '1001'] });
  const bought = r.buys.filter((b) => b.status === 'buy').map((b) => b.code);
  assert.ok(!bought.includes('1000') && !bought.includes('1001'));
  assert.equal(bought.length, 10); assert.equal(bought[0], '1002');
  const re = applyExclude(L, ['1000']); assert.equal(re[0].code, '1001'); assert.equal(re[0].rank, 1); assert.equal(re.length, 39);
  // 名次 999 的維持 999
  const l2 = [...L.slice(0, 5), { code: '2999', name: 'Z', close: 10, rank: 999 }]; assert.equal(applyExclude(l2, ['1000']).at(-1).rank, 999);
}
// ---- 排除已持有的 → 標賣出（用原價格，不是 0 元）----
{
  const r = planMonth({ list: L, holdings: [{ code: '1000', shares: 100 }], cash: 200000, params: { nMax: 10 }, exclude: ['1000'] });
  const s = r.sells.find((x) => x.code === '1000'); assert.ok(s); assert.equal(s.price, 50); assert.match(s.reason, /排除/);
  assert.ok(s.proceeds > 4900 && s.proceeds < 5000);
}
// ---- 指定：名次很差也會買、而且不會被名次規則賣掉 ----
{
  const r = planMonth({ list: L, holdings: [], cash: 300000, params: { nMax: 10 }, pins: ['1030'] });
  const b = r.buys.filter((x) => x.status === 'buy'); assert.equal(b[0].code, '1030'); assert.equal(b[0].pinned, true); assert.equal(b.length, 10);
  const r2 = planMonth({ list: L, holdings: [{ code: '1030', shares: 50 }], cash: 200000, params: { nMax: 10 }, pins: ['1030'] });
  assert.ok(!r2.sells.some((x) => x.code === '1030'));
  const r3 = planMonth({ list: L, holdings: [{ code: '1030', shares: 50 }], cash: 200000, params: { nMax: 10 } });
  assert.ok(r3.sells.some((x) => x.code === '1030'), '沒指定時名次差要賣');
}
// ---- 指定但名額已滿：賣掉名次最差的非指定持股騰出名額 ----
{
  const hold = Array.from({ length: 5 }, (_, i) => ({ code: String(1000 + i), shares: 100 }));
  const r = planMonth({ list: L, holdings: hold, cash: 0, params: { nMax: 5 }, pins: ['1020'] });
  assert.equal(r.sells.length, 1); assert.equal(r.sells[0].code, '1004'); assert.match(r.sells[0].reason, /騰出/);
  const bought = r.buys.filter((b) => b.status === 'buy').map((b) => b.code); assert.ok(bought.includes('1020'));
}
// ---- 指定超過 N 檔：多的被忽略並回報；不在名單的指定被忽略 ----
{
  const r = planMonth({ list: L, holdings: [], cash: 150000, params: { nMax: 5 }, pins: ['1030', '1031', '1032', '1033', '1034', '1035', '9999'] });
  assert.equal(r.N, 5); assert.deepEqual(r.ignoredPins.sort(), ['1035', '9999']);
  assert.equal(r.buys.filter((b) => b.status === 'buy').length, 5);
}
// ---- 指定且排除同一檔：排除優先 ----
{ const r = planMonth({ list: L, holdings: [], cash: 300000, params: { nMax: 10 }, pins: ['1005'], exclude: ['1005'] }); assert.ok(!r.buys.some((b) => b.code === '1005')); }
// ---- 沒有指定／排除＝跟舊行為相同 ----
{ const a = planMonth({ list: L, holdings: [{ code: '1002', shares: 100 }], cash: 250000 }), b = planMonth({ list: L, holdings: [{ code: '1002', shares: 100 }], cash: 250000, pins: [], exclude: [] }); assert.deepEqual(a, b); }

// ---- 名單：三個版本各取各的欄位 ----
{
  const data = { rotOk: true, eOk: true, month: '2026-11', asof: '2026-11-12', finalMonth: '2026-10',
    list: [{ code: '1000', name: 'A', close: 10, rank: 1, rankM: 2, rankH: 3 }, { code: '1001', name: 'B', close: 11, rank: 2, rankM: 1, rankH: 1 }, { code: '1002', name: 'C', close: 12, rank: 3, rankM: 3, rankH: 2 }],
    months: [{ month: '2026-10', day: '2026-10-30', top: [['1000', 'x', 9, 1]], topM: [['1001', 'x', 9, 1]], topH: [['1002', 'x', 9, 1]] }] };
  assert.equal(buildListInfo(data, 'preview', 'A').list.sort((a, b) => a.rank - b.rank)[0].code, '1001');
  assert.equal(buildListInfo(data, 'preview', 'R').list.sort((a, b) => a.rank - b.rank)[0].code, '1001');
  assert.equal(buildListInfo(data, 'preview', 'base').list.sort((a, b) => a.rank - b.rank)[0].code, '1000');
  const f = buildListInfo(data, 'final', 'A'); assert.equal(f.list[0].code, '1002'); assert.equal(f.list[0].name, 'C'); assert.equal(f.list[0].close, 12);
  assert.equal(f.list.find((x) => x.code === '1000').rank, 999);
  assert.equal(buildListInfo({ ...data, rotOk: false }, 'preview', 'A'), null);
  assert.equal(buildListInfo({ ...data, months: [{ ...data.months[0], topH: undefined }] }, 'final', 'A'), null);
  assert.ok(buildListInfo({ ...data, rotOk: false }, 'preview', 'base'));
}
// ---- makePlan 使用該版本的檔數與指定／排除；匯出匯入保留 ----
{
  const st = newState({ start: '2026-11-01', monthly: 100000, cash: 1000000 }); st.ver = 'A'; st.pins = ['1030']; st.exclude = ['1000'];
  const info = { kind: 'preview', ver: 'A', month: '2026-11', day: '2026-11-12', list: L };
  const pl = makePlan(st, '2026-11', info, '2026-11-12');
  assert.equal(pl.ver, 'A'); assert.equal(pl.N, 10);
  const buys = pl.items.filter((x) => x.kind === 'buy'); assert.equal(buys.length, 10); assert.equal(buys[0].code, '1030'); assert.equal(buys[0].pinned, true);
  assert.ok(!buys.some((x) => x.code === '1000'));
  const back = parseImport(exportState(st)); assert.deepEqual(back.pins, ['1030']); assert.deepEqual(back.exclude, ['1000']);
  // 舊版紀錄沒有 pins／exclude → 匯入時補空陣列
  const old = JSON.parse(exportState(newState({ start: '2026-11-01' }))); delete old.state.pins; delete old.state.exclude;
  const o = parseImport(JSON.stringify(old)); assert.deepEqual(o.pins, []); assert.deepEqual(o.exclude, []);
  assert.throws(() => parseImport(JSON.stringify({ ...old, state: { ...old.state, pins: ['abc'] } })), /指定/);
}
console.log('s6uPick tests PASS');
