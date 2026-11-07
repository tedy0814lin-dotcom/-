// 登入驗證（跟原本 Vercel 版 api/_lib.js 同一套：HMAC 簽章 cookie，30 天）
import crypto from 'node:crypto';

export const COOKIE = 'wr_session';
const DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET 沒設定或太短（至少 16 個字）');
  return s;
}
const hmac = (t) => crypto.createHmac('sha256', secret()).update(t).digest('base64url');

export function sign(user) {
  const payload = `${Buffer.from(user).toString('base64url')}.${Date.now() + DAYS * 864e5}`;
  return `${payload}.${hmac(payload)}`;
}
export function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  const a = Buffer.from(sig), b = Buffer.from(hmac(`${u}.${exp}`));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() > Number(exp)) return null;
  return Buffer.from(u, 'base64url').toString();
}
export function cookieOf(req, name = COOKIE) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function currentUser(req) { try { return verify(cookieOf(req)); } catch { return null; } }
export const setCookie = (user) => `${COOKIE}=${encodeURIComponent(sign(user))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest(), hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', ...headers } });
