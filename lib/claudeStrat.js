// Claude 自創策略（2026-11-04）：「大陽線突破新高＋大盤濾網＋寬追蹤停損」（加密貨幣日線，只做多）
// 規則（日 K，UTC 0 點收盤判斷，隔天開盤進場）：
//   可交易：近 20 天平均成交額 ≥2,000 萬美元、上市滿 120 天
//   大盤：BTC 收盤在 50 日均線之上
//   訊號：大陽線（收−開 ≥1 倍 ATR14）＋收盤 ≥ 前 55 天最高價＋成交額 ≥ 前 20 天平均 1.5 倍
//   停損：訊號那根最低點；之後追蹤停損＝進場後最高收盤 − 7×ATR14（BTC 跌破 50 日線時改 2.5×ATR），只上移、碰到出場，不設目標
//   投組（回測設定）：每筆風險 1%、最多 10 檔、單檔 ≤25%、總曝險 ≤2 倍，訊號太多時依成交額倍數排序
// 回測（820 幣含 29 檔下市、2020-01～2026-09，扣手續費 0.1%／邊、資金費率 0.03%／天）：全期 14.4 倍、年化 +49%、最大回撤 −45%；
//   挑選期（到 2025-01）年化 +58%；驗證期（2025-02 起）年化 +23%，同期持有 BTC −11%。與 Python 回測（/home/claude/all/port/ref_one.py）逐筆一致。
export const CS_P = { L: 55, body: 1.0, vm: 1.5, m: 7.0, mOff: 2.5, liq: 20e6, age: 120 };
function atr(B) {
  const o = new Array(B.length).fill(NaN); let a = 0;
  for (let i = 0; i < B.length; i++) {
    const pc = i ? B[i - 1].c : B[0].c, tr = Math.max(B[i].h - B[i].l, Math.abs(B[i].h - pc), Math.abs(B[i].l - pc));
    a = i ? a * (1 - 1 / 14) + tr / 14 : tr; if (i >= 13) o[i] = a;
  }
  return o;
}
// B: [{t,o,h,l,c,q}]（已收盤的日 K）；reg(t)＝那天 BTC 是否在 50 日線上；ageOk(i)＝第 i 根時是否上市滿 120 天
// 回傳 { trades:[{t（訊號那根 index）, entry, stop0, exitI（-1＝還沒出場）, exitPx, stop（目前追蹤停損）, hc}], signalToday }
export function csScan(B, reg, ageOk, P = CS_P) {
  const n = B.length, A = atr(B), sig = [];
  for (let t = 0; t < n; t++) {
    if (!(A[t] > 0) || t < P.L || t < 20) continue;
    let hh = -Infinity; for (let k = t - P.L; k < t; k++) hh = Math.max(hh, B[k].h);
    let vs = 0; for (let k = t - 20; k < t; k++) vs += B[k].q;
    let qs = 0; for (let k = t - 19; k <= t; k++) qs += B[k].q;
    const b = B[t];
    if ((b.c - b.o) / A[t] >= P.body && b.c >= hh && b.q >= P.vm * (vs / 20) && qs / 20 >= P.liq && ageOk(t) && reg(t)) sig.push(t);
  }
  const trades = []; let busy = -1;
  for (const t of sig) {
    if (t < busy) continue;
    if (t === n - 1) { trades.push({ t, entry: null, stop0: B[t].l, exitI: -1, exitPx: null, stop: B[t].l, hc: null, pending: true }); break; }
    const d = t + 1, e = B[d].o; let s = B[t].l;
    if (e <= s) continue;
    let hc = e, ex = null;
    for (let k = d; k < n; k++) {
      if (B[k].o <= s) { ex = [k, B[k].o]; break; }
      if (B[k].l <= s) { ex = [k, s]; break; }
      hc = Math.max(hc, B[k].c); const mm = reg(k) ? P.m : P.mOff;
      s = Math.max(s, hc - mm * A[k]);
    }
    trades.push({ t, entry: e, stop0: B[t].l, exitI: ex ? ex[0] : -1, exitPx: ex ? ex[1] : null, stop: s, hc });
    busy = ex ? ex[0] : n;
  }
  return { trades, A };
}
