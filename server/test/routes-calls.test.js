// Call HTTP routes through the real app (createApp: auth, mount order before the channels
// router) on PGlite with the real call service: every status code in the contract.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createCallService } from '../src/services/calls/call.service.js';
import { createTestDb } from './pg-helper.js';
import { createChannel, openDm } from '../src/models/channels.model.js';
import { addRestriction } from '../src/models/restrictions.model.js';
import { secret, aud } from './route-helper.js';
import jwt from 'jsonwebtoken';

const { db, close } = await createTestDb();
for (let i = 6; i <= 9; i++)
  await db.query(`INSERT INTO users (id, email, full_name, role) VALUES ($1, $2, $3, 'Sales')`, [
    i,
    `u${i}@x`,
    `User ${i}`,
  ]);

const config = {
  sessionSecret: secret,
  sessionAud: aud,
  corsOrigins: [],
  requireBeta: false,
  stunUrls: ['stun:stun.example:3478'],
  turnUrls: ['turn:turn.example:3478'],
  turnSecret: 'coturn-test-secret',
  turnTtlSecs: 3600,
  callRingMs: 30_000,
  callMaxParticipants: 3,
  callDisconnectGraceMs: 10_000,
};
const events = [];
const sockets = new Map(
  [
    [1, 1],
    [2, 2],
    [3, 3],
    [5, 5],
    [6, 6],
    [7, 7],
  ].map(([s, u]) => [`s${s}`, u]),
);
const emit = {
  toChannel: (id, ev, p) => events.push({ id, ev, p }),
  toUser: (id, ev, p) => events.push({ user: id, ev, p }),
  toSocket() {},
  toAll() {},
  userOfSocket: (s) => sockets.get(s) ?? null,
  joinRoom() {},
  leaveRoom() {},
};
const calls = createCallService({ db, emit, notifier: {}, config });
const app = createApp({ config, db, emit, calls });
after(() => {
  calls.close();
  return close();
});

const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const post = (path, id, body = {}) => request(app).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body);
const get = (path, id) => request(app).get(`/api/chat${path}`).set('Authorization', auth(id));
const isErr = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, code);
  assert.equal(typeof r.body.message, 'string');
};
let seq = 0;
const group = async (members = [2, 3, 5, 6, 7]) =>
  (
    await createChannel(db, {
      name: `rc-${++seq}`,
      displayName: `RC ${seq}`,
      type: 'private',
      createdBy: 1,
      memberIds: members,
    })
  ).id;

test('auth is required', async () => {
  assert.equal((await request(app).get('/api/chat/calls/ice')).status, 401);
  assert.equal((await request(app).post('/api/chat/channels/x/calls').send({})).status, 401);
});

test('GET /calls/ice → STUN + TURN with a time-limited credential for the caller', async () => {
  const r = await get('/calls/ice', 2);
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.deepEqual(r.body.iceServers[0], { urls: ['stun:stun.example:3478'] });
  const turn = r.body.iceServers[1];
  assert.deepEqual(turn.urls, ['turn:turn.example:3478']);
  const [expiry, uid] = turn.username.split(':');
  assert.equal(uid, '2');
  assert.ok(Math.abs(Number(expiry) - (Math.floor(Date.now() / 1000) + 3600)) <= 2);
  assert.match(turn.credential, /^[A-Za-z0-9+/]{27}=$/);
});

