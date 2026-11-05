// 策略實盤記錄的結算重播（給 /api/log?strat=1 用）
// 記錄只存「訊號」（策略、代號、訊號 K 棒時間、當時的停損），結果由這裡用實際 K 線依回測規則重播算出，
// 所以不會事後改參數：同一份規則、同一份扣費。
//   cs 大陽線突破（加密日線）：隔天開盤進、停損=訊號 K 最低、追蹤停損 7×ATR（BTC 跌破 50 日線改 2.5×），不設目標。每邊費用 0.1%。
//   fp Delta 階梯（加密 4H 多空）：下一根開盤進、記錄的型態高低點停損、4R 目標、最長 120 根；同根碰到停損與目標算停損。每邊費用 0.1%。
//   pk 大單推升（台股上櫃）：隔天開盤買（跳空 ≥5% 不買）、收盤跌破買價 −12% 隔天開盤賣、最長 40 個交易日收盤賣。來回成本 0.585%。
import { getJSON, pool } from '../api/_lib.js';
import { csScan } from './claudeStrat.js';

const FAPI = 'https://fapi.binance.com';
const FEE_SIDE = 0.001, TW_FEE = 0.00585, TW_STOP = 0.12, TW_HOLD = 40, FP_HOLD = 120, FP_RT = 4;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const cacheB = new Map(); // key → { t, v }
const memo = async (key, ttl, fn) => { const c = cacheB.get(key); if (c && Date.now() - c.t < ttl) return c.v; const v = await fn(); cacheB.set(key, { t: Date.now(), v }); return v; };

