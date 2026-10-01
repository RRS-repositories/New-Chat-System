import { Router } from 'express';
import { httpError, wrap } from '../middleware/errors.js';
import { listRestrictions, addRestriction, removeRestriction, setAccess, listAdminUsers } from '../models/restrictions.model.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Management-only admin routes (communication restrictions). Mounted at /api/chat/admin behind auth. */
export function createAdminRoutes({ db, presence = null }) {
  const r = Router();

  r.use((req, res, next) => {
    if (req.user?.role !== 'Management') {
      return res.status(403).json({ success: false, code: 'forbidden', message: 'Only Management can do this' });
    }
    next();
  });

  r.get('/restrictions', wrap(async (req, res) => {
    const userId = req.query.userId ? req.query.userId : null;
    res.json({ success: true, restrictions: await listRestrictions(db, { userId }) });
  }));

  r.get('/restrictions/user/:userId', wrap(async (req, res) => {
    res.json({ success: true, restrictions: await listRestrictions(db, { userId: req.params.userId }) });
  }));

  r.post('/restrictions', wrap(async (req, res) => {
    const { userId, targetUserId, restriction, reason, bothWays } = req.body || {};
    const restrictions = await addRestriction(db, {
      userId, targetUserId, restriction, reason: reason ?? '', restrictedBy: req.user.id, bothWays: bothWays === true,
    });
    res.status(201).json({ success: true, restrictions });
  }));

  r.delete('/restrictions/:id', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw httpError(404, 'not_found', 'Restriction not found');
    const removed = await removeRestriction(db, { id: req.params.id, actorId: req.user.id });
    if (!removed) throw httpError(404, 'not_found', 'Restriction not found');
    res.json({ success: true });
  }));

  // Admin panel: everyone, whether chat is on for them, who is online, and their block counts.
  r.get('/users', wrap(async (_req, res) => {
    const users = await listAdminUsers(db);
    res.json({ success: true, users: users.map((u) => ({ ...u, online: !!presence?.isConnected?.(u.id) })) });
  }));

  // Allow or block one person contacting many others (optionally both ways) in one go.
  r.put('/users/:userId/access', wrap(async (req, res) => {
    const { targetUserIds, kind, allowed, bothWays, reason } = req.body || {};
    const out = await setAccess(db, { userId: req.params.userId, targetUserIds, kind, allowed, bothWays: bothWays === true, actorId: req.user.id, reason });
    res.json({ success: true, ...out, restrictions: await listRestrictions(db, { userId: req.params.userId }) });
  }));

  return r;
}
