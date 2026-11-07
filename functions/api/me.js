// GET /api/me → 目前登入的人（沒登入回 401）
import { currentUser, json } from '../../cf/auth.js';
export async function onRequest({ request, env }) {
  const user = await currentUser(env, request);
  return user ? json({ user }) : json({ error: '請先登入' }, 401);
}
