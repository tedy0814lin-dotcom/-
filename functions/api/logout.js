import { clearCookie, json } from '../../cf/auth.js';
export async function onRequest() { return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() }); }
