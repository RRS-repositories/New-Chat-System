import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perUserLimiter } from '../src/rate-limit.js';

function run(mw, userId) {
  const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  let next = false; mw({ user: { id: userId } }, r, () => { next = true; });
  return { next, code: r.code, body: r.body };
}

test('one message per second per user; second user unaffected', () => {
  let t = 1000; const mw = perUserLimiter({ windowMs: 1000, max: 1, now: () => t });
  assert.equal(run(mw, 1).next, true);
  const blocked = run(mw, 1); assert.equal(blocked.code, 429); assert.equal(blocked.body.retryAfterMs, 1000);
  assert.equal(run(mw, 2).next, true);
  t = 2001; assert.equal(run(mw, 1).next, true);
});
