// GET /api/me → 目前登入的人（沒登入回 401）
import { currentUser, json } from '../lib/auth.mjs';
export default async (req) => { const user = currentUser(req); return user ? json({ user }) : json({ error: '請先登入' }, 401); };
export const config = { path: '/api/me' };
