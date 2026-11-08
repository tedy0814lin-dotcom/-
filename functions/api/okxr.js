// GET /api/okxr?p=<OKX 統計 API 路徑與參數> → 登入後，由伺服器代為向 OKX 抓資料（圖表用；瀏覽器直接抓會被跨站規則擋住）
import { currentUser, json } from '../../cf/auth.js';
import { okxrPathOk } from '../../lib/okxProxy.js';

export async function onRequestGet({ request, env }) {
  if (!(await currentUser(env, request))) return json({ error: '請先登入' }, 401);
  const p = new URL(request.url).searchParams.get('p') || '';
  if (!okxrPathOk(p)) return json({ error: '不支援的路徑' }, 400);
  let r;
  try { r = await fetch('https://www.okx.com' + p, { headers: { 'User-Agent': 'whale-radar' }, signal: AbortSignal.timeout(9000) }); }
  catch (e) { return json({ error: '抓不到 OKX：' + e.message }, 502); }
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=20' } });
}
