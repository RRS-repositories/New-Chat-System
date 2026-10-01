import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { requireAuth, socketAuth } from '../src/middleware/auth.js';
import { verifySessionToken } from '../src/services/session.service.js';
import { loadSessionUser } from '../src/models/users.model.js';

const secret = 's'.repeat(40),
  aud = 'rrs-crm-session';
const sign = (payload, opts = {}) => jwt.sign({ aud, ...payload }, secret, { expiresIn: '1h', ...opts });
const row = {
  id: 7,
  email: 'a@b.c',
  full_name: 'Ann Agent',
  role: 'cs_agent',
  is_approved: true,
  is_active: true,
  sessions_valid_from: null,
};
const dbWith = (r) => ({
  async query() {
    return { rows: r ? [r] : [] };
  },
});
const res = () => {
  const r = {
    code: 0,
    body: null,
    status(c) {
      r.code = c;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
  };
  return r;
};

test('a CRM-signed token yields the integer user id and iat', () => {
  const out = verifySessionToken(sign({ sub: 7 }), { secret, aud });
  assert.equal(out.userId, 7);
  assert.equal(typeof out.iat, 'number');
});

test('wrong secret, wrong audience, expired and missing tokens are coded errors', () => {
  assert.throws(() => verifySessionToken(jwt.sign({ sub: 7, aud }, 'other'.repeat(8)), { secret, aud }), {
    code: 'token_invalid',
  });
  assert.throws(() => verifySessionToken(jwt.sign({ sub: 7, aud: 'x' }, secret), { secret, aud }), {
    code: 'token_invalid',
  });
  assert.throws(() => verifySessionToken(sign({ sub: 7 }, { expiresIn: -10 }), { secret, aud }), {
    code: 'token_expired',
  });
  assert.throws(() => verifySessionToken('', { secret, aud }), { code: 'token_missing' });
});

test('loadSessionUser maps the row and hides sessions_valid_from', async () => {
  const u = await loadSessionUser(dbWith(row), { userId: 7, iat: Math.floor(Date.now() / 1000) });
  assert.deepEqual(u, {
    id: 7,
    email: 'a@b.c',
    fullName: 'Ann Agent',
    role: 'cs_agent',
    chatEnabled: false,
    ipRestriction: [],
  });
});

test('loadSessionUser maps chatEnabled from the row, defaulting false when the column is absent', async () => {
  const iat = Math.floor(Date.now() / 1000);
  assert.equal((await loadSessionUser(dbWith(row), { userId: 7, iat })).chatEnabled, false, 'column absent');
  assert.equal((await loadSessionUser(dbWith({ ...row, chat_enabled: false }), { userId: 7, iat })).chatEnabled, false);
  assert.equal((await loadSessionUser(dbWith({ ...row, chat_enabled: true }), { userId: 7, iat })).chatEnabled, true);
});

test('revoked: token issued before sessions_valid_from is dead (mirrors the CRM)', async () => {
  const r = { ...row, sessions_valid_from: new Date(Date.now() - 60_000).toISOString() };
  assert.equal(await loadSessionUser(dbWith(r), { userId: 7, iat: Math.floor(Date.now() / 1000) - 3600 }), null);
  assert.ok(await loadSessionUser(dbWith(r), { userId: 7, iat: Math.floor(Date.now() / 1000) }));
});

test('not approved, inactive and unknown users are not users', async () => {
  const iat = Math.floor(Date.now() / 1000);
  assert.equal(await loadSessionUser(dbWith({ ...row, is_approved: false }), { userId: 7, iat }), null);
  assert.equal(await loadSessionUser(dbWith({ ...row, is_active: false }), { userId: 7, iat }), null);
  assert.equal(await loadSessionUser(dbWith(null), { userId: 7, iat }), null);
});

test('requireAuth: 401 without a bearer, req.user with one', async () => {
  const mw = requireAuth({ db: dbWith(row), secret, aud });
  let r = res();
  let called = false;
  await mw({ headers: {} }, r, () => {
    called = true;
  });
  assert.equal(r.code, 401);
  assert.equal(called, false);
  assert.equal(r.body.tokenError, 'token_missing');
  r = res();
  const req = { headers: { authorization: `Bearer ${sign({ sub: 7 })}` } };
  await mw(req, r, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.user.id, 7);
});

test('an open account lock authenticates nothing (mirrors the CRM)', async () => {
  const iat = Math.floor(Date.now() / 1000);
  assert.equal(await loadSessionUser(dbWith({ ...row, is_locked: true }), { userId: 7, iat }), null);
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      return { rows: [row] };
    },
  };
  await loadSessionUser(db, { userId: 7, iat });
  assert.match(seen[0], /LEFT JOIN account_locks l ON l\.user_id = u\.id AND l\.unlocked_at IS NULL/);
});

test('requireAuth: requireBeta true + chat_enabled false -> 403 chat_not_enabled (not 401)', async () => {
  const mw = requireAuth({ db: dbWith({ ...row, chat_enabled: false }), secret, aud, requireBeta: true });
  const r = res();
  let called = false;
  const req = { headers: { authorization: `Bearer ${sign({ sub: 7 })}` } };
  await mw(req, r, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(r.code, 403);
  assert.deepEqual(r.body, {
    success: false,
    code: 'chat_not_enabled',
    message: 'Team chat is not enabled for your account',
  });
});

test('requireAuth: requireBeta true + Management (chat_enabled true regardless of a permission row) -> allowed', async () => {
  const mw = requireAuth({
    db: dbWith({ ...row, role: 'Management', chat_enabled: true }),
    secret,
    aud,
    requireBeta: true,
  });
  const r = res();
  let called = false;
  const req = { headers: { authorization: `Bearer ${sign({ sub: 7 })}` } };
  await mw(req, r, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.user.role, 'Management');
});

test('requireAuth: requireBeta false (default) ignores chatEnabled entirely', async () => {
  const mw = requireAuth({ db: dbWith({ ...row, chat_enabled: false }), secret, aud });
  const r = res();
  let called = false;
  const req = { headers: { authorization: `Bearer ${sign({ sub: 7 })}` } };
  await mw(req, r, () => {
    called = true;
  });
  assert.equal(called, true);
});

test('socketAuth: requireBeta true + chat_enabled false -> next(chat_not_enabled)', async () => {
  const mw = socketAuth({ db: dbWith({ ...row, chat_enabled: false }), secret, aud, requireBeta: true });
  const socket = { handshake: { auth: { token: sign({ sub: 7 }) } }, data: {} };
  let err;
  await mw(socket, (e) => {
    err = e;
  });
  assert.equal(err?.message, 'chat_not_enabled');
});

test('socketAuth: requireBeta true + chat_enabled true -> next() with no error, user attached', async () => {
  const mw = socketAuth({ db: dbWith({ ...row, chat_enabled: true }), secret, aud, requireBeta: true });
  const socket = { handshake: { auth: { token: sign({ sub: 7 }) } }, data: {} };
  let err;
  await mw(socket, (e) => {
    err = e;
  });
  assert.equal(err, undefined);
  assert.equal(socket.data.user.id, 7);
});
