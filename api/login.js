// POST /api/login  { username, password }
import { safeEqual, setSession, sleep } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });
  const U = process.env.APP_USERNAME;
  const P = process.env.APP_PASSWORD;
  if (!U || !P || !process.env.SESSION_SECRET) {
    return res.status(500).json({ error: '網站還沒設定帳號密碼：請到 Vercel 設定 APP_USERNAME、APP_PASSWORD、SESSION_SECRET 三個環境變數' });
  }
  const { username = '', password = '' } = req.body || {};
  const okUser = safeEqual(username, U);
  const okPass = safeEqual(password, P);
  if (!(okUser && okPass)) {
    await sleep(800); // 拖慢亂猜密碼的人
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  setSession(res, U);
  res.status(200).json({ ok: true, user: U });
}
