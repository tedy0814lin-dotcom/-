// GET /api/me  → 目前登入的人（沒登入回 401）
import { requireUser } from './_lib.js';

export default function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  res.status(200).json({ user });
}
