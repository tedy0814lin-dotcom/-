// 分頁整理（2026-11-15）：頂層 4 個分頁（市場掃描／策略／診斷／數據記錄），市場掃描內再分 加密貨幣／台股／型態。
// 內部 state.tab 仍用原本的 crypto／tw／twpat／strat／log（渲染程式不動），這裡只決定「分組」與「舊存檔如何對應」。
export const SCAN_TABS = ['crypto', 'tw', 'twpat'];
export const TOP_TABS = ['scan', 'strat', 'diag', 'log']; // 導覽列順序
export const OLD_TO_STRAT = ['vegas', 'trust', 'claude'];   // 更早的舊分頁，已併入策略頁

export function groupOf(tab) { return SCAN_TABS.includes(tab) ? 'scan' : tab; }

// saved：localStorage wr_prefs 解析後的物件；diagReady：診斷頁是否已上線（未上線時存到 diag 要退回）
export function migratePrefs(saved, { diagReady = false } = {}) {
  const s = saved && typeof saved === 'object' ? saved : {};
  let tab = 'crypto';
  if (['tw', 'crypto', 'log', 'twpat', 'strat'].includes(s.tab)) tab = s.tab;
  else if (s.tab === 'diag' && diagReady) tab = 'diag';
  else if (OLD_TO_STRAT.includes(s.tab)) tab = 'strat';
  // 市場掃描最後停留的子分頁：目前在子分頁就用它；否則用上次存的 scan；再不然 crypto
  const scan = SCAN_TABS.includes(tab) ? tab : (SCAN_TABS.includes(s.scan) ? s.scan : 'crypto');
  return { tab, scan };
}
