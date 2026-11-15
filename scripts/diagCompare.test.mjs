// 持股 vs 三因子平衡名單對照測試：用合成名單驗證狀態判斷、與 planMonth 一致、因子輪廓與候選排序。
import assert from 'node:assert/strict';
import { compareHoldings, GAP_WEAK } from '../lib/diagCompare.js';
import { planMonth, PLAN_DEFAULTS } from '../lib/s6uPlan.js';
let n = 0; const t = (f) => { f(); n++; };
// 40 檔名單：名次 i，價值／低波動／趨勢 隨名次遞減；第 7 檔最新資料已被濾網排除（rankM null）
const mk = (i) => ({ code: String(1000 + i), name: 'S' + i, close: 100, rank: i, rankM: i === 7 ? null : i, value: 1 - i / 50, lowvol: 0.9 - i / 60, trend: 0.8 - i / 70, score: 1 - i / 40, ind: i % 2 ? '金融' : '電子' });
const list = Array.from({ length: 40 }, (_, i) => mk(i + 1));
const data = { asof: '2026-11-13', month: '2026-11', finalMonth: '2026-10', eOk: true, rOk: true, list, months: [{ month: '2026-10', day: '2026-10-30', topM: list.map((x) => [x.code, x.name, x.close, x.rank]) }] };
const H = (code, shares = 100, px = 100) => ({ code, shares, px });
// 資金 15×3 萬 → N=15、lim=30
const big = [H('1001', 3000), H('1020', 3000), H('1035', 3000), H('9999', 3000)];   // 名次 1（核心）、20（緩衝）、35（會賣）、母體外
t(() => { const r = compareHoldings({ data, holds: big, cash: 0 }); const m = Object.fromEntries(r.rows.map((x) => [x.code, x.status])); assert.equal(m['1001'], 'core'); assert.equal(m['1020'], r.N >= 20 ? 'core' : 'buffer'); assert.equal(m['1035'], r.lim >= 35 ? 'buffer' : 'sell'); assert.equal(m['9999'], 'outside'); });
t(() => { const r = compareHoldings({ data, holds: big, cash: 0 }); const direct = planMonth({ list: list.map((x) => ({ code: x.code, name: x.name, close: x.close, rank: x.rank })), holdings: big, cash: 0, params: { ...PLAN_DEFAULTS, nMax: 15 } }); assert.deepEqual(r.plan.sells.map((s) => s.code), direct.sells.map((s) => s.code)); assert.equal(r.N, direct.N); assert.equal(r.lim, direct.lim); }); // 與策略頁計畫一致
t(() => { const r = compareHoldings({ data, holds: [H('1040', 1000)], cash: 0 }); assert.equal(r.rows[0].status, 'sell'); assert.ok(r.plan.sells.some((s) => s.code === '1040')); }); // 名次 40 > lim
t(() => { const r = compareHoldings({ data, holds: [H('9999', 1000)], cash: 0 }); assert.equal(r.rows[0].status, 'outside'); assert.equal(r.coverage, 0); assert.equal(r.profile[0].port, null); });
t(() => { const r = compareHoldings({ data, holds: [H('1007', 1000), H('1001', 1000)], cash: 0 }); const x = r.rows.find((y) => y.code === '1007'); assert.equal(x.filteredNow, true); assert.equal(x.liveRank, null); }); // 最新濾網標記
t(() => { const r = compareHoldings({ data, holds: [H('1030', 5000), H('1031', 5000)], cash: 0 }); const p = r.profile; assert.ok(p.every((x) => x.verdict === 'weak')); assert.ok(r.weakest); assert.ok(r.cands.length > 0 && r.cands.every((c) => c.rank <= r.N)); for (let i = 1; i < r.cands.length; i++) assert.ok(r.cands[i - 1][r.weakest.k] >= r.cands[i][r.weakest.k]); }); // 偏弱時候選依最弱因子排序
t(() => { const r = compareHoldings({ data, holds: [H('1001', 1000), H('1002', 1000), H('1003', 1000)], cash: 0 }); assert.ok(r.profile.every((x) => x.verdict !== 'weak')); assert.ok(r.cands.every((c) => !['1001', '1002', '1003'].includes(c.code))); }); // 候選不含已持有
t(() => { const r = compareHoldings({ data, holds: [H('1001', 100)], cash: 0 }); assert.ok(r.cands.every((c) => c.code !== '1001')); });
t(() => assert.ok(compareHoldings({ data: { ...data, eOk: false }, holds: [H('1001')] }).error)); // 輔助資料不足就不比較
t(() => assert.ok(compareHoldings({ data: null, holds: [H('1001')] }).error));
t(() => { const r = compareHoldings({ data, holds: [H('1001', 1000)], cash: 500000 }); assert.equal(r.V, 100000 + 500000); assert.ok(r.plan.buys.length > 0 && r.plan.buys.every((b) => b.shares > 0)); }); // 有現金才會有買進
t(() => { const r = compareHoldings({ data, holds: [H('1001', 1000)], cash: -5 }); assert.equal(r.cash, 0); });
t(() => assert.ok(GAP_WEAK === 0.1));
// 市值加權：名次 1（因子高）只放 1 股、名次 30（因子低）放 10 萬股 → 組合因子應該幾乎等於名次 30 的因子，且市值與價值因子不混淆
t(() => { const r = compareHoldings({ data, holds: [H('1001', 1), H('1030', 100000)], cash: 0 }); const a = list[0], b = list[29]; assert.ok(Math.abs(r.profile[0].port - b.value) < 1e-3); assert.ok(Math.abs(r.profile[1].port - b.lowvol) < 1e-3); const x = r.rows.find((y) => y.code === '1030'); assert.equal(x.mv, 100000 * 100); assert.equal(x.value, b.value); assert.ok(Math.abs(r.coverage - 1) < 1e-12); });
// 覆蓋率：名單外持股市值計入分母
t(() => { const r = compareHoldings({ data, holds: [H('1001', 100), H('9999', 100)], cash: 0 }); assert.ok(Math.abs(r.coverage - 0.5) < 1e-12); });
console.log('diagCompare OK', n);
