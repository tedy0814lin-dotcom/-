// 在 GitHub Actions 主機裡直接呼叫 api/*.js 的處理函式（不再繞網站）
// 用法：const j = await get('/api/alert?m=crypto&min=2')  → 回傳跟以前網站回的 JSON 一樣
// 2026-11-08 搬遷：運算全部搬到 GitHub，網站（Netlify）只負責顯示算好的結果。
process.env.SNAPSHOT ??= '1'; // 內部呼叫不需登入
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export async function get(url) {
  const u = new URL(url, 'http://local');
  const name = u.pathname.replace(/^\/api\//, '').replace(/[^a-z0-9_]/gi, '');
  const mod = await import(pathToFileURL(path.join(ROOT, 'api', name + '.js')).href);
  const query = Object.fromEntries(u.searchParams);
  return new Promise((ok, no) => {
    let code = 200;
    const res = {
      setHeader() {},
      status(c) { code = c; return this; },
      json(j) { code >= 400 ? no(new Error(j?.error || 'HTTP ' + code)) : ok(j); },
    };
    // SNAPSHOT=1 時 requireUser 直接放行（見 api/_lib.js）；alert 類端點仍檢查 x-alert-key
    Promise.resolve(mod.default({ query, headers: { 'x-alert-key': process.env.ALERT_KEY || '' }, method: 'GET' }, res)).catch(no);
  });
}
