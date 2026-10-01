// Sliding window per user, in memory (one process). §13: 1 message/sec/user.
export function perUserLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map(); // userId -> [timestamps]
  return (req, res, next) => {
    const key = req.user?.id ?? 'anon';
    const t = now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return res.status(429).json({ success: false, message: 'Slow down', retryAfterMs: windowMs - (t - arr[0]) });
    }
    arr.push(t);
    hits.set(key, arr);
    next();
  };
}
