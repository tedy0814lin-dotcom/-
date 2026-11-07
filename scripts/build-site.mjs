// 組出要上傳到 Netlify 的靜態檔（dist/）：前端頁面＋瀏覽器端用到的 lib。不含 api/、scripts/、.github/。
import fs from 'node:fs';
import path from 'node:path';
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/lib', { recursive: true });
const top = fs.readdirSync('.').filter((f) => /\.(html|css)$/.test(f) || (/\.js$/.test(f) && !/^(vite|webpack)/.test(f)));
for (const f of top) fs.copyFileSync(f, path.join('dist', f));
for (const f of fs.readdirSync('lib').filter((f) => f.endsWith('.js'))) fs.copyFileSync(path.join('lib', f), path.join('dist/lib', f));
console.log('dist:', top.length, '個頁面檔 +', fs.readdirSync('dist/lib').length, '個 lib');
// Cloudflare Pages：標頭設定檔
if (fs.existsSync('_headers')) fs.copyFileSync('_headers', 'dist/_headers');
