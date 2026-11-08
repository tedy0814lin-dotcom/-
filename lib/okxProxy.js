// OKX 的統計類 API（持倉歷史、大戶比、主動買賣量…）沒有跨站授權，瀏覽器不能直接呼叫，要經過網站自己的代理。
// 只放行這幾支唯讀 API，其他路徑一律拒絕。
export const OKXR_RE = /^\/api\/v5\/rubik\/stat\/(contracts\/(open-interest-history|long-short-position-ratio-contract-top-trader|long-short-account-ratio)|taker-volume)\?[A-Za-z0-9=&._-]{1,200}$/;
export const okxrPathOk = (p) => typeof p === 'string' && OKXR_RE.test(p);
