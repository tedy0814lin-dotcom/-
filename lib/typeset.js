// 策略頁統一排版：①「；」不顯示（括號內改「，」，其他改「。」）②說明文字裡的數字、範圍、「正2」不在中間斷行。
// 只動文字節點，不改資料與計算；重複執行不會有副作用（已處理過的不會再動）。
const NW = /(正2|[+−-]?\d+(?:[.,]\d+)*(?:-\d+)*(?: ?(?:年|檔|槽|天|個|筆|根|倍))?%?R?(?:～[+−-]?\d+(?:[.,]\d+)*%?R?)*(?:／\d+(?:[.,]\d+)*%?)*)/;
const SKIP = 'script,style,textarea,input,select,option,svg,canvas,code,pre,.nw';
const PROSE = 'p,li,dd,dt,summary,.status,.muted,.small,.cl';

export function fixSemi(s) {
  let depth = 0, out = '';
  for (const ch of s) {
    if (ch === '（' || ch === '(') depth++;
    else if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    out += ch === '；' ? (depth ? '，' : '。') : ch;
  }
  return out.replace(/。(?=[。」）])/g, '').replace(/。{2,}/g, '。');
}

export function typeset(root) {
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
  for (const n of nodes) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) continue;
    let v = n.nodeValue;
    if (v.includes('；')) { v = fixSemi(v); n.nodeValue = v; }
    if (!p.closest(PROSE) || p.closest('table') || !/\d|正2/.test(v)) continue;
    const parts = v.split(NW);
    if (parts.length < 3) continue;
    const f = document.createDocumentFragment();
    parts.forEach((x, i) => {
      if (!x) return;
      if (i % 2) { const s = document.createElement('span'); s.className = 'nw'; s.textContent = x; f.appendChild(s); }
      else f.appendChild(document.createTextNode(x));
    });
    n.replaceWith(f);
  }
}

// 監看某個容器：子頁重繪後自動再整理一次
export function watchTypeset(root) {
  let busy = false, queued = false;
  const run = () => { queued = false; busy = true; try { typeset(root); } finally { busy = false; } };
  const mo = new MutationObserver(() => { if (busy || queued) return; queued = true; requestAnimationFrame(run); });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  run();
  return mo;
}
