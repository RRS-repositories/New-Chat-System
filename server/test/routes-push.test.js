// /api/chat/push routes on real Postgres (PGlite) behind the real auth middleware.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../src/middleware/auth.js';
import { createPushRoutes } from '../src/routes/push.routes.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';
import { createTestDb } from './pg-helper.js';
import { token, secret, aud } from './route-helper.js';

const ANN = 2,
  BOB = 3;
const vapid = { vapidPublic: 'BPUBLICKEY', vapidPrivate: 'PRIVATE', vapidSubject: 'mailto:x@y.z' };
let t, db;
beforeEach(async () => {
  t = await createTestDb();
  db = t.db;
});
afterEach(async () => {
  await t.close();
});

function app(config = vapid) {
  const a = express();
  a.use(express.json());
  a.use('/api/chat/push', requireAuth({ db, secret, aud }), createPushRoutes({ db, config }));
  return a;
}
const subs = async () =>
  (await db.query(`SELECT user_id, endpoint, keys, user_agent FROM chat.push_subscriptions ORDER BY endpoint`)).rows;
const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BKEY', auth: 'AUTH' } };

test('GET /key returns the public key, or null when VAPID is not fully configured', async () => {
  let r = await request(app()).get('/api/chat/push/key').set('Authorization', token(ANN));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, key: 'BPUBLICKEY' });
  for (const cfg of [{}, { vapidPublic: 'BPUBLICKEY' }, { vapidPublic: '', vapidPrivate: 'P' }]) {
    r = await request(app(cfg)).get('/api/chat/push/key').set('Authorization', token(ANN));
    assert.deepEqual(r.body, { success: true, key: null });
  }
});

test('auth is required', async () => {
  assert.equal((await request(app()).get('/api/chat/push/key')).status, 401);
  assert.equal((await request(app()).post('/api/chat/push/subscribe').send(good)).status, 401);
});

test('mounted in createApp at /api/chat/push behind auth', async () => {
  const config = {
    ...loadConfig({
      DB_HOST: 'h',
      DB_NAME: 'n',
      DB_USER: 'u',
      DB_PASSWORD: 'p',
      SESSION_JWT_SECRET: secret,
      CHAT_VAPID_PUBLIC: 'BAPP',
      CHAT_VAPID_PRIVATE: 'P',
    }),
  };
  const a = createApp({ config, db, emit: { toChannel() {}, toUser() {} } });
  assert.equal((await request(a).get('/api/chat/push/key')).status, 401);
  const r = await request(a).get('/api/chat/push/key').set('Authorization', token(1, 'Management'));
  assert.deepEqual(r.body, { success: true, key: 'BAPP' });
});

test('POST /subscribe stores the subscription with the user agent (cut to 300), and moves an endpoint to the caller', async () => {
  let r = await request(app())
    .post('/api/chat/push/subscribe')
    .set('Authorization', token(ANN))
    .set('User-Agent', 'U'.repeat(400))
    .send(good);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true });
  assert.deepEqual(await subs(), [
    { user_id: ANN, endpoint: good.endpoint, keys: good.keys, user_agent: 'U'.repeat(300) },
  ]);
  r = await request(app())
    .post('/api/chat/push/subscribe')
    .set('Authorization', token(BOB))
    .set('User-Agent', 'Bob')
    .send({ ...good, keys: { p256dh: 'K2', auth: 'A2' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await subs(), [
    { user_id: BOB, endpoint: good.endpoint, keys: { p256dh: 'K2', auth: 'A2' }, user_agent: 'Bob' },
  ]);
});

const bad = [
  ['no body', undefined],
  ['http endpoint', { ...good, endpoint: 'http://fcm.googleapis.com/x' }],
  ['not a url', { ...good, endpoint: 'not a url' }],
  ['endpoint not a string', { ...good, endpoint: 42 }],
  ['endpoint too long', { ...good, endpoint: `https://p.example/${'a'.repeat(2000)}` }],
  ['no keys', { endpoint: good.endpoint }],
  ['empty p256dh', { ...good, keys: { p256dh: '', auth: 'A' } }],
  ['missing auth', { ...good, keys: { p256dh: 'K' } }],
  ['auth not a string', { ...good, keys: { p256dh: 'K', auth: 7 } }],
  ['p256dh too long', { ...good, keys: { p256dh: 'k'.repeat(301), auth: 'A' } }],
  ['auth too long', { ...good, keys: { p256dh: 'K', auth: 'a'.repeat(301) } }],
];
for (const [name, body] of bad) {
  test(`POST /subscribe rejects ${name} with 400 bad_subscription`, async () => {
    const r = await request(app()).post('/api/chat/push/subscribe').set('Authorization', token(ANN)).send(body);
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, 'bad_subscription');
    assert.equal((await subs()).length, 0);
  });
}

test('POST /subscribe accepts an endpoint of exactly 2000 characters and keys of 300', async () => {
  const endpoint = `https://p.example/${'a'.repeat(2000 - 'https://p.example/'.length)}`;
  const r = await request(app())
    .post('/api/chat/push/subscribe')
    .set('Authorization', token(ANN))
    .send({ endpoint, keys: { p256dh: 'k'.repeat(300), auth: 'a'.repeat(300) } });
  assert.equal(r.status, 200);
});

test("POST /unsubscribe removes only the caller's own subscription", async () => {
  await request(app()).post('/api/chat/push/subscribe').set('Authorization', token(ANN)).send(good);
  let r = await request(app())
    .post('/api/chat/push/unsubscribe')
    .set('Authorization', token(BOB))
    .send({ endpoint: good.endpoint });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true });
  assert.equal((await subs()).length, 1);
  r = await request(app())
    .post('/api/chat/push/unsubscribe')
    .set('Authorization', token(ANN))
    .send({ endpoint: good.endpoint });
  assert.deepEqual(r.body, { success: true });
  assert.equal((await subs()).length, 0);
  r = await request(app()).post('/api/chat/push/unsubscribe').set('Authorization', token(ANN)).send({});
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'bad_subscription');
});

// The server POSTs to the endpoint, so it must not be pointable at internal hosts.
for (const endpoint of [
  'https://192.168.1.58/x',
  'https://10.0.0.1:8443/x',
  'https://[::1]/x',
  'https://[fe80::1]/x',
  'https://localhost/x',
  'https://LOCALHOST./x',
  'https://intranet/x',
  'https://2130706433/x',
]) {
  test(`POST /subscribe rejects internal endpoint ${endpoint}`, async () => {
    const r = await request(app())
      .post('/api/chat/push/subscribe')
      .set('Authorization', token(ANN))
      .send({ ...good, endpoint });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'bad_subscription');
    assert.equal((await subs()).length, 0);
  });
}

for (const endpoint of [
  'https://fcm.googleapis.com/fcm/send/abc',
  'https://updates.push.services.mozilla.com/wpush/v2/abc',
]) {
  test(`POST /subscribe accepts public push service ${endpoint}`, async () => {
    const r = await request(app())
      .post('/api/chat/push/subscribe')
      .set('Authorization', token(ANN))
      .send({ ...good, endpoint });
    assert.equal(r.status, 200);
  });
}
