// Management switch a person off and on: signed out at once, out of every list and conversation, back on again later.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createTestDb } from './pg-helper.js';
import { openDm, listChannelsForUser } from '../src/models/channels.model.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
// Users from the helper: 1 Meg Manager (Management), 2 Ann Agent, 3 Bob Sales. Added: 6 Ivy IT.
await db.query(`INSERT INTO users (email, full_name, role) VALUES ('ivy@x', 'Ivy IT', 'IT')`);
await db.query(
  `INSERT INTO chat.user_presence (user_id, last_seen_at) VALUES (2, now()), (3, now()) ON CONFLICT DO NOTHING`,
);
const events = [];
const emit = {
  toChannel() {},
  toUser: (id, ev, p) => events.push({ id, ev, p }),
  toSocket() {},
  toAll() {},
  userOfSocket: () => null,
  joinRoom() {},
  leaveRoom() {},
};
const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false };
const app = createApp({ config, db, emit });
after(() => close());
const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const as = (id) => ({
  get: (path) => request(app).get(`/api/chat${path}`).set('Authorization', auth(id)),
  post: (path, body = {}) => request(app).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body),
});
const dm = await openDm(db, 1, 3);

test('deactivating: signed out everywhere now, cannot use the chat, gone from pickers and conversations, listed under Deactivated', async () => {
  assert.ok(
    (await listChannelsForUser(db, 1)).some((c) => c.id === dm.id),
    'the conversation with Bob is listed first',
  );
  events.length = 0;
  const r = await as(1).post('/admin/users/3/deactivate');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.isActive, false);
  assert.deepEqual(events, [{ id: 3, ev: 'session_ended', p: { reason: 'deactivated' } }]);
  // Bob's token no longer works: the session check refuses an inactive account.
  assert.equal((await as(3).get('/channels')).status, 401);
  // He is out of the pick list and the conversation with him is out of sight.
  assert.ok(!(await as(1).get('/users')).body.users.some((u) => u.id === 3));
  assert.ok(!(await listChannelsForUser(db, 1)).some((c) => c.id === dm.id));
  const list = (await as(1).get('/admin/users')).body;
  assert.equal(list.gate, false, 'the list says the permission gate is off');
  const active = list.users;
  const gone = (await as(1).get('/admin/users?deactivated=1')).body.users;
  assert.ok(!active.some((u) => u.id === 3) && gone.some((u) => u.id === 3 && u.isActive === false));
  assert.equal(gone.find((u) => u.id === 3).chatEnabled, false, 'a switched-off person shows chat access Off');
  assert.ok(
    active.every((u) => u.chatEnabled),
    'gate off: everyone who can sign in shows On',
  );
  const audit = await db.query(
    `SELECT action, actor_id, target_id FROM chat.audit_log WHERE action = 'user.deactivate'`,
  );
  assert.deepEqual(audit.rows, [{ action: 'user.deactivate', actor_id: 1, target_id: '3' }]);
});

test('reactivating brings them back; an unapproved account counts as deactivated and is approved by reactivating', async () => {
  const r = await as(1).post('/admin/users/3/reactivate');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.isActive, true);
  assert.ok((await as(1).get('/users')).body.users.some((u) => u.id === 3));
  assert.ok((await listChannelsForUser(db, 1)).some((c) => c.id === dm.id));
  await db.query(`UPDATE users SET is_approved = FALSE WHERE id = 2`);
  assert.ok(
    (await as(1).get('/admin/users?deactivated=1')).body.users.some((u) => u.id === 2 && u.isApproved === false),
  );
  await as(1).post('/admin/users/2/reactivate');
  assert.equal((await db.query(`SELECT is_approved FROM users WHERE id = 2`)).rows[0].is_approved, true);
});

test('only Management may; nobody deactivates themselves', async () => {
  assert.equal((await as(6).post('/admin/users/3/deactivate')).status, 403, 'IT may not');
  assert.equal((await as(2).post('/admin/users/3/deactivate')).status, 403);
  const self = await as(1).post('/admin/users/1/deactivate');
  assert.equal(self.status, 400);
  assert.equal(self.body.code, 'own_account');
  assert.equal((await as(1).post('/admin/users/999999/deactivate')).status, 404);
});
