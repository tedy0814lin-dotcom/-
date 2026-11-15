// 診斷頁階段 2：加密貨幣持股（只記錄損益並顯示現有籌碼數據，不給任何買賣或換股建議）。
// 理由：汰弱留強、三因子、0050 比較的證據全是台股，加密貨幣沒有對應回測（規格：專案文件《持股診斷頁規格》階段 2）。
// 純函式，不碰 DOM；籌碼欄位沿用加密頁的 mergeExchanges，數字與加密頁一致。
import { normBase, mergeExchanges } from './exchanges.js';

const num = (x) => (x === '' || x == null ? null : Number(x));
export function normalizeCoin(h) {
  const base = String(h?.base ?? '').trim().toUpperCase().replace(/(-?USDT|\/USDT)$/, '');
  if (!/^[A-Z0-9]{2,15}$/.test(base)) return { error: `幣種代號不正確（收到「${String(h?.base ?? '').trim()}」，請填 BTC、ETH 這類）` };
  const qty = num(h.qty), cost = num(h.cost);
  if (qty != null && (!Number.isFinite(qty) || qty < 0)) return { error: `${base} 的數量不正確` };
  if (cost != null && (!Number.isFinite(cost) || cost <= 0)) return { error: `${base} 的成本價（USDT）要大於 0，不想填就留空` };
  return { holding: { base, qty: qty ?? 0, cost: cost ?? null } };
}
export function upsertCoin(list, h) {
  const r = normalizeCoin(h); if (r.error) return { list, error: r.error };
  const i = list.findIndex((x) => x.base === r.holding.base);
  const out = list.slice(); if (i >= 0) out[i] = r.holding; else out.push(r.holding);
  return { list: out };
}
export const exportCoins = (list) => JSON.stringify({ v: 1, kind: 'wr_diag_crypto', holdings: list }, null, 1);
export function parseCoins(text) {
  let j; try { j = JSON.parse(text); } catch { return { error: '不是有效的 JSON 檔' }; }
  const arr = Array.isArray(j) ? j : j?.holdings;
  if (!Array.isArray(arr)) return { error: '找不到持倉清單（holdings）' };
  let list = [], errs = [];
  for (const h of arr) { const r = upsertCoin(list, h); if (r.error) errs.push(r.error); else list = r.list; }
  if (errs.length && !list.length) return { error: errs[0] };
  return { list, skipped: errs };
}

// 依 base 找加密頁快照的那一列（1000PEPE 與 PEPE 視為同一幣）
export function findRow(rows, base) { return (rows || []).find((r) => normBase(r.base) === normBase(base)) || null; }

// 單一持倉診斷：損益只用現價與成本；籌碼數字原樣帶出（不做判斷）
export function diagnoseCoin(h, row, xchg) {
  const r = { base: h.base, qty: h.qty || 0, cost: h.cost ?? null };
  if (!row) return { ...r, status: 'notfound' };
  const m = mergeExchanges({ ...row }, xchg); // 複製一份，不改到原快照
  r.px = m.price; r.chg24 = m.chg24 ?? null; r.value = r.qty > 0 && m.price > 0 ? r.qty * m.price : 0;
  if (r.cost != null && m.price > 0) { r.pnl = m.price / r.cost - 1; r.pnlUsd = r.qty > 0 ? r.qty * (m.price - r.cost) : null; r.needGain = m.price < r.cost ? r.cost / m.price - 1 : 0; }
  r.chip = {
    oi: m.oiAll ?? m.oi ?? null, oiChg24: m.oiChg24 ?? null, oiEx: m.exCount ?? null, oiChgSrc: m.oiSources ?? null, // 總持倉的交易所數／24h 變化所用的交易所數（兩者不同）
    
    funding: m.funding ?? null, fundingMax: m.fundingMax || null, fundingMin: m.fundingMin || null,
    topLS: m.okxTop ? { now: m.okxTop.now, chg: m.okxTop.chg } : null, accLS: m.okxAcc ? { now: m.okxAcc.now, chg: m.okxAcc.chg } : null,
    hasXchg: !!(xchg?.byBase?.[normBase(h.base)]),
  };
  r.status = 'ok';
  return r;
}
export function summarizeCoins(results) {
  const ok = results.filter((r) => r.status === 'ok'), total = ok.reduce((s, r) => s + (r.value || 0), 0);
  const warns = [];
  if (total > 0) for (const r of ok) { const w = r.value / total; if (ok.length > 1 && w > 0.5) warns.push(`${r.base} 占加密持倉市值 ${(w * 100).toFixed(0)}%，超過一半（集中度提醒，非回測結果）`); }
  return { total, weights: Object.fromEntries(ok.map((r) => [r.base, total > 0 ? r.value / total : null])), warns };
}
