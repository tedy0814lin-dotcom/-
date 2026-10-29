// Price Action Index（chrism665，TradingView）— 只當參考、不計分
// Z = 隨機指標位置（−1～+1，20 根、平滑 3）× 波動擴張程度（20 根標準差在近 20 根的位置 0～100）
// 2026-10-29 回測（隔根開盤進場、停損 10 根低／高點、扣費）：
//   加密 4H 31 幣：上穿 +5 做多 4R +0.10R（前 +0.19／後 +0.01）；其餘訊號 −0.13～+0.03R
//   台股日線 309 檔：上穿 +5 做多 4R +0.11R（前 +0.19／後 +0.04）；其餘 −0.29～−0.04R
// 使用者假設「下跌中一直超賣、第一次超買＝反轉」：反而比沒有超賣過的差（台股前 +0.27／後 −0.16，加密 −0.03R）
// 真正有效的是「進入超買（Z 上穿 80）就做多」＝動能延續：
//   台股日線：停損 10 根低點、4R 全出 +0.35R，同樣出場的隨機做多 +0.07R；2022～2026 每年都贏隨機 → 計分（twPai80）
//   加密 4H：6R +0.30R，但 2022 −0.64R、2025 後 ≈0 → 只當參考
const BT = {
  crypto: { ob80: '6R +0.30R，但 2022 年 −0.64R、2025 年後約 0，不穩', up5: '+0.10R（前 +0.19／後 +0.01）', dn5: '+0.03R', top: '−0.13R', bot: '−0.06R', bull: '0R', bear: '−0.06R' },
  tw:     { ob80: '4R +0.35R（隨機做多 +0.07R），每年都贏隨機', up5: '+0.11R（前 +0.19／後 +0.04）', dn5: '−0.15R', top: '−0.29R', bot: '−0.04R', bull: '−0.06R', bear: '−0.29R' },
};
const NAME = { ob80: '進入超買（Z 上穿 80）', up5: '突破（Z 上穿 +5）', dn5: '跌破（Z 下穿 −5）', top: '多頭過熱回落（Z 下穿 80）', bot: '空頭超賣回升（Z 上穿 −80）', bull: '底背離', bear: '頂背離' };

export function paiSeries(B, L = 20, sm = 3) {
  const n = B.length, Z = new Array(n).fill(null), st = new Array(n).fill(null), sd = new Array(n).fill(null);
  for (let i = L - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity, s = 0, s2 = 0;
    for (let j = i - L + 1; j <= i; j++) { hi = Math.max(hi, B[j].h); lo = Math.min(lo, B[j].l); s += B[j].c; s2 += B[j].c * B[j].c; }
    st[i] = hi > lo ? ((B[i].c - lo) / (hi - lo)) * 100 : null;
    const m = s / L; sd[i] = Math.sqrt(Math.max(0, s2 / L - m * m));
  }
  for (let i = 2 * L; i < n; i++) {
    const a = [st[i], st[i - 1], st[i - 2]];
    if (a.some((x) => x == null)) continue;
    const P = ((a[0] + a[1] + a[2]) / sm - 50) / 50;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - L + 1; j <= i; j++) { hi = Math.max(hi, sd[j]); lo = Math.min(lo, sd[j]); }
    if (!(hi > lo)) continue;
    Z[i] = P * ((sd[i] - lo) / (hi - lo)) * 100;
  }
  return Z;
}

// 最新狀態＋最近 3 根內的訊號
export function paiNow(B) {
  if (!B || B.length < 60) return null;
  const Z = paiSeries(B), n = B.length, L = n - 1;
  if (Z[L] == null) return null;
  const evs = [];
  let pl = null, ph = null;
  const isPiv = (i, f) => { for (let j = i - 2; j <= i + 2; j++) if (j !== i && (Z[j] == null || !f(Z[i], Z[j]))) return false; return true; };
  for (let i = 1; i < n; i++) {
    const z0 = Z[i - 1], z1 = Z[i];
    if (z0 == null || z1 == null) continue;
    if (z0 < 80 && z1 >= 80) evs.push({ i, k: 'ob80', dir: 1 });
    if (z0 <= 5 && z1 > 5) evs.push({ i, k: 'up5', dir: 1 });
    if (z0 >= -5 && z1 < -5) evs.push({ i, k: 'dn5', dir: -1 });
    if (z0 >= 80 && z1 < 80) evs.push({ i, k: 'top', dir: -1 });
    if (z0 <= -80 && z1 > -80) evs.push({ i, k: 'bot', dir: 1 });
    const p = i - 2;
    if (p >= 2 && Z[p] != null) {
      if (isPiv(p, (a, b) => a < b)) { if (pl != null && p - pl >= 2 && p - pl <= 10 && B[p].l < B[pl].l && Z[p] > Z[pl]) evs.push({ i, k: 'bull', dir: 1 }); pl = p; }
      if (isPiv(p, (a, b) => a > b)) { if (ph != null && p - ph >= 2 && p - ph <= 10 && B[p].h > B[ph].h && Z[p] < Z[ph]) evs.push({ i, k: 'bear', dir: -1 }); ph = p; }
    }
  }
  const recent = evs.filter((e) => L - e.i <= 2);
  const last = recent.find((e) => e.k === 'ob80') || recent.pop() || null;
  const z = Z[L];
  let ob = null;
  if (last && last.k === 'ob80') {
    // 進場＝最新收盤（訊號後隔根開盤附近）、停損＝訊號那根往前 10 根最低點
    let lo = Infinity; for (let j = Math.max(0, last.i - 9); j <= last.i; j++) lo = Math.min(lo, B[j].l);
    ob = { ago: L - last.i, entry: B[L].c, stop: lo };
  }
  return { z: Math.round(z), zone: z > 5 ? '偏多' : z < -5 ? '偏空' : '盤整', ev: last ? { k: last.k, dir: last.dir, ago: L - last.i } : null, ob };
}

export function paiLine(p, mkt, tf) {
  if (!p) return null;
  const s = `【參考：PAI 價格行為指數】${tf} Z=${p.z > 0 ? '+' : ''}${p.z}（${p.zone}）`;
  if (!p.ev) return `${s}・近 3 根沒有訊號・不計分`;
  if (p.ev.k === 'ob80' && mkt === 'tw') return null; // 台股這個訊號另外列成計分策略
  return `${s}・${p.ev.ago === 0 ? '剛' : p.ev.ago + ' 根前'}${NAME[p.ev.k]}・回測${p.ev.k === 'up5' ? ' 4R ' : ' '}${BT[mkt][p.ev.k]}・不計分`;
}
