import { AVATAR_COLUMNS, avatarUrl } from './avatars.model.js';
// People come from the CRM's own `users` table; chat only reads it.
//
// Chat is switched on for Management and IT by role, and for anyone else who holds the CRM
// permission `chat.beta`. This mirrors the CRM's own rule: a person with ANY personal permission
// row has exactly that set; only a person with none falls back to their role's defaults.
// `users.role` is the `user_role` enum, so it is cast to text before comparing with roles.name.
const CHAT_ENABLED_SQL = `(u.role IN ('Management','IT')
             OR EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission_key = 'chat.beta')
             OR (NOT EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id)
                 AND EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = u.role::text AND rp.permission_key = 'chat.beta')))`;

/**
 * The signed-in person, or null when they may not use the session any more. Same rules as the
 * CRM: approved, active, no open account lock, and the token not issued before
 * `sessions_valid_from` (compared to the whole second, like the CRM).
 */
export async function loadSessionUser(db, { userId, iat }) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.is_approved, u.is_active, u.sessions_valid_from, u.ip_restriction,
            (l.user_id IS NOT NULL) AS is_locked,
            ${CHAT_ENABLED_SQL} AS chat_enabled
       FROM public.users u
       LEFT JOIN account_locks l ON l.user_id = u.id AND l.unlocked_at IS NULL
      WHERE u.id = $1`,
    [userId],
  );
  if (!r || !r.is_approved || r.is_active === false || r.is_locked) return null;
  const validFrom = r.sessions_valid_from ? Math.floor(new Date(r.sessions_valid_from).getTime() / 1000) : null;
  if (validFrom !== null && iat !== null && iat < validFrom) return null;
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name || r.email,
    role: r.role,
    chatEnabled: !!r.chat_enabled,
    // Only for the sign-in check (services/session.service.js removes it before anyone else sees the person).
    ipRestriction: Array.isArray(r.ip_restriction) ? r.ip_restriction : [],
  };
}

/**
 * The people to pick from: everyone who can sign in, except `exceptUserId`, **who has signed in to the
 * chat at least once** (the owner's rule of 6 Oct 2026: people who never came in are not offered).
 * Signing in writes their row in chat.user_presence.
 */
export async function listActiveUsers(db, { exceptUserId }) {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.role, ${AVATAR_COLUMNS('u.id')}
       FROM public.users u WHERE u.is_approved = TRUE AND u.is_active IS NOT FALSE AND u.id <> $1
        AND EXISTS (SELECT 1 FROM chat.user_presence p WHERE p.user_id = u.id) ORDER BY u.full_name`,
    [exceptUserId],
  );
  return rows.map((u) => ({
    id: u.id,
    fullName: u.full_name || '',
    role: u.role,
    avatarUrl: avatarUrl(u.id, u.avatar_updated_at),
  }));
}

/**
 * The admin screen's people: everyone who can sign in (or, with `deactivated`, everyone who cannot: switched
 * off or never approved), with whether they can actually use the chat (an approved, active account, and the
 * `chat.beta` permission when `requireBeta`), when they last used the chat (null: never signed in), whether
 * they have notifications on, and their block counts.
 */
export async function listAdminUsers(db, { deactivated = false, requireBeta = true } = {}) {
  const { rows } = await db.query(`
    SELECT u.id, u.full_name, u.email, u.role::text AS role, u.is_active, u.is_approved,
           (u.is_approved = TRUE AND u.is_active IS NOT FALSE AND ${requireBeta ? CHAT_ENABLED_SQL : 'TRUE'}) AS chat_enabled,
           (SELECT p.last_seen_at FROM chat.user_presence p WHERE p.user_id = u.id) AS last_seen_at,
           EXISTS (SELECT 1 FROM chat.push_subscriptions ps WHERE ps.user_id = u.id) AS push_on,
           (SELECT count(DISTINCT x.target_user_id) FROM chat.communication_restrictions x WHERE x.user_id = u.id) AS blocked_from,
           (SELECT count(DISTINCT x.user_id) FROM chat.communication_restrictions x WHERE x.target_user_id = u.id) AS blocked_by
      FROM public.users u
     WHERE ${deactivated ? '(u.is_approved IS NOT TRUE OR u.is_active = FALSE)' : 'u.is_approved = TRUE AND u.is_active IS NOT FALSE'}
     ORDER BY u.full_name`);
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name || '',
    email: r.email || '',
    role: r.role,
    isActive: r.is_active !== false,
    isApproved: r.is_approved === true,
    chatEnabled: !!r.chat_enabled,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    pushOn: !!r.push_on,
    blockedFrom: Number(r.blocked_from || 0),
    blockedBy: Number(r.blocked_by || 0),
  }));
}

/**
 * Switches a person off (they are signed out everywhere at once and cannot sign in to the chat or the CRM
 * until switched on again) or on again (which also approves them). Null when there is no such person.
 */
export async function setUserActive(db, userId, active) {
  const {
    rows: [r],
  } = await db.query(
    `UPDATE public.users
        SET is_active = $2, is_approved = CASE WHEN $2 THEN TRUE ELSE is_approved END, sessions_valid_from = NOW()
      WHERE id = $1 RETURNING id, full_name, email, is_active`,
    [userId, active === true],
  );
  return r ? { id: r.id, fullName: r.full_name || '', email: r.email || '', isActive: r.is_active !== false } : null;
}

/** How many of these ids are real people (used to refuse a change that names someone unknown). */
export async function countUsers(db, userIds) {
  const { rows } = await db.query(`SELECT id FROM public.users WHERE id = ANY($1::int[])`, [userIds]);
  return rows.length;
}
