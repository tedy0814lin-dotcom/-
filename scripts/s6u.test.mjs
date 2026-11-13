// 逐檔對照：JS 版 S6-U 分數 vs Python 回測分數（scripts/s6u_vectors.json，6 個月底）
import fs from 'node:fs';
import { s6uRank } from '../lib/s6u.js';
const V = JSON.parse(fs.readFileSync(new URL('./s6u_vectors.json', import.meta.url)));
let bad = 0;
for (const v of V) {
  const res = s6uRank(v.rows.map((r) => ({ ...r, name: r.code })));
  const got = Object.fromEntries(res.ranked.map((o) => [o.code, o.score]));
  const ek = Object.keys(v.expect);
  let maxd = 0, miss = 0;
  for (const c of ek) { if (!(c in got)) { miss++; continue; } maxd = Math.max(maxd, Math.abs(got[c] - v.expect[c])); }
  const extra = Object.keys(got).filter((c) => !(c in v.expect)).length;
  const top = res.ranked.slice(0, 30).map((o) => o.code);
  const sameOrder = JSON.stringify(top) === JSON.stringify(v.top30);
  const sameTop = [...top].sort().join() === [...v.top30].sort().join();
  // 容許：價格因子在「理論上同分」的檔（例如同時創 12 月新高 → 接近度=1）可能因浮點雜訊在 Python/JS 排出相差半個名次，
  // 最大分數差 <1e-2、前 30 名成員必須完全相同；多數月底應逐位相同。
  // 平衡版(M)、進攻版(H)：分數與前 30 名
  const chk = (key, sk, rk, top30) => {
    const g = Object.fromEntries(res.ranked.map((o) => [o.code, o[sk]])); let mx = 0;
    for (const c of Object.keys(v['expect' + key])) mx = Math.max(mx, Math.abs((g[c] ?? NaN) - v['expect' + key][c]) || 0);
    const t = res.ranked.slice().sort((a, b) => a[rk] - b[rk]).slice(0, 30).map((o) => o.code), same = [...t].sort().join() === [...top30].sort().join();
    console.log('   ' + key, `最大分數差=${mx.toExponential(2)} 前30成員一致=${same}`); return mx < 2e-2 && same; // 趨勢權重×2，同分檔的浮點雜訊差被放大，容許 <2e-2；前 30 名成員必須一致
  };
  const okM = chk('M', 'scoreM', 'rankM', v.top30M), okH = chk('H', 'scoreH', 'rankH', v.top30H);
  // EPS 近 3 個月成長百分位（平衡版用）：有值的檔數要一致、數值差 <1e-2
  const gE = Object.fromEntries(res.ranked.filter((o) => o.eg != null).map((o) => [o.code, o.eg])); let mxE = 0, missE = 0;
  for (const c of Object.keys(v.expectE)) { if (!(c in got)) continue; if (!(c in gE)) { missE++; continue; } mxE = Math.max(mxE, Math.abs(gE[c] - v.expectE[c])); }
  const extraE = Object.keys(gE).filter((c) => !(c in v.expectE)).length; const okE = mxE < 2e-2 && !missE && !extraE; // 個別股票近 3 個月有缺月時，還原價重建方式不同會差 1～4 個名次（<2e-2）
  console.log('   E', `最大差=${mxE.toExponential(2)} 缺${missE} 多${extraE}`);
  const ok = okM && okH && okE && maxd < 1e-2 && !miss && !extra && sameTop;
  if (!ok) bad++;
  console.log(v.date, ok ? 'OK ' : 'FAIL', `n=${ek.length} 缺${miss} 多${extra} maxdiff=${maxd.toExponential(2)} 前30成員一致=${sameTop} 順序一致=${sameOrder}`);
}
if (bad) { console.error('FAILED', bad); process.exit(1); }
console.log('ALL PASS');
