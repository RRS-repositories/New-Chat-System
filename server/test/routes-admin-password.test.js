// Management or IT set a person's password: the chat forwards to the CRM with the caller's own
// session and hands back the CRM's answer. Also: the people list is open to IT, the rest is not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createTestDb } from './pg-helper.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
// Users from the helper: 1 Meg Manager (Management), 2 Ann Agent (cs_agent), 3 Bob Sales. Added here: 6 Ivy IT.
await db.query(`INSERT INTO users (email, full_name, role) VALUES ('ivy@x', 'Ivy IT', 'IT')`);
const calls = [];
let crm = { status: 200, body: { success: true, message: 'Password set for Bob Sales.' } };
const fetchImpl = async (url, init) => {
  calls.push({ url, init });
  return {
    status: crm.status,
    async json() {
      return crm.body;
    },
  };
};
const emit = {
  toChannel() {},
  toUser() {},
  toSocket() {},
  toAll() {},
  userOfSocket: () => null,
  joinRoom() {},
  leaveRoom() {},
};
const config = {
  sessionSecret: secret,
  sessionAud: aud,
  corsOrigins: [],
  requireBeta: false,
  crmInternalUrl: 'http://crm.local',
};
const app = createApp({ config, db, emit, fetchImpl });
after(() => close());
const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const put = (id, target, body) =>
  request(app).put(`/api/chat/admin/users/${target}/password`).set('Authorization', auth(id)).send(body);

test('Management set a password: the CRM is asked with the caller’s session, and its answer comes back', async () => {
  calls.length = 0;
  const r = await put(1, 3, { password: 'Correct-Horse-9', confirmPassword: 'Correct-Horse-9' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { success: true, message: 'Password set for Bob Sales.' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://crm.local/api/users/3/password');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, auth(1), 'the caller’s own session goes to the CRM');
  assert.deepEqual(JSON.parse(calls[0].init.body), { password: 'Correct-Horse-9', confirmPassword: 'Correct-Horse-9' });
});

test('IT may too; anyone else may not, and the CRM is never asked for them', async () => {
  calls.length = 0;
  assert.equal((await put(6, 3, { password: 'x', confirmPassword: 'x' })).status, 200);
  assert.equal(calls.length, 1);
  for (const id of [2, 3]) {
    const r = await put(id, 1, { password: 'x', confirmPassword: 'x' });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'forbidden');
  }
  assert.equal(calls.length, 1);
});

test('the CRM’s refusals come back as they are; a CRM without the route is explained; nobody sets their own here', async () => {
  crm = { status: 400, body: { success: false, message: 'Password must be at least 8 characters' } };
  const short = await put(1, 3, { password: 'x', confirmPassword: 'x' });
  assert.equal(short.status, 400);
  assert.equal(short.body.message, 'Password must be at least 8 characters');
  crm = { status: 404, body: {} };
  const missing = await put(1, 3, { password: 'Correct-Horse-9', confirmPassword: 'Correct-Horse-9' });
  assert.equal(missing.status, 503);
  assert.match(missing.body.message, /does not offer this yet/);
  crm = { status: 200, body: { success: true, message: 'ok' } };
  const own = await put(1, 1, { password: 'Correct-Horse-9', confirmPassword: 'Correct-Horse-9' });
  assert.equal(own.status, 400);
  assert.equal(own.body.code, 'own_password');
  assert.equal((await put(1, 'abc', { password: 'x', confirmPassword: 'x' })).status, 404);
});

test('the people list is open to Management and IT and says who has never signed in; the rest of admin is Management only', async () => {
  await db.query(`INSERT INTO chat.user_presence (user_id, last_seen_at) VALUES (3, now()) ON CONFLICT DO NOTHING`);
  for (const id of [1, 6]) {
    const r = await request(app).get('/api/chat/admin/users').set('Authorization', auth(id));
    assert.equal(r.status, 200);
    const bob = r.body.users.find((u) => u.id === 3);
    const ann = r.body.users.find((u) => u.id === 2);
    assert.equal(typeof bob.lastSeenAt, 'string');
    assert.equal(ann.lastSeenAt, null, 'never signed in');
  }
  assert.equal((await request(app).get('/api/chat/admin/users').set('Authorization', auth(3))).status, 403);
  assert.equal(
    (await request(app).get('/api/chat/admin/restrictions').set('Authorization', auth(6))).status,
    403,
    'IT: no restrictions',
  );
});

test('the pick-from list offers only people who have signed in to the chat', async () => {
  const r = await request(app).get('/api/chat/users').set('Authorization', auth(1));
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.users.map((u) => u.id),
    [3],
    'Bob has signed in (presence row); Ann and Ivy never have',
  );
});
