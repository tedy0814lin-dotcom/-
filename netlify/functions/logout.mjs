import { clearCookie, json } from '../lib/auth.mjs';
export default async () => json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
export const config = { path: '/api/logout' };
