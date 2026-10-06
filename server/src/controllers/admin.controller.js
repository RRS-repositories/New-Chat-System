import { httpError, wrap } from '../middleware/errors.js';
import { listRestrictions, addRestriction, removeRestriction } from '../models/restrictions.model.js';
import { listAdminUsers, setUserActive } from '../models/users.model.js';
import { setAccess } from '../services/access.service.js';
import { forwardSetPassword } from '../services/crmPassword.service.js';
import { UUID } from '../utils/ids.js';

export function createAdminController({ db, emit = { toUser() {} }, presence = null, crmInternalUrl = '', fetchImpl = fetch }) {
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
    listUsers: wrap(async (req, res) => {
      const users = await listAdminUsers(db, { deactivated: req.query.deactivated === '1' });
      res.json({ success: true, users: users.map((u) => ({ ...u, online: !!presence?.isConnected?.(u.id) })) });
    }),

    /** Management switch a person off: signed out everywhere now, and no sign-in (chat or CRM) until switched on again. */
    deactivate: wrap(async (req, res) => {
      const userId = Number(req.params.userId);
      if (!Number.isInteger(userId) || userId <= 0) throw httpError(404, 'not_found', 'User not found');
      if (userId === req.user.id) throw httpError(400, 'own_account', 'You cannot deactivate yourself');
      const person = await setUserActive(db, userId, false);
      if (!person) throw httpError(404, 'not_found', 'User not found');
      emit.toUser(userId, 'session_ended', { reason: 'deactivated' });
      await db.query(
        `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'user.deactivate', 'user', $2, $3)`,
        [req.user.id, String(userId), JSON.stringify({ email: person.email })],
      );
      res.json({ success: true, user: person });
    }),

    /** Management switch a person on again (this also approves a never-approved account). */
    reactivate: wrap(async (req, res) => {
      const userId = Number(req.params.userId);
      if (!Number.isInteger(userId) || userId <= 0) throw httpError(404, 'not_found', 'User not found');
      const person = await setUserActive(db, userId, true);
      if (!person) throw httpError(404, 'not_found', 'User not found');
      await db.query(
        `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'user.reactivate', 'user', $2, $3)`,
        [req.user.id, String(userId), JSON.stringify({ email: person.email })],
      );
      res.json({ success: true, user: person });
    }),

    /** Management or IT set a person's password: the CRM does it (its rules, its audit), with the caller's own session. */
    setPassword: wrap(async (req, res) => {
      const userId = Number(req.params.userId);
      if (!Number.isInteger(userId) || userId <= 0) throw httpError(404, 'not_found', 'User not found');
      if (userId === req.user.id) throw httpError(400, 'own_password', 'Change your own password from the CRM');
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const clientIp = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '')
        .split(',')[0]
        .trim();
      const { password, confirmPassword } = req.body || {};
      const { status, body } = await forwardSetPassword(
        { crmInternalUrl, fetchImpl },
        { userId, token, password, confirmPassword, clientIp },
      );
      res.status(status).json(body);
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
