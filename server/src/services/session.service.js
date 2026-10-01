import jwt from 'jsonwebtoken';

/** A sign-in problem. `code` is one of token_missing, token_invalid, token_expired. */
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
    throw new AuthError(expired ? 'token_expired' : 'token_invalid', expired ? 'Session expired — please sign in again' : 'Not authenticated');
  }
}
