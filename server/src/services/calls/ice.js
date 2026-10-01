// ICE servers for a call: free public STUN plus our own coturn relay. coturn runs with
// `use-auth-secret`: username = <unixExpiry>:<userId>, credential = base64(HMAC-SHA1(secret, username)),
// so no per-user TURN accounts exist and a leaked credential dies at its expiry.
import { createHmac } from 'node:crypto';

const DEFAULT_TTL_SECS = 43200;
const asList = (v) =>
  Array.isArray(v)
    ? v.filter(Boolean)
    : String(v || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

/** `now` is a clock function or a millisecond timestamp (defaults to Date.now). */
export function buildIceServers({ config = {}, userId, now = Date.now } = {}) {
  const nowMs = typeof now === 'function' ? now() : Number(now ?? Date.now());
  const stunUrls = asList(config.stunUrls);
  const turnUrls = asList(config.turnUrls);
  const secret = config.turnSecret || '';
  const ttl = Number(config.turnTtlSecs) > 0 ? Number(config.turnTtlSecs) : DEFAULT_TTL_SECS;
  const out = [];
  if (stunUrls.length) out.push({ urls: stunUrls });
  if (turnUrls.length && secret) {
    const username = `${Math.floor(nowMs / 1000) + ttl}:${userId}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    out.push({ urls: turnUrls, username, credential });
  }
  return out;
}
