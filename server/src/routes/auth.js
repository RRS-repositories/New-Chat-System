import { Router } from 'express';
import { wrap } from '../http-errors.js';

const LOGIN_TIMEOUT_MS = 10000;

// The standalone site signs in against the CRM. We forward the credentials
// server-side so the browser only ever talks to chat2. The CRM's reply is
// returned as-is (token + user), minus the Mattermost token nobody here needs.
// The real client IP travels with the request: the CRM's login rate limiter
// keys on CF-Connecting-IP / X-Forwarded-For, and without it every chat2
// sign-in would share one key (the proxy's own address).
export function createAuthRoutes({ crmInternalUrl, fetchImpl = fetch }) {
  const r = Router();
  r.post('/login', wrap(async (req, res) => {
    const { email, password, captchaToken, captchaAnswer } = req.body || {};
    const clientIp = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), LOGIN_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetchImpl(`${crmInternalUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': clientIp, 'X-Forwarded-For': clientIp, 'User-Agent': String(req.headers['user-agent'] || 'chat2') },
        body: JSON.stringify({ email, password, captchaToken, captchaAnswer }),
        signal: ac.signal,
      });
    } catch (e) {
      return res.status(503).json({ success: false, message: 'Login service unavailable — please try again' });
    } finally { clearTimeout(t); }
    const body = await upstream.json().catch(() => ({ success: false, message: 'Login service unavailable' }));
    if (body && typeof body === 'object') delete body.mattermostToken;
    res.status(upstream.status).json(body);
  }));
  return r;
}
