// The Task 1 HTTP routes through the real app (mount order, auth) on a real database (PGlite).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';
import { createTestDb } from './pg-helper.js';
import { token, secret } from './route-helper.js';

const { db, close } = await createTestDb();
after(() => close());

const config = {
  ...loadConfig({
    DB_HOST: 'h',
    DB_NAME: 'n',
    DB_USER: 'u',
    DB_PASSWORD: 'p',
    SESSION_JWT_SECRET: secret,
    CHAT_REQUIRE_BETA: 'false',
  }),
  uiDist: '/nonexistent',
  uiDistCrm: '/nonexistent',
};
const emitted = [];
const emit = {
  toChannel() {},
  toUser() {},
  joinRoom() {},
  leaveRoom() {},
  toSocket() {},
  toAll: (e, p) => emitted.push([e, p]),
  userOfSocket: () => null,
};
let snap = { online: [], away: [] };
const presence = {
  snapshot: () => snap,
  isConnected: () => false,
  socketsOf: () => [],
  connect: () => ({ first: false }),
  disconnect() {},
  setAway: () => ({ changed: false, away: false }),
};
const app = createApp({
  config,
  db,
  emit,
  presence,
  fetchImpl: async () => ({
    status: 503,
    async json() {
      return {};
    },
  }),
});
const as = (id) => ({ Authorization: token(id) });
const {
  rows: [general],
} = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);

