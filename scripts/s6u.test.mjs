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
  const ok = maxd < 1e-2 && !miss && !extra && sameTop;
  if (!ok) bad++;
  console.log(v.date, ok ? 'OK ' : 'FAIL', `n=${ek.length} 缺${miss} 多${extra} maxdiff=${maxd.toExponential(2)} 前30成員一致=${sameTop} 順序一致=${sameOrder}`);
}
if (bad) { console.error('FAILED', bad); process.exit(1); }
console.log('ALL PASS');
