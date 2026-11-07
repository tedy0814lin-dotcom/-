// GET /snap/<名稱> → 登入後，把 GitHub 主機算好的快照 JSON 讀給瀏覽器（快照在 repo 的 snap 分支，約每 20 分鐘更新）
// repo 是公開的就不需要 token；改私人 repo 時設環境變數 GH_TOKEN（只要 contents:read 的 fine-grained token）。
import { currentUser, json } from '../../cf/auth.js';

export async function onRequest({ request, env, params }) {
  if (!(await currentUser(env, request))) return json({ error: '請先登入' }, 401);
  const BASE = env.SNAP_BASE || 'https://raw.githubusercontent.com/tedy0814lin-dotcom/-/snap';
  const key = String(params.key || '');
  if (!/^[a-z0-9_]{1,40}$/i.test(key)) return json({ error: '名稱不對' }, 400);
  const headers = { 'User-Agent': 'whale-radar', 'Cache-Control': 'no-cache' };
  if (env.GH_TOKEN) headers.Authorization = 'Bearer ' + env.GH_TOKEN;
  let r;
  try { r = await fetch(`${BASE}/${key}.json`, { headers, signal: AbortSignal.timeout(15000) }); }
  catch (e) { return json({ error: '讀不到快照：' + e.message }, 502); }
  if (r.status === 404) return json({ error: `還沒有「${key}」的資料（GitHub 排程還沒算出來）` }, 404);
  if (!r.ok) return json({ error: '讀取快照失敗 HTTP ' + r.status }, 502);
  return new Response(r.body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
