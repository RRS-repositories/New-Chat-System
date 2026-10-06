// Management or IT set a person's password. The CRM owns passwords, so the request is forwarded
// to it with the caller's own session (the chat's session token is the CRM's), and the CRM applies
// its password rules, signs the person out everywhere and writes its audit. Chat stores nothing.
const TIMEOUT_MS = 10000;
const UNAVAILABLE = {
  status: 503,
  body: { success: false, message: 'The CRM could not be reached. Try again in a moment.' },
};
const NOT_OFFERED = {
  status: 503,
  body: { success: false, message: 'The CRM does not offer this yet. It needs the CRM update that adds it.' },
};

/** Forwards the change to the CRM and returns its answer as `{ status, body }`. */
export async function forwardSetPassword(
  { crmInternalUrl, fetchImpl = fetch },
  { userId, token, password, confirmPassword, clientIp },
) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetchImpl(`${crmInternalUrl}/api/users/${encodeURIComponent(userId)}/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': clientIp,
        'X-Forwarded-For': clientIp,
      },
      body: JSON.stringify({ password, confirmPassword }),
      signal: abort.signal,
    });
  } catch {
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
  if (upstream.status === 404) return NOT_OFFERED; // a CRM without the route answers 404 for the path itself
  const body = await upstream.json().catch(() => ({ success: false, message: 'The CRM gave no answer' }));
  return { status: upstream.status, body: { success: body?.success === true, message: body?.message || '' } };
}
