// POST /api/logout
import { clearSession } from './_lib.js';

export default function handler(req, res) {
  clearSession(res);
  res.status(200).json({ ok: true });
}
