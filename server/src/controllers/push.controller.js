import { httpError, wrap } from '../middleware/errors.js';
import { saveSubscription, removeSubscription } from '../models/push.model.js';
import { isPushEndpoint, isEndpointString, isPushKey } from '../utils/validators.js';

const MAX_USER_AGENT = 300;
const invalid = () => httpError(400, 'bad_subscription', 'That push subscription is not valid');

export function createPushController({ db, config }) {
  return {
    /** The public key browsers need to subscribe, or null when push is not set up. */
    key: (_req, res) => {
      const key = config?.vapidPublic && config?.vapidPrivate ? config.vapidPublic : null;
      res.json({ success: true, key });
    },

    subscribe: wrap(async (req, res) => {
      const { endpoint, keys } = req.body || {};
      if (!isPushEndpoint(endpoint) || !keys || typeof keys !== 'object' || !isPushKey(keys.p256dh) || !isPushKey(keys.auth)) throw invalid();
      const userAgent = String(req.get('user-agent') || '').slice(0, MAX_USER_AGENT);
      await saveSubscription(db, { userId: req.user.id, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, userAgent });
      res.json({ success: true });
    }),

    unsubscribe: wrap(async (req, res) => {
      const endpoint = req.body?.endpoint;
      if (!isEndpointString(endpoint)) throw invalid();
      await removeSubscription(db, { userId: req.user.id, endpoint });
      res.json({ success: true });
    }),
  };
}
