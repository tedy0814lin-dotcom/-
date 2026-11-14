// 營收加速度與排除濾網：對照 Python（revlib.py）的 5 個月底（2012-12 ～ 2026-10，上市前 300 母體）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { revAcc, ymIdx, mergeRev, trimRev, idxYm } from '../lib/s6uRev.js';
import { revFlags, s6uRank } from '../lib/s6u.js';
const V = JSON.parse(fs.readFileSync(new URL('./s6uRev_vectors.json', import.meta.url)));
for (const v of V) {
  const L = ymIdx(v.L);
  const racc = v.codes.map((c) => revAcc(v.hist[c], L));
  let maxd = 0, nv = 0;
  v.codes.forEach((c, i) => { const e = v.acc[c], g = racc[i]; if (e == null) assert.ok(!Number.isFinite(g), `${v.date} ${c} 應無值，得 ${g}`); else { assert.ok(Number.isFinite(g), `${v.date} ${c} 應有值 ${e}`); maxd = Math.max(maxd, Math.abs(g - e)); nv++; } });
  assert.ok(maxd < 1e-5, `${v.date} 加速度最大誤差 ${maxd}`);
  const fl = revFlags(racc, v.codes.map(() => true)), got = v.codes.filter((c, i) => fl[i]).sort(), exp = [...v.excl].sort();
  assert.deepEqual(got, exp, `${v.date} 排除名單不同`);
  console.log(`${v.date} 有值 ${nv}/${v.codes.length}，最大誤差 ${maxd.toExponential(1)}，排除 ${got.length} 檔 一致`);
}
// 合併歷史：openapi 一筆同時補當月、上月、去年當月
{ const h = {}; mergeRev(h, '2330', ymIdx(202610), 586890319, 511857399, 367473051); assert.deepEqual(h['2330'], { 202610: 586890319, 202609: 511857399, 202510: 367473051 }); trimRev(h, ymIdx(202610), 6); assert.deepEqual(Object.keys(h['2330']).sort(), ['202609', '202610']); assert.equal(idxYm(ymIdx(202601)), 202601); }
// 缺一個月 → 無值；分母 0 → 無值
{ const h = {}; for (let i = 0; i < 18; i++) h[idxYm(ymIdx(202610) - i)] = 100 + i; assert.ok(Number.isFinite(revAcc(h, ymIdx(202610)))); delete h[202607]; assert.ok(!Number.isFinite(revAcc(h, ymIdx(202610)))); const z = { ...h }; z[202607] = 100; for (let i = 12; i < 15; i++) z[idxYm(ymIdx(202610) - i)] = 0; assert.ok(!Number.isFinite(revAcc(z, ymIdx(202610)))); }
// s6uRank：被排除者 rankM＝null，其餘名次連續；沒有 racc 時全部有名次
{
  const rows = Array.from({ length: 400 }, (_, i) => ({ code: String(1000 + i), name: 'x' + i, close: 50 + i % 7, amt: 1e9 - i * 1e6, pe: 10 + (i % 17), pb: 1 + (i % 9) / 3, dy: (i % 6), pe3: 12 + (i % 11), hist: Array.from({ length: 13 }, (_, j) => 100 * (1 + 0.01 * ((i * 7 + j * 3) % 11)) ** j), racc: ((i * 37) % 400) / 100 - 2 }));
  const r1 = s6uRank(rows); const ex = r1.ranked.filter((o) => o.rx), kept = r1.ranked.filter((o) => !o.rx);
  assert.ok(ex.length >= 25 && ex.length <= 31, '排除比例約 10%：' + ex.length);
  assert.ok(ex.every((o) => o.rankM == null) && kept.every((o) => o.rankM != null));
  assert.deepEqual(kept.map((o) => o.rankM).sort((a, b) => a - b), kept.map((_, i) => i + 1));
  const r0 = s6uRank(rows.map((r) => ({ ...r, racc: undefined })));
  assert.ok(r0.ranked.every((o) => o.rankM != null && !o.rx));
  // 保守版名次（rank）不受影響
  assert.deepEqual(r1.ranked.map((o) => o.code), r0.ranked.map((o) => o.code));
}
console.log('營收加速度濾網測試 PASS');
