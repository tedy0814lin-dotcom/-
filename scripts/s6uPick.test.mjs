// 三版本設定、「指定／排除」功能的測試
import assert from 'node:assert/strict';
import { planMonth, applyExclude } from '../lib/s6uPlan.js';
import { TIERS, buildListInfo, newState, makePlan, parseImport, exportState, planArgs, planTier, derive, LEV } from '../lib/s6uState.js';

const mk = (n) => Array.from({ length: n }, (_, i) => ({ code: String(1000 + i), name: 'S' + i, close: 50 + i, rank: i + 1, ind: i % 2 ? '金融保險' : '半導體' }));
const L = mk(40);
// ---- 三版本最大檔數 ----
assert.deepEqual(['base', 'R', 'A'].map((k) => TIERS[k].nMax), [15, 15, 15]);
for (const [ver, exp] of [['base', 15], ['R', 15], ['A', 15]]) {
  const st = newState({ start: '2026-11-01', monthly: 100000, cash: 1000000 }); st.ver = ver;
  const r = planMonth({ list: L, holdings: [], cash: 1000000, ...planArgs(st, ver) });
  assert.equal(r.N, exp, 'nMax ' + ver); assert.equal(r.buys.filter((b) => b.status === 'buy').length, exp);
}
// 小資金：三版本檔數規則相同（每檔至少 3,000 元，最多 15 檔：1 萬→3 檔、3 萬→10 檔、4.5 萬以上→15 檔）
for (const [c, n] of [[10000, 3], [30000, 10], [45000, 15], [60000, 15]]) { const r = planMonth({ list: L, holdings: [], cash: c, ...planArgs(newState({ start: '2026-11-01' }), 'A') }); assert.equal(r.N, n, 'cash ' + c); }

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
  const data = { rotOk: true, eOk: true, lev: { code: '00631L', close: 200 }, month: '2026-11', asof: '2026-11-12', finalMonth: '2026-10',
    list: [{ code: '1000', name: 'A', close: 10, rank: 1, rankM: 2, rankH: 3 }, { code: '1001', name: 'B', close: 11, rank: 2, rankM: 1, rankH: 1 }, { code: '1002', name: 'C', close: 12, rank: 3, rankM: 3, rankH: 2 }],
    months: [{ month: '2026-10', day: '2026-10-30', top: [['1000', 'x', 9, 1]], topM: [['1001', 'x', 9, 1]], topH: [['1002', 'x', 9, 1]] }] };
  assert.equal(buildListInfo(data, 'preview', 'A').list.sort((a, b) => a.rank - b.rank)[0].code, '1001');
  assert.equal(buildListInfo(data, 'preview', 'R').list.sort((a, b) => a.rank - b.rank)[0].code, '1001');
  assert.equal(buildListInfo(data, 'preview', 'base').list.sort((a, b) => a.rank - b.rank)[0].code, '1000');
  // 進攻版（2026-11-14 起）＝平衡版名單＋正2：用 rankM／topM，需要 EPS 資料與正2 收盤價
  const f = buildListInfo(data, 'final', 'A'); assert.equal(f.list[0].code, '1001'); assert.equal(f.list[0].name, 'B'); assert.equal(f.list[0].close, 11); assert.equal(f.levPrice, 200);
  assert.equal(f.list.find((x) => x.code === '1000').rank, 999);
  assert.equal(buildListInfo({ ...data, eOk: false }, 'preview', 'A'), null);
  assert.equal(buildListInfo({ ...data, lev: null }, 'preview', 'A'), null); assert.ok(buildListInfo({ ...data, lev: null }, 'preview', 'R'));
  assert.ok(buildListInfo({ ...data, rotOk: false }, 'preview', 'A'));
  assert.equal(buildListInfo({ ...data, months: [{ ...data.months[0], topM: undefined }] }, 'final', 'A'), null);
  assert.ok(buildListInfo({ ...data, rotOk: false }, 'preview', 'base'));
}
// ---- makePlan 使用該版本的檔數與指定／排除；匯出匯入保留 ----
{
  const st = newState({ start: '2026-11-01', monthly: 100000, cash: 1000000 }); st.ver = 'A'; st.pins = ['1030']; st.exclude = ['1000'];
  const info = { kind: 'preview', ver: 'A', month: '2026-11', day: '2026-11-12', list: L };
  const pl = makePlan(st, '2026-11', info, '2026-11-12');
  assert.equal(pl.ver, 'A'); assert.equal(pl.N, 15);
  const buys = pl.items.filter((x) => x.kind === 'buy'); assert.equal(buys.length, 15); assert.equal(buys[0].code, '1030'); assert.equal(buys[0].pinned, true);
  assert.ok(!buys.some((x) => x.code === '1000'));
  const back = parseImport(exportState(st)); assert.deepEqual(back.pins, ['1030']); assert.deepEqual(back.exclude, ['1000']);
  // 舊版紀錄沒有 pins／exclude → 匯入時補空陣列
  const old = JSON.parse(exportState(newState({ start: '2026-11-01' }))); delete old.state.pins; delete old.state.exclude;
  const o = parseImport(JSON.stringify(old)); assert.deepEqual(o.pins, []); assert.deepEqual(o.exclude, []);
  assert.throws(() => parseImport(JSON.stringify({ ...old, state: { ...old.state, pins: ['abc'] } })), /指定/);
}
// ---- 進攻版：平衡名單 60%＋正2 40% ----
{
  const st0 = newState({ start: '2026-11-01', monthly: 10000, cash: 10000 }); st0.ver = 'A';
  // 第一個月 1 萬：正2 缺口 4000、個股缺口 6000 → 買約 4000 元正2，其餘排個股
  const r1 = planTier({ list: L, holdings: [], cash: 10000, st: st0, ver: 'A', levPrice: 200 });
  assert.equal(r1.lev.buy.shares, Math.floor(4000 / (200 * 1.001425))); assert.ok(!r1.lev.sell);
  assert.ok(Math.abs(r1.V - (10000 - r1.lev.buy.amount)) < 1e-6);   // 個股部分只拿到剩下的錢
  // 其他版本不碰正2
  assert.equal(planTier({ list: L, holdings: [], cash: 10000, st: st0, ver: 'R', levPrice: 200 }).lev, null);
  // 已在目標附近（40%±5%）→ 不買不賣；正2 不會被當成「不在名單」賣掉
  const c1000 = L.find((x) => x.code === '1000').close; const hold = [{ code: LEV.code, shares: 200, px: 200 }, { code: '1000', shares: 60000 / c1000, px: c1000 }];   // 正2 40000、個股 60000
  const r2 = planTier({ list: L, holdings: hold, cash: 0, st: st0, ver: 'A', levPrice: 200 });
  assert.ok(!r2.lev.buy && !r2.lev.sell); assert.ok(!r2.sells.some((x) => x.code === LEV.code));
  // 正2 大漲後占比 >45% → 賣回 40%
  const r3 = planTier({ list: L, holdings: hold, cash: 0, st: st0, ver: 'A', levPrice: 300 });   // 正2 60000／總 120000＝50%
  assert.equal(r3.lev.sell.shares, Math.floor((60000 - 48000) / 300)); assert.ok(r3.lev.sell.reason.includes('50%'));
  // 正2 占比偏低（<40%）但沒有新資金 → 不賣個股來補；有新資金時優先補正2
  const r4 = planTier({ list: L, holdings: hold, cash: 0, st: st0, ver: 'A', levPrice: 150 }); assert.ok(!r4.lev.buy && !r4.lev.sell);
  const r5 = planTier({ list: L, holdings: hold, cash: 10000, st: st0, ver: 'A', levPrice: 150 });   // 總 100000：正2 30000→目標 40000；個股 60000＝目標 → 現金全補正2
  assert.equal(r5.lev.buy.shares, Math.floor(10000 / (150 * 1.001425)));
  // makePlan：計畫裡有正2 的買進項目，打勾後算進持股，下個月以它的市值計算
  const info = { kind: 'preview', ver: 'A', month: '2026-11', day: '2026-11-12', list: L, levPrice: 200 };
  const pl = makePlan(st0, '2026-11', info, '2026-11-12'); const li = pl.items.find((x) => x.code === LEV.code);
  assert.ok(li && li.kind === 'buy' && li.lev && pl.lev.w === 0.4);
  li.done = true; li.fill = { price: 200, shares: li.shares, date: '2026-11-12' }; st0.plans['2026-11'] = pl;
  assert.equal(derive(st0).positions.find((p) => p.code === LEV.code).shares, li.shares);
  // 換回平衡版：正2 變成「不在名單」的持股 → 標賣出
  const rb = planTier({ list: L, holdings: [{ code: LEV.code, shares: 10, px: 200 }], cash: 50000, st: st0, ver: 'R', levPrice: 200 });
  assert.ok(rb.sells.some((x) => x.code === LEV.code));
}
console.log('s6uPick tests PASS');
