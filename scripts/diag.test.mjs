// 診斷特徵回歸測試：JS（lib/diagTw.js）對 Python 回測寫法（pk/wk3.py）逐檔、逐欄位比對。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { features, crossSection, pctRank, percentile } from '../lib/diagTw.js';
const V = JSON.parse(fs.readFileSync(new URL('./diag_vectors.json', import.meta.url)));
const near = (a, b, tol = 2e-6) => (a == null && !Number.isFinite(b)) || (a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a)));
let cmp = 0, flagCmp = 0;
for (const D of V.dates) {
  const feats = D.rows.map((r) => ({ ...features(r.c), v: r.v }));
  const cs = crossSection(feats);
  assert.ok(near(D.q.mom20, cs.q.mom20) && near(D.q.t20, cs.q.t20) && near(D.q.t80, cs.q.t80), `${D.date} 分位數`);
  D.rows.forEach((r, i) => {
    const e = r.exp, f = feats[i], g = cs.rows[i];
    for (const k of ['ma200', 'hi250', 'mom', 'near', 'lvl']) { assert.ok(near(e[k], f[k]), `${D.date} ${r.code} ${k}: py ${e[k]} js ${f[k]}`); cmp++; }
    assert.equal(g.valid, e.valid, `${D.date} ${r.code} valid`); assert.equal(g.ok, e.ok, `${D.date} ${r.code} ok`);
    assert.ok(near(e.tScore, g.tScore) && near(e.tPct, g.tPct), `${D.date} ${r.code} tScore/tPct`);
    for (const k of ['A', 'B', 'C', 'D', 'S']) { assert.equal(g[k], e[k], `${D.date} ${r.code} 旗標 ${k}`); flagCmp++; }
  });
}
// 邊界：歷史不足、缺值、全空、單檔
const cl = (n, f) => Array.from({ length: n }, (_, i) => f(i));
let f = features(cl(100, (i) => 10 + i * 0.1)); assert.ok(Number.isNaN(f.ma200) && Number.isNaN(f.hi250) && Number.isNaN(f.mom), '不足 190 根：ma200／hi250／mom 無值');
f = features(cl(300, (i) => 10 + i * 0.1)); assert.ok(Number.isFinite(f.ma200) && Number.isFinite(f.hi250) && Number.isFinite(f.mom) && f.near === 1, '300 根上升：near=1');
f = features([]); assert.ok(Number.isNaN(f.c) && Number.isNaN(f.mom));
f = features(cl(300, (i) => (i === 299 ? null : 10 + i * 0.1))); assert.ok(Number.isNaN(f.c) && Number.isNaN(f.near), '最新一根缺值');
let one = crossSection([{ c: 20, v: 100, ma200: 19, hi250: 25, mom: 0.1, near: 0.8, lvl: 0.05 }]); assert.equal(one.nOk, 1); assert.equal(one.rows[0].tPct, 1);
one = crossSection([{ c: 9.9, v: 100, ma200: 12, hi250: 15, mom: -0.2, near: 0.6, lvl: -0.1 }]); assert.equal(one.rows[0].valid, false); assert.equal(one.rows[0].A, false, '價格 <10 不在母體，不給旗標');
one = crossSection([{ c: 20, v: 0, ma200: 25, hi250: 30, mom: -0.2, near: 0.6, lvl: -0.1 }]); assert.equal(one.rows[0].valid, false, '當日無成交量');
assert.deepEqual(pctRank([3, 1, 2, 2], [true, true, true, true]), [1, 0.25, 0.625, 0.625]);
assert.equal(percentile([1, 2, 3, 4], 20), 1.6);
console.log('diag.test.mjs OK：特徵欄位', cmp, '項、旗標', flagCmp, '項逐檔相同（4 個日期、約 270 檔/日）＋邊界案例');