test('POST /channels/:id/calls → 201 { call, participants, iceServers }; 400 bad_socket; 403 not_member; 409 call_in_progress + callId', async () => {
  const ch = await group([2]);
  isErr(await post(`/channels/${ch}/calls`, 1, {}), 400, 'bad_socket');
  isErr(await post(`/channels/${ch}/calls`, 1, { socketId: 's2' }), 400, 'bad_socket');
  isErr(await post(`/channels/${ch}/calls`, 3, { socketId: 's3' }), 403, 'not_member');
  const r = await post(`/channels/${ch}/calls`, 1, { socketId: 's1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
  const c = r.body.call;
  assert.deepEqual(Object.keys(c).sort(), [
    'channelId',
    'createdAt',
    'durationSecs',
    'endedAt',
    'id',
    'initiatedBy',
    'initiatedByName',
    'startedAt',
    'status',
    'type',
  ]);
  assert.equal(c.channelId, ch);
  assert.equal(c.status, 'ringing');
  assert.equal(c.type, 'voice');
  assert.equal(c.initiatedByName, 'Meg Manager');
  assert.deepEqual(r.body.participants, [{ userId: 1, userName: 'Meg Manager', isSharingScreen: false }]);
  assert.equal(r.body.iceServers.length, 2);
  const again = await post(`/channels/${ch}/calls`, 2, { socketId: 's2' });
  isErr(again, 409, 'call_in_progress');
  assert.equal(again.body.callId, c.id);
  // GET /calls/:id, /channels/:id/calls/active and /channels/:id/calls
  const one = await get(`/calls/${c.id}`, 2);
  assert.equal(one.status, 200);
  assert.equal(one.body.call.id, c.id);
  assert.equal(one.body.participants.length, 1);
  const act = await get(`/channels/${ch}/calls/active`, 2);
  assert.equal(act.status, 200);
  assert.equal(act.body.call.id, c.id);
  assert.deepEqual(
    act.body.participants.map((p) => p.userId),
    [1],
  );
  const list = await get(`/channels/${ch}/calls`, 2);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.calls.map((x) => x.id),
    [c.id],
  );
  isErr(await get(`/calls/${c.id}`, 3), 403, 'not_member');
  isErr(await get(`/channels/${ch}/calls/active`, 3), 403, 'not_member');
  isErr(await get(`/channels/${ch}/calls`, 3), 403, 'not_member');
  isErr(await get('/calls/00000000-0000-4000-8000-000000000000', 1), 404, 'not_found');
});

test('GET /channels/:id/calls/active with no live call → { call: null, participants: [] }', async () => {
  const ch = await group([2]);
  const r = await get(`/channels/${ch}/calls/active`, 2);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, call: null, participants: [] });
});

test('403 restricted for a DM call, with the contract message', async () => {
  const dm = await openDm(db, 6, 7);
  await addRestriction(db, { userId: 7, targetUserId: 6, restriction: 'call', restrictedBy: 1 });
  const r = await post(`/channels/${dm.id}/calls`, 6, { socketId: 's6' });
  isErr(r, 403, 'restricted');
  assert.equal(r.body.message, 'You cannot call this person');
  const dm2 = await openDm(db, 5, 6);
  const started = await post(`/channels/${dm2.id}/calls`, 5, { socketId: 's5' });
  assert.equal(started.status, 201);
  await addRestriction(db, { userId: 5, targetUserId: 6, restriction: 'all', restrictedBy: 1 });
  isErr(await post(`/calls/${started.body.call.id}/join`, 6, { socketId: 's6' }), 403, 'restricted');
});

test('POST /calls/:id/join → 200; 404 not_found; 403 not_member; 400 bad_socket; 403 call_full; 409 call_ended', async () => {
  const ch = await group([2, 3, 5]);
  const {
    body: { call },
  } = await post(`/channels/${ch}/calls`, 1, { socketId: 's1' });
  isErr(await post('/calls/00000000-0000-4000-8000-000000000000/join', 2, { socketId: 's2' }), 404, 'not_found');
  isErr(await post('/calls/nope/join', 2, { socketId: 's2' }), 404, 'not_found');
  isErr(await post(`/calls/${call.id}/join`, 6, { socketId: 's6' }), 403, 'not_member');
  isErr(await post(`/calls/${call.id}/join`, 2, { socketId: 's3' }), 400, 'bad_socket');
  const j = await post(`/calls/${call.id}/join`, 2, { socketId: 's2' });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  assert.equal(j.body.success, true);
  assert.equal(j.body.call.status, 'active');
  assert.deepEqual(
    j.body.participants.map((p) => p.userId),
    [1, 2],
  );
  assert.equal(j.body.iceServers.length, 2);
  assert.equal((await post(`/calls/${call.id}/join`, 3, { socketId: 's3' })).status, 200);
  isErr(await post(`/calls/${call.id}/join`, 5, { socketId: 's5' }), 403, 'call_full'); // max 3 in this config
  for (const id of [1, 2, 3]) assert.deepEqual((await post(`/calls/${call.id}/leave`, id)).body, { success: true });
  isErr(await post(`/calls/${call.id}/join`, 5, { socketId: 's5' }), 409, 'call_ended');
  const msgs = events.filter((e) => e.ev === 'new_message' && e.id === ch);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].p.message.content, /^Voice call — 0m \d+s — Meg Manager, Ann Agent, Bob Sales$/);
});

