import crypto from 'node:crypto';

/**
 * Sends a button press or a typed reply to the CRM's compliance receiver
 * (POST /api/compliance/chat/event, on the same machine). Signed so the CRM knows it came
 * from here: hex HMAC-SHA256(secret, `${timestamp}.${nonce}.${body}`), timestamp in ms,
 * a fresh nonce each time so a copy cannot be replayed. No secret = off, nothing is sent.
 */
export function createCrmEvents({ crmUrl, secret, fetchImpl = fetch, now = Date.now }) {
  return async function sendEvent(body) {
    if (!secret) return { ok: false, status: 0 };
    const raw = JSON.stringify(body);
    const ts = String(now());
    const nonce = crypto.randomBytes(16).toString('hex');
    const signature = crypto.createHmac('sha256', secret).update(`${ts}.${nonce}.${raw}`).digest('hex');
    const res = await fetchImpl(`${crmUrl}/api/compliance/chat/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-chat-timestamp': ts,
        'x-chat-nonce': nonce,
        'x-chat-signature': signature,
      },
      body: raw,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  };
}
