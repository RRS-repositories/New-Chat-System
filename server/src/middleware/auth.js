import { AuthError, verifySessionToken } from '../services/session.service.js';
import { loadSessionUser } from '../models/users.model.js';

const NOT_ENABLED = { success: false, code: 'chat_not_enabled', message: 'Team chat is not enabled for your account' };

export function bearerFrom(req) {
  const header = req.headers?.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/** Every /api/chat request: a valid CRM session, a person still allowed in, and (with `requireBeta`) chat switched on for them. */
export function requireAuth({ db, secret, aud, requireBeta = false }) {
  return async (req, res, next) => {
    try {
      const claims = verifySessionToken(bearerFrom(req), { secret, aud });
      const user = await loadSessionUser(db, claims);
      if (!user) return res.status(401).json({ success: false, message: 'Session ended — please sign in again', tokenError: 'token_invalid' });
      if (requireBeta && !user.chatEnabled) return res.status(403).json(NOT_ENABLED);
      req.user = user;
      next();
    } catch (e) {
      if (e instanceof AuthError) return res.status(401).json({ success: false, message: e.message, tokenError: e.code });
      next(e);
    }
  };
}

/** The same check for a live connection, at the handshake. */
export function socketAuth({ db, secret, aud, requireBeta = false }) {
  return async (socket, next) => {
    try {
      const claims = verifySessionToken(socket.handshake.auth?.token || '', { secret, aud });
      const user = await loadSessionUser(db, claims);
      if (!user) return next(new Error('token_invalid'));
      if (requireBeta && !user.chatEnabled) return next(new Error('chat_not_enabled'));
      socket.data.user = user;
      socket.data.iat = claims.iat;
      next();
    } catch (e) {
      next(new Error(e.code || 'token_invalid'));
    }
  };
}

/** Admin routes: Management only. */
export function requireManagement(req, res, next) {
  if (req.user?.role !== 'Management') {
    return res.status(403).json({ success: false, code: 'forbidden', message: 'Only Management can do this' });
  }
  next();
}
