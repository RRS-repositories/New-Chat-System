import jwt from 'jsonwebtoken';
import { loadSessionUser } from '../models/users.model.js';
import { ipAllowedBy } from '../utils/ipRestriction.js';

/** A sign-in problem. `code` is one of token_missing, token_invalid, token_expired, ip_not_allowed. */
export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
    this.status = 401;
  }
}

/** Checks a CRM session token and returns who it belongs to and when it was issued. */
export function verifySessionToken(token, { secret, aud }) {
  if (!token) throw new AuthError('token_missing', 'Not authenticated');
  try {
    const payload = jwt.verify(token, secret, { audience: aud });
    const userId = parseInt(payload.sub, 10);
    if (!Number.isFinite(userId) || userId <= 0) throw new AuthError('token_invalid', 'Bad subject');
    return { userId, iat: Number.isFinite(payload.iat) ? payload.iat : null };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    const expired = e.name === 'TokenExpiredError';
    throw new AuthError(
      expired ? 'token_expired' : 'token_invalid',
      expired ? 'Session expired — please sign in again' : 'Not authenticated',
    );
  }
}

export const IP_REFUSED_MESSAGE =
  'Access from this network is not allowed for your account. Ask a manager to check your access settings.';

/**
 * The signed-in person for these token claims, or null when the session is no longer good.
 * Applies the per-person IP restriction the CRM also applies: a person limited to certain
 * addresses is refused from anywhere else (AuthError `ip_not_allowed`).
 * `enforceIp: false` (setting IP_RESTRICTION_ENFORCE=false) only logs what would be refused.
 */
export async function sessionUser({ db, claims, ip, enforceIp = true, log = console.warn }) {
  const found = await loadSessionUser(db, claims);
  if (!found) return null;
  const { ipRestriction, ...user } = found;
  if (!ipAllowedBy(ipRestriction, ip)) {
    log(
      `[chat] ip restriction: ${enforceIp ? 'refused' : 'would refuse'} user #${user.id} from ${ip || 'an unknown address'}`,
    );
    if (enforceIp) throw new AuthError('ip_not_allowed', IP_REFUSED_MESSAGE);
  }
  return user;
}
