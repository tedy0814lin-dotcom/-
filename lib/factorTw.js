// 台股「四因子排名」（觀察用，不是買賣訊號）。2026-11-12 研究：lib 與 /home/claude/all/mf（fac.py／tw3.py）同一套定義。
// 四個因子（只用訓練期挑出、彼此相關 <0.5）：近 250 日高（收盤 ÷ 近 250 日最高）、120 日動能（略過最近 20 日）、
// 日內強（20 日「收盤÷開盤−1」加總）、量增（5 日均量 ÷ 60 日均量）。全部先在「可交易股票」裡轉成百分位排名，四個平均＝總分；總分最高的前 20 名等權、每 20 個交易日換股。
// 回測（台股約 1,371 檔、2020-10～2026-10、隔天開盤換股、來回 0.585%）：N=20／每 20 日 訓練期 +31.9%／驗證期 +77.0%／全期 +43.4%／最大回撤 −50%（0050：+6.5%／+80.6%／+23.8%／−36%）。
// 診斷：9 組參數訓練期 9/9 贏 0050、全期 8/9，但驗證期只有 1/9 贏 0050；有倖存者偏誤、驗證期是大多頭、2022 虧損 → 只當觀察，網站會從上線日起做前瞻記錄。
// 可交易股票＝近 20 日均量 ≥1000 張、股價 ≥10、近 61 根沒有單日漲跌 >10.5%（除權息／分割／資料斷點）。

// B：日 K（舊→新），欄位 o h l c v（v＝張）。回傳 null＝資料不夠；否則 { ok, c, h250, mom, intra, vol }
export function factorRaw(B) {
  const n = B.length;
  if (n < 125) return null;
  const t = n - 1, last = B[t];
  const win = (k, f) => { let s = 0; for (let i = t - k + 1; i <= t; i++) s += f(B[i]); return s; };
  // 近 250 日高（至少 120 根）
  let hi = -Infinity; for (let i = Math.max(0, t - 249); i <= t; i++) hi = Math.max(hi, B[i].h);
  const h250 = last.c / hi;
  const mom = B[t - 20].c / B[t - 120].c - 1;
  let intra = 0; for (let i = t - 19; i <= t; i++) intra += B[i].c / B[i].o - 1;
  const v5 = win(5, (b) => b.v) / 5, v20 = win(20, (b) => b.v) / 20, v60 = n >= 60 ? win(60, (b) => b.v) / 60 : NaN;
  const vol = v5 / v60;
  let jump = false;
  for (let i = Math.max(1, t - 60); i <= t; i++) if (Math.abs(B[i].c / B[i - 1].c - 1) > 0.105) { jump = true; break; }
  const ok = v20 >= 1000 && last.c >= 10 && !jump;
  const f = { h250, mom, intra, vol };
  if (!Object.values(f).every(Number.isFinite)) return { ok: false, c: last.c };
  return { ok, c: last.c, h250, mom, intra, vol };
}

export const FACTOR_NAMES = { h250: '近 250 日高', mom: '120 日動能（略過近 20 日）', intra: '日內強（20 日）', vol: '量增（5／60 日）' };

// rows：[{ code, ...factorRaw }]，只取 ok 的；回傳依總分由高到低的陣列，每筆多 rank:{h250,mom,intra,vol}（0~1 百分位）與 score
export function rankFactors(rows) {
  const U = rows.filter((r) => r && r.ok);
  const out = U.map((r) => ({ ...r, rank: {} }));
  for (const k of Object.keys(FACTOR_NAMES)) {
    const idx = out.map((_, i) => i).sort((a, b) => out[a][k] - out[b][k]);
    // 平均名次（同值取平均），跟 pandas rank(pct=True) 一致
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && out[idx[j + 1]][k] === out[idx[i]][k]) j++;
      const avg = (i + j) / 2 + 1; for (let q = i; q <= j; q++) out[idx[q]].rank[k] = avg / idx.length;
      i = j + 1;
    }
  }
  for (const r of out) r.score = (r.rank.h250 + r.rank.mom + r.rank.intra + r.rank.vol) / 4;
  return out.sort((a, b) => b.score - a.score);
}
