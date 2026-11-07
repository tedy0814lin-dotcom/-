// 登入驗證（Cloudflare Pages Functions 版）：跟 Netlify 版同一套 HMAC 簽章 cookie、30 天，改用 Web Crypto
export const COOKIE = 'wr_session';
const DAYS = 30;
const enc = new TextEncoder(), dec = new TextDecoder();

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function secret(env) {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET 沒設定或太短（至少 16 個字）');
  return s;
}
async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
// 固定時間比較：先各自雜湊成等長，再逐位元比
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map(async (x) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(x))))));
  let d = 0;
  for (let i = 0; i < ha.length; i++) d |= ha[i] ^ hb[i];
  return d === 0;
}
export async function sign(env, user) {
  const payload = `${b64u(enc.encode(user))}.${Date.now() + DAYS * 864e5}`;
  return `${payload}.${await hmac(env, payload)}`;
}
export async function verify(env, token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  if (!(await safeEqual(sig, await hmac(env, `${u}.${exp}`)))) return null;
  if (Date.now() > Number(exp)) return null;
  return dec.decode(unb64u(u));
}
export function cookieOf(req, name = COOKIE) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export async function currentUser(env, req) { try { return await verify(env, cookieOf(req)); } catch { return null; } }
export const setCookie = async (env, user) => `${COOKIE}=${encodeURIComponent(await sign(env, user))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', ...headers } });
