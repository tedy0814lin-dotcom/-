// 紀錄與計畫邏輯的單元測試（現金／持股推算、重算保留已打勾、匯出匯入、跟 0050 比較）
import assert from 'node:assert/strict';
import { newState, derive, makePlan, buildListInfo, benchCompare, exportState, parseImport, allTrades } from '../lib/s6uState.js';
const mk = (n, base = 100) => Array.from({ length: n }, (_, i) => ({ code: String(2000 + i), name: 'N' + i, close: base + i * 10, rank: i + 1 }));
const info = (list) => ({ kind: 'final', month: '2026-10', day: '2026-10-30', list });
let st = newState({ start: '2026-11-02', monthly: 10000, cash: 10000 });
let d = derive(st); assert.equal(d.cash, 10000); assert.equal(d.positions.length, 0);
// 第 1 個月：1 萬 → 3 檔每檔 3333 ≥ 3000 → 買 3 檔
let p = makePlan(st, '2026-11', info(mk(40))); assert.equal(p.N, 3); assert.equal(p.items.filter((x) => x.kind === 'buy').length, 3);
assert.equal(makePlan(newState({ start: '2026-11-02', cash: 4000 }), '2026-11', info(mk(40))).items.filter((x) => x.kind === 'buy').length, 0, '4000 元：每檔 1333 < 3000 先存現金');
st = newState({ start: '2026-11-02', monthly: 10000, cash: 10000 }); // 重置：接著測第 2 個月累積現金的情境
st.deposits['2026-11'] = 0; 
// 第 2 個月：資金 15 萬 → 5 檔，每檔 3 萬
st.deposits['2026-12'] = 150000; p = makePlan(st, '2026-12', info(mk(40))); const buys = p.items.filter((x) => x.kind === 'buy'); assert.equal(buys.length, 5);
assert.deepEqual(buys.map((b) => b.code), ['2000', '2001', '2002', '2003', '2004']);
st.plans['2026-12'] = p;
// 打勾 3 檔（實際價格略不同）→ 持股與現金
buys.slice(0, 3).forEach((b, i) => { b.done = true; b.fill = { price: b.price * 1.002, shares: b.shares, date: '2026-12-03' }; });
d = derive(st); assert.equal(d.positions.length, 3);
const spent = buys.slice(0, 3).reduce((a, b) => a + b.shares * b.price * 1.002 * 1.001425, 0);
assert.ok(Math.abs(d.cash - (150000 - spent)) < 1e-6, 'cash ' + d.cash);
// 重算：已打勾保留，其餘依新現金重算；不會重複買已持有的
const before = p.items.filter((x) => x.done).map((x) => x.id);
const p2 = makePlan(st, '2026-12', info(mk(40))); assert.deepEqual(p2.items.filter((x) => x.done).map((x) => x.id), before);
const codes = p2.items.filter((x) => x.kind === 'buy' && !x.done).map((x) => x.code);
assert.ok(!codes.some((c) => ['2000', '2001', '2002'].includes(c) && p2.items.find((x) => x.code === c && x.kind === 'buy' && !x.done && x.isNew)), '不重複新買已持有的');
// 名次掉出 → 標賣出
st.plans['2026-12'] = p2;
const list2 = mk(40).map((x) => (x.code === '2001' ? { ...x, rank: 30 } : x)); const p3 = makePlan(st, '2027-01', info(list2));
assert.ok(p3.items.some((x) => x.kind === 'sell' && x.code === '2001'), '名次 30 > 2N 要賣');
// 賣出打勾後現金增加、持股移除
st.plans['2027-01'] = p3; const sell = p3.items.find((x) => x.kind === 'sell'); const c0 = derive(st).cash; sell.done = true; sell.fill = { price: sell.price, shares: sell.shares, date: '2027-01-05' };
d = derive(st); assert.ok(d.cash > c0); assert.ok(!d.positions.some((x) => x.code === '2001'));
assert.ok(Math.abs(d.realized - (sell.shares * sell.price * (1 - 0.004425) - sell.shares * (buys[1].price * 1.002 * 1.001425))) < 1e-6);
// 手動買賣
st.manual.push({ id: 'm1', type: 'buy', code: '2603', name: '長榮', shares: 10, price: 200, date: '2026-01-05' }); assert.ok(derive(st).positions.some((x) => x.code === '2603'));
assert.equal(allTrades(st)[0].id, 'm1');
// 匯出匯入來回
const back = parseImport(exportState(st)); assert.deepEqual(back, JSON.parse(JSON.stringify(st)));
assert.throws(() => parseImport('{"x":1}')); assert.throws(() => parseImport('not json'));
const bad = JSON.parse(exportState(st)); bad.state.plans['2026-12'].items[0].fill = { price: 0, shares: 0 }; assert.throws(() => parseImport(JSON.stringify(bad)), /成交價/);
// 0050 比較
const bench = [['2026-11-02', 100], ['2026-12-01', 110], ['2027-01-04', 120]];
const cmp = benchCompare({ start: '2026-11-02', deposits: { '2026-11': 10000, '2026-12': 10000 } }, bench, 22000);
assert.ok(Math.abs(cmp.bench - (100 + 10000 / 110) * 120) < 1e-6 || Math.abs(cmp.bench - (10000 / 100 + 10000 / 110) * 120) < 1e-6);
assert.ok(Math.abs(cmp.mineRet - 0.1) < 1e-9);
// buildListInfo：正式名單取月底名次，價格取最新
const data = { month: '2026-11', asof: '2026-11-12', list: [{ code: '2000', name: 'N0', close: 111, rank: 3 }], months: [{ month: '2026-10', day: '2026-10-30', official: true, top: [['2000', 'N0', 100, 1]] }], finalMonth: '2026-10' };
const li = buildListInfo(data, 'final'); assert.equal(li.list[0].rank, 1); assert.equal(li.list[0].close, 111);
assert.equal(buildListInfo(data, 'preview').list[0].rank, 3);
const d2 = { ...data, list: [...data.list, { code: '2330', name: 'TSMC', close: 2340, rank: 120 }] }; const l2 = buildListInfo(d2, 'final').list.find((x) => x.code === '2330'); assert.equal(l2.rank, 999); assert.equal(l2.close, 2340);
console.log('s6uState tests PASS');
// 新投入／領出：累計投入與現金一起變，損益以投入為基準
{
  const s2 = newState({ start: '2026-11-02', monthly: 10000, cash: 10000 });
  s2.deposits['2026-11'] += 10000; s2.flows.push({ date: '2026-11-20', amount: 10000 });
  const dv = derive(s2); assert.equal(dv.cash, 20000); assert.equal(dv.invested, 20000);
  s2.manual.push({ id: 'b', type: 'buy', code: '2603', name: 'x', shares: 10, price: 250, date: '2026-11-21' }); s2.manual.push({ id: 's', type: 'sell', code: '2603', name: 'x', shares: 10, price: 300, date: '2026-11-25' });
  const d3 = derive(s2); assert.ok(Math.abs(d3.realized - (3000 * (1 - 0.004425) - 2500 * 1.001425)) < 1e-6, '已實現損益以你填的買賣價為準');
  assert.equal(parseImport(exportState(s2)).flows.length, 2);
}
console.log('flows tests PASS');
{ // 進攻版名單：預覽用 rankR、月底用 topR；rotOk=false 時不提供
  const dd = { month: '2026-11', asof: '2026-11-12', rotOk: true, eOk: true, list: [{ code: '2000', name: 'A', close: 10, rank: 1, rankM: 5, ind: '金融保險' }, { code: '2001', name: 'B', close: 20, rank: 2, rankM: 1, ind: '航運' }], months: [{ month: '2026-10', day: '2026-10-30', top: [['2000', 'A', 9, 1]], topM: [['2001', 'B', 19, 1]] }], finalMonth: '2026-10' };
  assert.equal(buildListInfo(dd, 'preview', 'R').list.find((x) => x.code === '2001').rank, 1);
  const f = buildListInfo(dd, 'final', 'R'); assert.equal(f.list[0].code, '2001'); assert.equal(f.list.find((x) => x.code === '2000').rank, 999); assert.equal(f.list[0].ind, '航運');
  assert.equal(buildListInfo({ ...dd, eOk: false }, 'preview', 'R'), null); assert.equal(buildListInfo({ ...dd, eOk: undefined }, 'preview', 'R'), null); assert.ok(buildListInfo({ ...dd, rotOk: false }, 'preview', 'R')); // 平衡版只需要 EPS 成長資料，不需要產業別
  console.log('rotation list tests PASS');
}
