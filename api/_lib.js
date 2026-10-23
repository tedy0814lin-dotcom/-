// 共用工具：登入驗證、抓資料、併發控制
// 檔名開頭是底線「_」，Vercel 不會把它當成網址，只給其他檔案 import 用。
import crypto from 'node:crypto';

const COOKIE = 'wr_session';
const DAYS = 30; // 登入後保持 30 天

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET 沒設定或太短（至少 16 個字）');
  return s;
}

function hmac(text) {
  return crypto.createHmac('sha256', secret()).update(text).digest('base64url');
}

// 產生登入憑證：使用者.到期時間.簽章（簽章防止別人偽造）
export function sign(user) {
  const exp = Date.now() + DAYS * 864e5;
  const payload = `${Buffer.from(user).toString('base64url')}.${exp}`;
  return `${payload}.${hmac(payload)}`;
}

export function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(`${u}.${exp}`));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() > Number(exp)) return null;
  return Buffer.from(u, 'base64url').toString();
}

export function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function currentUser(req) {
  try { return verify(getCookie(req, COOKIE)); } catch { return null; }
}

// 每支資料 API 開頭呼叫：沒登入就回 401
export function requireUser(req, res) {
  const u = currentUser(req);
  if (!u) { res.status(401).json({ error: '請先登入' }); return null; }
  return u;
}

export function setSession(res, user) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(sign(user))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// 比對字串但不洩漏「猜對幾個字」的時間差
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 抓 JSON；網路錯誤、被限流（429）或對方伺服器錯誤（5xx）會自動重試 2 次
export async function getJSON(url, { timeout = 9000, retries = 2 } = {}) {
  let err;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (whale-radar)', Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return await res.json();
      err = new Error(`HTTP ${res.status}：${new URL(url).pathname}`);
      if (res.status !== 429 && res.status < 500) throw err; // 404 這類不用重試
    } catch (e) {
      err = e;
      if (/HTTP 4(?!29)/.test(e.message)) throw e;
    }
    if (i < retries) await sleep(600 * (i + 1));
  }
  throw err;
}

// 一次最多同時跑 limit 個請求，避免被交易所限流
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
