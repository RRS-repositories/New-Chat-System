import jwt from 'jsonwebtoken';

export class AuthError extends Error {
  constructor(code, message) { super(message || code); this.code = code; this.status = 401; }
}

export function verifySessionToken(token, { secret, aud }) {
  if (!token) throw new AuthError('token_missing', 'Not authenticated');
  try {
    const p = jwt.verify(token, secret, { audience: aud });
    const userId = parseInt(p.sub, 10);
    if (!Number.isFinite(userId) || userId <= 0) throw new AuthError('token_invalid', 'Bad subject');
    return { userId, iat: Number.isFinite(p.iat) ? p.iat : null };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError(e.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid',
      e.name === 'TokenExpiredError' ? 'Session expired — please sign in again' : 'Not authenticated');
  }
}

// Same rules as the CRM's attachUser: approved, active, no open account lock,
// and not revoked by sessions_valid_from (compared whole-second, like the CRM).
// chat_enabled is computed in SQL: Management/IT pass by role, everyone else
// needs the chat.beta permission key. Mirrors the CRM's loadUserPermissions: a user with ANY
// user_permissions row has exactly that set; only a user with none gets their role's defaults.
// users.role is the user_role enum in the CRM, so it is cast to text before comparing with roles.name.
export async function loadSessionUser(db, { userId, iat }) {
  const { rows: [r] } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.is_approved, u.is_active, u.sessions_valid_from,
            (l.user_id IS NOT NULL) AS is_locked,
            (u.role IN ('Management','IT')
             OR EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission_key = 'chat.beta')
             OR (NOT EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id)
                 AND EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = u.role::text AND rp.permission_key = 'chat.beta'))) AS chat_enabled
       FROM public.users u
       LEFT JOIN account_locks l ON l.user_id = u.id AND l.unlocked_at IS NULL
      WHERE u.id = $1`, [userId]);
  if (!r || !r.is_approved || r.is_active === false || r.is_locked) return null;
  const validFrom = r.sessions_valid_from ? Math.floor(new Date(r.sessions_valid_from).getTime() / 1000) : null;
  if (validFrom !== null && iat !== null && iat < validFrom) return null;
  return { id: r.id, email: r.email, fullName: r.full_name || r.email, role: r.role, chatEnabled: !!r.chat_enabled };
}

export function bearerFrom(req) {
  const h = req.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

export function requireAuth({ db, secret, aud, requireBeta = false }) {
  return async (req, res, next) => {
    try {
      const claims = verifySessionToken(bearerFrom(req), { secret, aud });
      const user = await loadSessionUser(db, claims);
      if (!user) return res.status(401).json({ success: false, message: 'Session ended — please sign in again', tokenError: 'token_invalid' });
      if (requireBeta && !user.chatEnabled) {
        return res.status(403).json({ success: false, code: 'chat_not_enabled', message: 'Team chat is not enabled for your account' });
      }
      req.user = user;
      next();
    } catch (e) {
      if (e instanceof AuthError) return res.status(401).json({ success: false, message: e.message, tokenError: e.code });
      next(e);
    }
  };
}

export function socketAuth({ db, secret, aud, requireBeta = false }) {
  return async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || '';
      const claims = verifySessionToken(token, { secret, aud });
      const user = await loadSessionUser(db, claims);
      if (!user) return next(new Error('token_invalid'));
      if (requireBeta && !user.chatEnabled) return next(new Error('chat_not_enabled'));
      socket.data.user = user;
      socket.data.iat = claims.iat;
      next();
    } catch (e) { next(new Error(e.code || 'token_invalid')); }
  };
}