const dkl = (s) => memo('d' + s, 10 * 60e3, async () => {
  const k = await getJSON(`${FAPI}/fapi/v1/klines?symbol=${s}&interval=1d&limit=499`, { timeout: 12000, retries: 1 });
  return k.filter((x) => x[6] <= Date.now()).map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], q: +x[7] }));
});
const fkl = (s, from) => memo('f' + s + from, 5 * 60e3, async () => {
  const k = await getJSON(`${FAPI}/fapi/v1/klines?symbol=${s}&interval=4h&startTime=${from}&limit=1000`, { timeout: 12000, retries: 1 });
  return k.filter((x) => x[6] <= Date.now()).map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
});
const yd = (code) => memo('y' + code, 20 * 60e3, async () => {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.TWO?interval=1d&range=1y`, { timeout: 12000, retries: 1 });
  const r = j.chart?.result?.[0], q = r?.indicators?.quote?.[0], out = [];
  for (let i = 0; i < (r?.timestamp || []).length; i++) {
    const dd = new Date(r.timestamp[i] * 1000 + 8 * 3600e3).toISOString().slice(0, 10), tp = new Date(Date.now() + 8 * 3600e3);
    if (dd === tp.toISOString().slice(0, 10) && tp.getUTCHours() < 14) continue; // 今天還沒收盤
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every((v) => v != null)) out.push({ d: new Date(r.timestamp[i] * 1000 + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''), o, h, l, c });
  }
  return out;
});

const R2 = (v) => (v == null ? null : +v.toFixed(3));

async function replayCS(list) {
  const btc = await dkl('BTCUSDT'), reg = new Map();
  for (let i = 0; i < btc.length; i++) { if (i < 49) { reg.set(btc[i].t, null); continue; } let s = 0; for (let k = i - 49; k <= i; k++) s += btc[k].c; reg.set(btc[i].t, btc[i].c > s / 50); }
  const out = [], bySym = {};
  for (const x of list) (bySym[x.s] ||= []).push(x);
  await pool(Object.keys(bySym), 6, async (s) => {
    let B; try { B = await dkl(s); } catch { for (const x of bySym[s]) out.push({ ...x, st: 'error' }); return; }
    const full = B.length >= 499;
    const { trades } = csScan(B, (i) => reg.get(B[i].t) === true, (i) => full || i >= 119);
    for (const x of bySym[s]) {
      const t = trades.find((y) => B[y.t] && B[y.t].t === x.sigT);
      if (!t) { out.push({ ...x, st: B.some((b) => b.t === x.sigT) ? 'skipped' : 'error' }); continue; }
      if (t.pending) { out.push({ ...x, st: 'pending' }); continue; }
      const risk = t.entry - t.stop0, fee = 2 * FEE_SIDE * t.entry / risk, last = B[B.length - 1];
      if (t.exitI < 0) out.push({ ...x, st: 'open', entry: t.entry, entryT: B[t.t + 1].t, stop: t.stop, R: R2((last.c - t.entry) / risk - fee), pct: R2((last.c / t.entry - 1) * 100) });
      else out.push({ ...x, st: 'closed', entry: t.entry, entryT: B[t.t + 1].t, exitT: B[t.exitI].t, exitPx: t.exitPx, R: R2((t.exitPx - t.entry) / risk - fee), pct: R2((t.exitPx / t.entry - 1) * 100) });
    }
  });
  return out;
}

async function replayFP(list) {
  const out = [];
  await pool(list, 6, async (x) => {
    let B; try { B = await fkl(x.s, x.sigT); } catch { out.push({ ...x, st: 'error' }); return; }
    const e = B.findIndex((b) => b.t > x.sigT);
    if (e < 0) { out.push({ ...x, st: 'pending' }); return; }
    const d = x.dir, entry = B[e].o, risk = (entry - x.stop) * d;
    if (!(risk > 0)) { out.push({ ...x, st: 'invalid', entry }); return; }
    const target = entry + d * FP_RT * risk, fee = 2 * FEE_SIDE * entry / risk;
    let ex = null;
    for (let k = e; k < B.length && !ex; k++) {
      const b = B[k];
      if ((d > 0 ? b.l <= x.stop : b.h >= x.stop)) ex = { t: b.t, px: x.stop };
      else if ((d > 0 ? b.h >= target : b.l <= target)) ex = { t: b.t, px: target };
      else if (k - e + 1 >= FP_HOLD) ex = { t: b.t, px: b.c };
    }
    const last = B[B.length - 1];
    if (ex) out.push({ ...x, st: 'closed', entry, entryT: B[e].t, exitT: ex.t, exitPx: ex.px, R: R2(d * (ex.px - entry) / risk - fee), pct: R2(d * (ex.px / entry - 1) * 100) });
    else out.push({ ...x, st: 'open', entry, entryT: B[e].t, stop: x.stop, target, R: R2(d * (last.c - entry) / risk - fee), pct: R2(d * (last.c / entry - 1) * 100) });
  });
  return out;
}

async function replayPK(list) {
  const out = [], code = (s) => s.replace(/\D/g, '');
  await pool(list, 4, async (x) => {
    let B; try { B = await yd(code(x.s)); } catch { out.push({ ...x, st: 'error' }); return; }
    const j = B.findIndex((b) => b.d === x.sigD);
    if (j < 0) { out.push({ ...x, st: B.length && B[B.length - 1].d < x.sigD ? 'pending' : 'error' }); return; }
    if (j + 1 >= B.length) { out.push({ ...x, st: 'pending' }); return; }
    const entry = B[j + 1].o;
    if (entry / B[j].c - 1 >= 0.05) { out.push({ ...x, st: 'skipped', entry }); return; }
    let ex = null;
    for (let k = j + 1; k < B.length && !ex; k++) {
      if (B[k].c <= entry * (1 - TW_STOP)) { if (k + 1 < B.length) ex = { d: B[k + 1].d, px: B[k + 1].o }; else return out.push({ ...x, st: 'open', entry, entryD: B[j + 1].d, pct: R2((B[k].c / entry - 1 - TW_FEE) * 100), R: R2((B[k].c / entry - 1 - TW_FEE) / TW_STOP), note: '已觸發停損，隔天開盤賣' }); }
      else if (k - j >= TW_HOLD) ex = { d: B[k].d, px: B[k].c };
    }
    const last = B[B.length - 1], px = ex ? ex.px : last.c, ret = px / entry - 1 - TW_FEE;
    out.push({ ...x, st: ex ? 'closed' : 'open', entry, entryD: B[j + 1].d, exitD: ex?.d, exitPx: ex?.px, pct: R2(ret * 100), R: R2(ret / TW_STOP) });
  });
  return out;
}

export async function stratResults(items) {
  const g = { cs: [], fp: [], pk: [] };
  for (const x of items) if (g[x.k]) g[x.k].push(x);
  const [a, b, c] = await Promise.all([replayCS(g.cs), replayFP(g.fp), replayPK(g.pk)]);
  return [...a, ...b, ...c];
}
