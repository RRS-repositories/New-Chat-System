import { Router } from 'express';
import { wrap } from '../middleware/errors.js';
import { hiddenFromPicker } from '../models/restrictions.model.js';

export function createUserRoutes({ db }) {
  const r = Router();
  r.get('/me', (req, res) => res.json({ success: true, user: req.user }));
  r.get('/', wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.role FROM public.users u WHERE u.is_approved = TRUE AND u.is_active IS NOT FALSE AND u.id <> $1 ORDER BY u.full_name`,
      [req.user.id]);
    // People the caller is restricted from messaging are left out of the picker.
    const hidden = new Set(await hiddenFromPicker(db, { forUserId: req.user.id }));
    res.json({ success: true, users: rows.filter((u) => !hidden.has(u.id)).map((u) => ({ id: u.id, fullName: u.full_name || '', role: u.role })) });
  }));
  return r;
}
