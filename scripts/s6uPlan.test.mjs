// 對照：lib/s6uPlan.js（網站用）vs Python 回測 dca_real.sim 的單月決策（400 個隨機情境：名單名次、持股、現金、不在名單的持股）
import fs from 'node:fs';
import { planMonth } from '../lib/s6uPlan.js';
const V = JSON.parse(fs.readFileSync(new URL('./s6uPlan_vectors.json', import.meta.url)));
let bad = 0, maxd = 0;
V.forEach((v, i) => {
  const r = planMonth({ list: v.list, holdings: v.holdings, cash: v.cash, integer: false });
  const sells = r.sells.map((s) => s.code).sort();
  const buys = Object.fromEntries(r.buys.filter((b) => b.status === 'buy').map((b) => [b.code, b.amount]));
  const e = v.expect; let ok = r.N === e.N && r.lim === e.lim && JSON.stringify(sells) === JSON.stringify(e.sells);
  const ks = new Set([...Object.keys(buys), ...Object.keys(e.buys)]);
  for (const k of ks) { const d = Math.abs((buys[k] || 0) - (e.buys[k] || 0)); maxd = Math.max(maxd, d); if (d > 1e-6) ok = false; }
  if (Math.abs(r.cashAfter - e.cashAfter) > 1e-6) ok = false;
  if (!ok) { bad++; if (bad <= 3) console.log('FAIL case', i, { N: [r.N, e.N], lim: [r.lim, e.lim], sells, esells: e.sells, buys, ebuys: e.buys, cash: [r.cashAfter, e.cashAfter] }); }
});
console.log(`對照 ${V.length} 個情境：不一致 ${bad}，買進金額最大差 ${maxd.toExponential(2)} 元`);
// 實務情境：1 萬元起步
const list = Array.from({ length: 40 }, (_, i) => ({ code: String(2000 + i), name: 'S' + i, close: 50 + i * 7, rank: i + 1 }));
const m1 = planMonth({ list, holdings: [], cash: 10000 });
console.log('第1個月 1萬：N=', m1.N, '目標/檔', Math.round(m1.target), '買進', m1.buys.filter((b) => b.status === 'buy').length, '檔（預期 3）');
const m2 = planMonth({ list, holdings: [], cash: 20000 }); const m0 = planMonth({ list, holdings: [], cash: 4000 });
console.log('第2個月 現金2萬：買進', m2.buys.filter((b) => b.status === 'buy').map((b) => `${b.code}×${b.shares}股=${Math.round(b.amount)}`).join(' '), '剩餘現金', Math.round(m2.cashAfter));
if (bad || m1.buys.filter((b) => b.status === 'buy').length !== 3 || m2.buys.filter((b) => b.status === 'buy').length !== 5 || m0.buys.some((b) => b.status === 'buy')) { console.error('FAILED'); process.exit(1); }
console.log('ALL PASS');
