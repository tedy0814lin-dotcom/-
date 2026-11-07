// POST /api/login  { username, password }
import { safeEqual, setCookie, json } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: '只接受 POST' }, 405);
  const U = process.env.APP_USERNAME, P = process.env.APP_PASSWORD;
  if (!U || !P || !process.env.SESSION_SECRET) return json({ error: '網站還沒設定帳號密碼：請到 Netlify 設定 APP_USERNAME、APP_PASSWORD、SESSION_SECRET 三個環境變數' }, 500);
  let body = {}; try { body = await req.json(); } catch {}
  const { username = '', password = '' } = body;
  const okUser = safeEqual(username, U), okPass = safeEqual(password, P);
  if (!(okUser && okPass)) { await new Promise((r) => setTimeout(r, 800)); return json({ error: '帳號或密碼錯誤' }, 401); }
  return json({ ok: true, user: U }, 200, { 'Set-Cookie': setCookie(U) });
};
export const config = { path: '/api/login' };
