// People sign in with their CRM email and password. The credentials are forwarded to the CRM
// server-side, so the browser only ever talks to the chat site, and chat stores no passwords.
const LOGIN_TIMEOUT_MS = 10000;
const UNAVAILABLE = { status: 503, body: { success: false, message: 'Login service unavailable — please try again' } };

/**
 * Forwards a sign-in to the CRM and returns its answer as `{ status, body }`.
 * The real client address travels with the request: the CRM limits sign-in attempts per address,
 * and without it every chat sign-in would share one address (the proxy's own).
 */
export async function forwardLogin({ crmInternalUrl, fetchImpl = fetch }, { credentials, clientIp, userAgent }) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), LOGIN_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetchImpl(`${crmInternalUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': clientIp,
        'X-Forwarded-For': clientIp,
        'User-Agent': userAgent,
      },
      body: JSON.stringify(credentials),
      signal: abort.signal,
    });
  } catch {
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
  const body = await upstream.json().catch(() => ({ success: false, message: 'Login service unavailable' }));
  // The CRM's reply (token + user) is passed on as-is, minus the Mattermost token nobody here needs.
  if (body && typeof body === 'object') delete body.mattermostToken;
  return { status: upstream.status, body };
}
