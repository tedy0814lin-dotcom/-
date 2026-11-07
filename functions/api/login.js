// POST /api/login  { username, password }
import { safeEqual, setCookie, json } from '../../cf/auth.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405);
  const U = env.APP_USERNAME, P = env.APP_PASSWORD;
  if (!U || !P || !env.SESSION_SECRET) return json({ error: '網站還沒設定帳號密碼：請到 Cloudflare 專案設定 APP_USERNAME、APP_PASSWORD、SESSION_SECRET 三個變數' }, 500);
  let body = {}; try { body = await request.json(); } catch {}
  const { username = '', password = '' } = body;
  const okUser = await safeEqual(username, U), okPass = await safeEqual(password, P);
  if (!(okUser && okPass)) { await new Promise((r) => setTimeout(r, 800)); return json({ error: '帳號或密碼錯誤' }, 401); }
  return json({ ok: true, user: U }, 200, { 'Set-Cookie': await setCookie(env, U) });
}
