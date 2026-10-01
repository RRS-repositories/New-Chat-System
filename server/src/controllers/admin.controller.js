import { httpError, wrap } from '../middleware/errors.js';
import { listRestrictions, addRestriction, removeRestriction } from '../models/restrictions.model.js';
import { listAdminUsers } from '../models/users.model.js';
import { setAccess } from '../services/access.service.js';
import { UUID } from '../utils/ids.js';

export function createAdminController({ db, presence = null }) {
  return {
    listRestrictions: wrap(async (req, res) => {
      const userId = req.query.userId ? req.query.userId : null;
      res.json({ success: true, restrictions: await listRestrictions(db, { userId }) });
    }),

    listRestrictionsForUser: wrap(async (req, res) => {
      res.json({ success: true, restrictions: await listRestrictions(db, { userId: req.params.userId }) });
    }),

    addRestriction: wrap(async (req, res) => {
      const { userId, targetUserId, restriction, reason, bothWays } = req.body || {};
      const restrictions = await addRestriction(db, {
        userId,
        targetUserId,
        restriction,
        reason: reason ?? '',
        restrictedBy: req.user.id,
        bothWays: bothWays === true,
      });
      res.status(201).json({ success: true, restrictions });
    }),

    removeRestriction: wrap(async (req, res) => {
      const notFound = () => httpError(404, 'not_found', 'Restriction not found');
      if (!UUID.test(req.params.id)) throw notFound();
      if (!(await removeRestriction(db, { id: req.params.id, actorId: req.user.id }))) throw notFound();
      res.json({ success: true });
    }),

    /** Everyone, whether chat is on for them, who is online, and their block counts. */
    listUsers: wrap(async (_req, res) => {
      const users = await listAdminUsers(db);
      res.json({ success: true, users: users.map((u) => ({ ...u, online: !!presence?.isConnected?.(u.id) })) });
    }),

    /** Allow or block one person contacting many others (optionally both ways) in one go. */
    setAccess: wrap(async (req, res) => {
      const { targetUserIds, kind, allowed, bothWays, reason } = req.body || {};
      const result = await setAccess(db, {
        userId: req.params.userId,
        targetUserIds,
        kind,
        allowed,
        bothWays: bothWays === true,
        actorId: req.user.id,
        reason,
      });
      res.json({ success: true, ...result, restrictions: await listRestrictions(db, { userId: req.params.userId }) });
    }),
  };
}
