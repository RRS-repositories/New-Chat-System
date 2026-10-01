import { Router } from 'express';
import { httpError, wrap } from '../http-errors.js';
import { saveSubscription, removeSubscription } from '../repo/push.js';

const MAX_ENDPOINT = 2000, MAX_KEY = 300, MAX_UA = 300;
const BAD = 'That push subscription is not valid';

const isKey = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_KEY;
// The server POSTs to the endpoint, so it must name a public host: no IP literals (the URL
// parser already normalises forms like https://2130706433/ to 127.0.0.1), no localhost, no
// single-label intranet names. Any other https host is allowed (no vendor allow-list).
function publicHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h.startsWith('[') || h.includes(':')) return false;          // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;                  // IPv4 literal
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  return h.includes('.');
}
function validEndpoint(v) {
  if (typeof v !== 'string' || !v || v.length > MAX_ENDPOINT) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && publicHost(u.hostname); } catch { return false; }
}

/** /key, /subscribe, /unsubscribe — mounted at /api/chat/push (behind auth). */
export function createPushRoutes({ db, config }) {
  const r = Router();

  r.get('/key', (_req, res) => {
    const key = config?.vapidPublic && config?.vapidPrivate ? config.vapidPublic : null;
    res.json({ success: true, key });
  });

  r.post('/subscribe', wrap(async (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!validEndpoint(endpoint) || !keys || typeof keys !== 'object' || !isKey(keys.p256dh) || !isKey(keys.auth)) {
      throw httpError(400, 'bad_subscription', BAD);
    }
    const userAgent = String(req.get('user-agent') || '').slice(0, MAX_UA);
    await saveSubscription(db, { userId: req.user.id, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, userAgent });
    res.json({ success: true });
  }));

  r.post('/unsubscribe', wrap(async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint || endpoint.length > MAX_ENDPOINT) throw httpError(400, 'bad_subscription', BAD);
    await removeSubscription(db, { userId: req.user.id, endpoint });
    res.json({ success: true });
  }));

  return r;
}