test('POST /calls/:id/leave is idempotent (unknown, malformed, already left)', async () => {
  assert.deepEqual((await post('/calls/nope/leave', 1)).body, { success: true });
  assert.equal((await post('/calls/00000000-0000-4000-8000-000000000000/leave', 1)).status, 200);
});

test('POST /calls/:id/decline → { success }: dm ends as declined; group dismisses only the decliner', async () => {
  const dm = await openDm(db, 1, 3);
  const {
    body: { call },
  } = await post(`/channels/${dm.id}/calls`, 1, { socketId: 's1' });
  const r = await post(`/calls/${call.id}/decline`, 3);
  assert.deepEqual(r.body, { success: true });
  assert.equal((await get(`/calls/${call.id}`, 1)).body.call.status, 'declined');
  const ch = await group([2, 3]);
  const g = (await post(`/channels/${ch}/calls`, 1, { socketId: 's1' })).body.call;
  assert.deepEqual((await post(`/calls/${g.id}/decline`, 2)).body, { success: true });
  assert.ok(events.some((e) => e.ev === 'call_dismissed' && e.user === 2 && e.p.call_id === g.id));
  assert.equal((await get(`/calls/${g.id}`, 1)).body.call.status, 'ringing');
  isErr(await post(`/calls/${g.id}/decline`, 5), 403, 'not_member');
  isErr(await post('/calls/00000000-0000-4000-8000-000000000000/decline', 5), 404, 'not_found');
});

test('POST /calls/:id/screen-share { on, socketId } → { success }; 409 already_sharing; 403 not_in_call; 400 bad_socket', async () => {
  const ch = await group([2, 3]);
  const {
    body: { call },
  } = await post(`/channels/${ch}/calls`, 1, { socketId: 's1' });
  await post(`/calls/${call.id}/join`, 2, { socketId: 's2' });
  isErr(await post(`/calls/${call.id}/screen-share`, 1, { on: true }), 400, 'bad_socket');
  isErr(await post(`/calls/${call.id}/screen-share`, 1, { on: true, socketId: 's2' }), 400, 'bad_socket');
  assert.deepEqual((await post(`/calls/${call.id}/screen-share`, 1, { on: true, socketId: 's1' })).body, {
    success: true,
  });
  isErr(await post(`/calls/${call.id}/screen-share`, 2, { on: true, socketId: 's2' }), 409, 'already_sharing');
  isErr(await post(`/calls/${call.id}/screen-share`, 3, { on: true, socketId: 's3' }), 403, 'not_in_call');
  const cur = await get(`/calls/${call.id}`, 2);
  assert.deepEqual(
    cur.body.participants.map((p) => [p.userId, p.isSharingScreen]),
    [
      [1, true],
      [2, false],
    ],
  );
  assert.deepEqual((await post(`/calls/${call.id}/screen-share`, 1, { on: false, socketId: 's1' })).body, {
    success: true,
  });
});

test('with no call service (older wiring) /calls/ice still answers from config', async () => {
  const bare = createApp({ config, db, emit });
  const r = await request(bare).get('/api/chat/calls/ice').set('Authorization', auth(1));
  assert.equal(r.status, 200);
  assert.equal(r.body.iceServers.length, 2);
});

test('the channels router still owns /channels/:id (calls router does not shadow it)', async () => {
  const ch = await group([2]);
  const r = await get(`/channels/${ch}/messages`, 2);
  assert.equal(r.status, 200);
});
