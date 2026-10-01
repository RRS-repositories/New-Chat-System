export const httpError = (status, code, message) => Object.assign(new Error(message || code), { status, code });
export function sendError(res, err) {
  const status = err.status || (err.code === 'empty' || err.code === 'too_long' ? 400 : 500);
  if (status >= 500) console.error('[chat] error', err);
  res.status(status).json({ success: false, code: err.code || 'error', message: status >= 500 ? 'Something went wrong' : err.message });
}
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => sendError(res, e));
