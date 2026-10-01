/** An error the client should see: HTTP status, a short code, a readable message. */
export const httpError = (status, code, message) => Object.assign(new Error(message || code), { status, code });

/** The one place an error becomes an HTTP answer: `{ success: false, code, message }`. */
export function sendError(res, err) {
  const status = err.status || (err.code === 'empty' || err.code === 'too_long' ? 400 : 500);
  if (status >= 500) console.error('[chat] error', err);
  res
    .status(status)
    .json({ success: false, code: err.code || 'error', message: status >= 500 ? 'Something went wrong' : err.message });
}

/** Wraps an async handler so a thrown error is answered by `sendError` instead of crashing the request. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => sendError(res, e));
