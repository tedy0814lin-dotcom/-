// CRT 引擎測試：①結構（止損／目標方向、盈虧比）②不偷看未來（延長資料後，已出現的進場不變）③太短資料回 null
import assert from 'node:assert/strict';
import { crt, CRT_CFG } from '../lib/crt.js';

let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function walk(n, step = 300e3) { // 帶波動叢集的隨機漫步（5 分 K）
  const out = []; let p = 100, vol = 0.002, t = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    if (i % 200 === 0) vol = 0.0008 + rnd() * 0.004;
    const o = p, c = o * (1 + (rnd() - 0.5) * 2 * vol), h = Math.max(o, c) * (1 + rnd() * vol * 0.6), l = Math.min(o, c) * (1 - rnd() * vol * 0.6);
    out.push({ t, o, h, l, c, v: 100 + rnd() * 900 }); p = c; t += step;
  }
  return out;
}

const LOOSE = { ...CRT_CFG.crypto1h, minRR: 0.2, maxSt: 50, swN: 1, tolMul: 1 };
assert.equal(crt(walk(100), CRT_CFG.crypto1h), null, '資料太短回 null');

let seen = 0, withNow = 0, entries = 0;
const first = new Map(); // 事件 → 第一次看到時的內容
for (const [s, N] of [[1, 3200], [2, 3200], [3, 3200]]) {
  seed = s * 101; const bars = walk(N);
  for (let k = 1500; k <= N; k += 24) {
    const r = crt(bars.slice(0, k), LOOSE); seen++;
    if (!r) continue;
    for (const e of r.recent) {
      assert.ok(e.entry > 0 && e.sl > 0 && e.t1 > 0 && e.t2 > 0);
      if (e.dir === 1) assert.ok(e.sl < e.entry && e.t1 > e.entry && e.t2 >= e.t1, '做多：止損在下、目標在上');
      else assert.ok(e.sl > e.entry && e.t1 < e.entry && e.t2 <= e.t1, '做空：止損在上、目標在下');
      const key = `${s}|${e.mode}|${e.t}`;
      if (!first.has(key)) { first.set(key, { entry: e.entry, sl: e.sl, t1: e.t1, t2: e.t2, dir: e.dir }); entries++; }
      else assert.deepEqual({ entry: e.entry, sl: e.sl, t1: e.t1, t2: e.t2, dir: e.dir }, first.get(key), `事件 ${key} 隨資料延長而改變 → 偷看未來`);
    }
    if (r.now) {
      withNow++;
      const n = r.now;
      assert.ok(['entry', 'ready', 'mss', 'tbs', 'swept', 'blocked'].includes(n.status));
      assert.ok(n.rH > n.rL, 'CRH > CRL');
      if (r.chart) assert.equal(r.chart.bars.length, r.chart.t.length);
      if (n.trade) assert.ok(n.trade.i >= 0 && n.trade.i < r.chart.bars.length, '進場索引在圖內');
    }
  }
}
assert.ok(withNow > 0 && entries > 0, '隨機資料裡至少要出現過狀態與進場，不然測試沒意義');
console.log(`crt 測試通過：${seen} 個視窗、${withNow} 次有狀態、${entries} 個獨立進場事件`);
