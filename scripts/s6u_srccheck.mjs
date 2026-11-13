// 資料源對照：同一天(2026-10-30)的證交所欄位（用 Python 回測面板那份）＋「Yahoo 還原價取月底」算出的名單，跟 Python 回測名單比。
// 目的：確認網站每天用 Yahoo 還原價算出的名單，跟回測用的「證交所月底收盤＋除權息還原」名單一致到什麼程度。
import fs from 'node:fs';
import { s6uRank, universeMask } from '../lib/s6u.js';
const V = JSON.parse(fs.readFileSync(new URL('./s6u_vectors.json', import.meta.url))).find((v) => v.date === (process.argv[2] || '2026-10-30'));
const asof = V.date, UA = { 'User-Agent': 'Mozilla/5.0 (whale-radar)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tp = (s) => new Date(s * 1000 + 8 * 3600e3).toISOString().slice(0, 10);
async function yahoo(sym) {
  for (const h of ['query1', 'query2', 'query1', 'query2']) {
    try { const r = await fetch(`https://${h}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=${process.env.RANGE||"5y"}&events=div`, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { await sleep(800); continue; }
      const x = (await r.json()).chart.result?.[0]; if (!x?.timestamp) return null;
      const a = x.indicators.adjclose?.[0]?.adjclose || x.indicators.quote[0].close; return x.timestamp.map((t, i) => [tp(t), a[i]]).filter((z) => z[1] != null);
    } catch { await sleep(800); }
  }
  return null;
}
const b50 = await yahoo('0050.TW'); const lom = {}; for (const [d] of b50) lom[d.slice(0, 7)] = d;
const ym = asof.slice(0, 7), ms = Object.keys(lom).sort().filter((m) => m < ym).slice(-12);
const anchors = [...ms.map((m) => lom[m]), asof]; console.log('月底日', anchors.join(' '));
const rows = V.rows.map((r) => ({ ...r, name: r.code, hist: null })); const mask = universeMask(rows); const cand = rows.filter((_, i) => mask[i]);
console.log('母體候選', cand.length, '（回測母體合格', Object.keys(V.expect).length, '）');
let i = 0, miss = 0; await Promise.all(Array.from({ length: 6 }, async () => { while (i < cand.length) { const r = cand[i++]; const s = await yahoo(r.code + '.TW'); if (!s) { miss++; continue; } const m = new Map(s); r.hist = anchors.map((d) => m.get(d) ?? null); } }));
const res = s6uRank(rows); const top = res.ranked.slice(0, 30).map((o) => o.code), py = V.top30;
const inter = top.filter((c) => py.includes(c));
const sc = Object.fromEntries(res.ranked.map((o) => [o.code, o.score]));
const common = Object.keys(V.expect).filter((c) => c in sc);
const rk = (o) => { const e = Object.entries(o).sort((a, b) => b[1] - a[1]); return Object.fromEntries(e.map(([c], k) => [c, k + 1])); };
const ra = rk(Object.fromEntries(common.map((c) => [c, sc[c]]))), rb = rk(Object.fromEntries(common.map((c) => [c, V.expect[c]])));
const n = common.length; let d2 = 0; for (const c of common) d2 += (ra[c] - rb[c]) ** 2; const rho = 1 - 6 * d2 / (n * (n * n - 1));
console.log(`Yahoo 沒抓到 ${miss} 檔；合格 JS ${res.universe} / 回測 ${Object.keys(V.expect).length}；前30名重疊 ${inter.length}/30；全體名次 Spearman ${rho.toFixed(4)}`);
console.log('只在網站名單：', top.filter((c) => !py.includes(c)).join(' '), '| 只在回測名單：', py.filter((c) => !top.includes(c)).join(' '));