beforeEach(async () => {
  emitted.length = 0;
  snap = { online: [], away: [] };
  await db.query(`DELETE FROM chat.user_preferences`);
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'default'`);
});

test('all Task 1 routes need a session', async () => {
  for (const [m, p] of [
    ['get', '/api/chat/users/online'],
    ['get', '/api/chat/users/me/preferences'],
    ['patch', '/api/chat/users/me/preferences'],
    ['patch', '/api/chat/users/me/status'],
    ['patch', `/api/chat/channels/${general.id}/notify`],
  ]) {
    assert.equal((await request(app)[m](p)).status, 401, `${m} ${p}`);
  }
});

test('GET /users/online: the registry snapshot plus non-empty statuses', async () => {
  snap = { online: [1, 2], away: [3] };
  await request(app)
    .patch('/api/chat/users/me/status')
    .set(as(2))
    .send({ statusText: 'On a call', statusEmoji: '📞' })
    .expect(200);
  await request(app).patch('/api/chat/users/me/preferences').set(as(3)).send({ soundEnabled: false }).expect(200);
  const r = await request(app).get('/api/chat/users/online').set(as(1));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    success: true,
    online: [1, 2],
    away: [3],
    statuses: { 2: { text: 'On a call', emoji: '📞' } },
  });
});

test('GET /users/me/preferences returns the defaults when there is no row', async () => {
  const r = await request(app).get('/api/chat/users/me/preferences').set(as(2));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    success: true,
    preferences: {
      desktopNotif: 'mentions',
      mobileNotif: 'mentions',
      soundEnabled: true,
      sendOnEnter: true,
      statusText: '',
      statusEmoji: '',
      theme: null,
    },
  });
});

test('PATCH /users/me/preferences saves a subset, ignores unknown keys, and is per user', async () => {
  const r = await request(app)
    .patch('/api/chat/users/me/preferences')
    .set(as(2))
    .send({ desktopNotif: 'all', sendOnEnter: false, colour: 'dark', userId: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    success: true,
    preferences: {
      desktopNotif: 'all',
      mobileNotif: 'mentions',
      soundEnabled: true,
      sendOnEnter: false,
      statusText: '',
      statusEmoji: '',
      theme: null,
    },
  });
  const again = await request(app).get('/api/chat/users/me/preferences').set(as(2));
  assert.equal(again.body.preferences.desktopNotif, 'all');
  assert.equal(
    (await request(app).get('/api/chat/users/me/preferences').set(as(3))).body.preferences.desktopNotif,
    'mentions',
  );
});

test('PATCH /users/me/preferences with a bad value is 400 bad_preference and saves nothing', async () => {
  for (const body of [{ desktopNotif: 'always' }, { mobileNotif: '' }, { soundEnabled: 'false' }, { sendOnEnter: 1 }]) {
    const r = await request(app).patch('/api/chat/users/me/preferences').set(as(2)).send(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, 'bad_preference');
    assert.ok(r.body.message);
  }
  const { rows } = await db.query(`SELECT 1 FROM chat.user_preferences WHERE user_id = 2`);
  assert.equal(rows.length, 0);
});

test('PATCH /users/me/status trims, saves, and broadcasts user_status', async () => {
  const r = await request(app)
    .patch('/api/chat/users/me/status')
    .set(as(2))
    .send({ statusText: '  Lunch ', statusEmoji: '🍔' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { success: true, status: { text: 'Lunch', emoji: '🍔' } });
  assert.deepEqual(emitted, [['user_status', { user_id: 2, text: 'Lunch', emoji: '🍔' }]]);
  const p = await request(app).get('/api/chat/users/me/preferences').set(as(2));
  assert.equal(p.body.preferences.statusText, 'Lunch');
  assert.equal(p.body.preferences.statusEmoji, '🍔');
  // Clearing broadcasts the empty status too.
  await request(app)
    .patch('/api/chat/users/me/status')
    .set(as(2))
    .send({ statusText: '', statusEmoji: '' })
    .expect(200);
  assert.deepEqual(emitted[1], ['user_status', { user_id: 2, text: '', emoji: '' }]);
});

test('PATCH /users/me/status with neither key returns the current status, writes and broadcasts nothing', async () => {
  await request(app)
    .patch('/api/chat/users/me/status')
    .set(as(2))
    .send({ statusText: 'Lunch', statusEmoji: '🍔' })
    .expect(200);
  emitted.length = 0;
  const {
    rows: [before],
  } = await db.query(`SELECT updated_at FROM chat.user_preferences WHERE user_id = 2`);
  for (const body of [{}, { colour: 'dark' }]) {
    const r = await request(app).patch('/api/chat/users/me/status').set(as(2)).send(body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { success: true, status: { text: 'Lunch', emoji: '🍔' } });
  }
  assert.deepEqual(emitted, [], 'no user_status');
  const {
    rows: [afterRow],
  } = await db.query(`SELECT updated_at FROM chat.user_preferences WHERE user_id = 2`);
  assert.equal(String(afterRow.updated_at), String(before.updated_at), 'no write');
  // A user with no row: still no row afterwards.
  await request(app).patch('/api/chat/users/me/status').set(as(3)).send({}).expect(200);
  assert.equal((await db.query(`SELECT 1 FROM chat.user_preferences WHERE user_id = 3`)).rows.length, 0);
  assert.deepEqual(emitted, []);
});

test('PATCH /users/me/status over the limits is 400 bad_preference and broadcasts nothing', async () => {
  for (const body of [{ statusText: 'x'.repeat(101) }, { statusEmoji: 'x'.repeat(17) }, { statusText: 42 }]) {
    const r = await request(app).patch('/api/chat/users/me/status').set(as(2)).send(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'bad_preference');
  }
  assert.deepEqual(emitted, []);
});

test("PATCH /channels/:id/notify sets the caller's level; GET /channels shows it", async () => {
  const r = await request(app).patch(`/api/chat/channels/${general.id}/notify`).set(as(2)).send({ pref: 'nothing' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { success: true, notifyPref: 'nothing' });
  const list = await request(app).get('/api/chat/channels').set(as(2));
  assert.equal(list.body.channels.find((c) => c.id === general.id).notifyPref, 'nothing');
  const other = await request(app).get('/api/chat/channels').set(as(3));
  assert.equal(other.body.channels.find((c) => c.id === general.id).notifyPref, 'default');
});

test('PATCH /channels/:id/notify: bad pref 400 bad_preference; non-member 403 not_member', async () => {
  const bad = await request(app).patch(`/api/chat/channels/${general.id}/notify`).set(as(2)).send({ pref: 'loud' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_preference');
  const {
    rows: [priv],
  } = await db.query(
    `INSERT INTO chat.channels (name, display_name, type, created_by) VALUES ('secret', 'Secret', 'private', 1) RETURNING id`,
  );
  await db.query(`INSERT INTO chat.channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')`, [priv.id]);
  const nm = await request(app).patch(`/api/chat/channels/${priv.id}/notify`).set(as(2)).send({ pref: 'all' });
  assert.equal(nm.status, 403);
  assert.equal(nm.body.code, 'not_member');
});
