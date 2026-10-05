// Adding people to a live call, and joining a ringing call to a call already going on,
// through the real app and call service on PGlite.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createCallService } from '../src/services/calls/call.service.js';
import { createTestDb } from './pg-helper.js';
import { createChannel, openDm } from '../src/models/channels.model.js';
import { addRestriction } from '../src/models/restrictions.model.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
// Users from the helper: 1 Meg Manager, 2 Ann Agent, 3 Bob Sales, 4 Gone User (inactive), 5 Cy Sales.
const events = [];
const sockets = new Map([1, 2, 3, 5].map((u) => [`s${u}`, u]));
const emit = {
  toChannel: (id, ev, p) => events.push({ to: 'channel', id, ev, p }),
  toUser: (id, ev, p) => events.push({ to: 'user', id, ev, p }),
  toSocket: (id, ev, p) => events.push({ to: 'socket', id, ev, p }),
  toAll() {},
  userOfSocket: (s) => sockets.get(s) ?? null,
  joinRoom() {},
  leaveRoom() {},
};
// Timers are held here and fired by hand, so a 30-second ring takes no time in a test.
const pending = new Set();
const timers = {
  setTimeout: (fn, ms) => {
    const handle = { fn, ms };
    pending.add(handle);
    return handle;
  },
  clearTimeout: (handle) => pending.delete(handle),
};
const fire = async (ms) => {
  for (const handle of [...pending].filter((h) => h.ms === ms)) {
    pending.delete(handle);
    handle.fn();
  }
  await new Promise((r) => setTimeout(r, 60));
};
const RING = 30_000;
const services = [];
function build(extra = {}) {
  const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false, ...extra };
  const calls = createCallService({ db, emit, notifier: {}, config, timers });
  services.push(calls);
  return createApp({ config, db, emit, calls });
}
const app = build({ callRingMs: RING });
after(() => {
  for (const calls of services) calls.close();
  return close();
});

const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const post = (path, id, body = {}, on = app) =>
  request(on).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body);
const get = (path, id) => request(app).get(`/api/chat${path}`).set('Authorization', auth(id));
const del = (path, id) => request(app).delete(`/api/chat${path}`).set('Authorization', auth(id));
const isErr = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.code, code, JSON.stringify(r.body));
  assert.equal(typeof r.body.message, 'string');
};
const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));
const since = (mark, ev) => events.slice(mark).filter((e) => e.ev === ev);
const inCall = async (callId) => (await get(`/calls/${callId}`, 1)).body.participants.map((p) => p.userId);

let seq = 0;
/** A private channel with only Meg and Ann; Meg starts a call and Ann joins. Bob and Cy are outside it. */
async function megAndAnn(on = app) {
  const channel = await createChannel(db, {
    name: `invite-${++seq}`,
    displayName: `Invite ${seq}`,
    type: 'private',
    createdBy: 1,
    memberIds: [2],
  });
  const started = await post(`/channels/${channel.id}/calls`, 1, { socketId: 's1' }, on);
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const callId = started.body.call.id;
  ok(await post(`/calls/${callId}/join`, 2, { socketId: 's2' }, on));
  return { channelId: channel.id, callId };
}

test('ringing someone from outside the channel into the call: they ring, the call sees a ringing tile, and a join card lands in the direct conversation', async () => {
  const { callId, channelId } = await megAndAnn();
  const mark = events.length;
  const r = await post(`/calls/${callId}/invite`, 2, { user_id: 3 });
  ok(r, 201);
  assert.deepEqual(r.body.invite, { userId: 3, userName: 'Bob Sales' });

  assert.deepEqual(since(mark, 'call_invited'), [
    {
      to: 'user',
      id: 3,
      ev: 'call_invited',
      p: { call_id: callId, channel_id: channelId, from_user_id: 2, from_user_name: 'Ann Agent' },
    },
  ]);
  const tile = since(mark, 'call_invite_pending');
  assert.deepEqual(tile.map((e) => e.id).sort(), ['s1', 's2'], 'only the people in the call see the ringing tile');
  assert.deepEqual(tile[0].p, { call_id: callId, channel_id: channelId, user_id: 3, user_name: 'Bob Sales' });

  const dm = await openDm(db, 2, 3);
  const [card] = since(mark, 'new_message');
  assert.equal(card.id, dm.id, 'the card goes into the conversation between the two, not into the call’s channel');
  assert.equal(card.p.message.type, 'call');
  assert.equal(card.p.message.content, 'Can you join my call?');
  assert.equal(card.p.message.userId, 2);
  assert.deepEqual(card.p.message.metadata, { kind: 'call_invite', call_id: callId, channel_id: channelId });

  // The invited person can look at the call and join it, but never reads the channel.
  const seen = await get(`/calls/${callId}`, 3);
  ok(seen);
  assert.deepEqual(seen.body.invites, [{ userId: 3, userName: 'Bob Sales' }]);
  isErr(await get(`/channels/${channelId}/messages`, 3), 403, 'not_member');
  const before = events.length;
  const joined = await post(`/calls/${callId}/join`, 3, { socketId: 's3' });
  ok(joined);
  assert.deepEqual(joined.body.invites, [], 'answered: no longer ringing');
  assert.deepEqual(await inCall(callId), [1, 2, 3]);
  isErr(await get(`/channels/${channelId}/messages`, 3), 403, 'not_member');
  const told = since(before, 'call_participant_joined');
  assert.ok(
    told.some((e) => e.to === 'channel' && e.id === channelId),
    'the channel is told',
  );
  assert.ok(
    told.some((e) => e.to === 'user' && e.id === 3),
    'and so is the person from outside it',
  );
  await fire(RING);
  assert.equal(since(before, 'call_invite_ended').length, 0, 'the ring timer died when they answered');

  // When the call ends, the person from outside is told too.
  const ending = events.length;
  for (const u of [1, 2, 3]) ok(await post(`/calls/${callId}/leave`, u));
  assert.ok(since(ending, 'call_ended').some((e) => e.to === 'user' && e.id === 3));
  isErr(await get(`/calls/${callId}`, 3), 403, 'not_member');
});

test('who cannot be rung into a call', async () => {
  const { callId } = await megAndAnn();
  isErr(await post(`/calls/${callId}/invite`, 5, { user_id: 3 }), 403, 'not_in_call');
  isErr(await post(`/calls/${callId}/invite`, 1, { user_id: 1 }), 400, 'bad_target');
  isErr(await post(`/calls/${callId}/invite`, 1, {}), 400, 'bad_target');
  isErr(await post(`/calls/${callId}/invite`, 1, { user_id: 2 }), 409, 'already_in_call');
  isErr(await post(`/calls/${callId}/invite`, 1, { user_id: 4 }), 404, 'unknown_user'); // not active
  isErr(await post(`/calls/${callId}/invite`, 1, { user_id: 9999 }), 404, 'unknown_user');
  isErr(await post(`/calls/not-a-uuid/invite`, 1, { user_id: 3 }), 404, 'not_found');
  ok(await post(`/calls/${callId}/invite`, 1, { user_id: 3 }), 201);
  isErr(await post(`/calls/${callId}/invite`, 2, { user_id: 3 }), 409, 'already_ringing');
  for (const u of [1, 2]) ok(await post(`/calls/${callId}/leave`, u));
  isErr(await post(`/calls/${callId}/invite`, 1, { user_id: 5 }), 409, 'call_ended');
});

test('a call restriction, in either direction, stops the ring', async () => {
  const { callId } = await megAndAnn();
  await addRestriction(db, { userId: 5, targetUserId: 2, restriction: 'call', restrictedBy: 1 });
  const mark = events.length;
  isErr(await post(`/calls/${callId}/invite`, 2, { user_id: 5 }), 403, 'restricted');
  assert.equal(since(mark, 'call_invited').length, 0);
  isErr(await post(`/calls/${callId}/join`, 5, { socketId: 's5' }), 403, 'not_member');
  await db.query(`DELETE FROM chat.communication_restrictions WHERE user_id = 5 AND target_user_id = 2`);
});

test('the limit counts people being rung: with three allowed, two in and one ringing is full', async () => {
  const small = build({ callRingMs: RING, callMaxParticipants: 3 });
  const { callId } = await megAndAnn(small);
  ok(await post(`/calls/${callId}/invite`, 1, { user_id: 3 }, small), 201);
  isErr(await post(`/calls/${callId}/invite`, 1, { user_id: 5 }, small), 403, 'call_full');
});

test('nobody answers for 30 seconds: the ring ends, but the join card still lets them in', async () => {
  const { callId, channelId } = await megAndAnn();
  ok(await post(`/calls/${callId}/invite`, 1, { user_id: 3 }), 201);
  const mark = events.length;
  await fire(RING);
  const ended = since(mark, 'call_invite_ended').filter((e) => e.p.call_id === callId);
  const payload = { call_id: callId, channel_id: channelId, user_id: 3, reason: 'timeout' };
  assert.deepEqual(
    ended.map((e) => [e.to, e.id]),
    [
      ['socket', 's1'],
      ['socket', 's2'],
      ['user', 3],
    ],
  );
  for (const e of ended) assert.deepEqual(e.p, payload);
  assert.deepEqual((await get(`/calls/${callId}`, 1)).body.invites, []);
  ok(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }));
  // They can be rung again after a missed ring once they have left.
  ok(await post(`/calls/${callId}/leave`, 3));
  ok(await post(`/calls/${callId}/invite`, 2, { user_id: 3 }), 201);
});

test('the invited person declines: the ring ends for everyone, the call goes on', async () => {
  const { callId } = await megAndAnn();
  ok(await post(`/calls/${callId}/invite`, 1, { user_id: 3 }), 201);
  const mark = events.length;
  ok(await post(`/calls/${callId}/decline`, 3));
  assert.deepEqual(
    since(mark, 'call_invite_ended').map((e) => e.p.reason),
    ['declined', 'declined', 'declined'],
  );
  assert.ok(since(mark, 'call_dismissed').some((e) => e.to === 'user' && e.id === 3));
  assert.deepEqual(await inCall(callId), [1, 2]);
  assert.equal(since(mark, 'call_ended').length, 0);
});

test('taking an invitation back: the person who rang or the host can; afterwards the invited person cannot join', async () => {
  const { callId } = await megAndAnn();
  ok(await post(`/calls/${callId}/invite`, 2, { user_id: 3 }), 201);
  ok(await post(`/calls/${callId}/invite`, 1, { user_id: 5 }), 201);
  isErr(await del(`/calls/${callId}/invite/5`, 2), 403, 'not_yours'); // Ann did not ring Cy and is not the host
  isErr(await del(`/calls/${callId}/invite/3`, 3), 403, 'not_in_call');
  const mark = events.length;
  ok(await del(`/calls/${callId}/invite/3`, 1)); // the host stops Ann's ring
  assert.deepEqual(
    since(mark, 'call_invite_ended').map((e) => e.p.reason),
    ['cancelled', 'cancelled', 'cancelled'],
  );
  isErr(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }), 403, 'not_member');
  isErr(await del(`/calls/${callId}/invite/3`, 1), 404, 'no_invite');
  ok(await del(`/calls/${callId}/invite/5`, 1));
  assert.deepEqual((await get(`/calls/${callId}`, 1)).body.invites, []);
});

test('a one-to-one call with a third person added goes on until only one of them is left', async () => {
  const dm = await openDm(db, 1, 2);
  const started = await post(`/channels/${dm.id}/calls`, 1, { socketId: 's1' });
  ok(started, 201);
  const callId = started.body.call.id;
  ok(await post(`/calls/${callId}/join`, 2, { socketId: 's2' }));
  ok(await post(`/calls/${callId}/invite`, 1, { user_id: 3 }), 201);
  ok(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }));
  const mark = events.length;
  ok(await post(`/calls/${callId}/leave`, 1));
  assert.equal(since(mark, 'call_ended').length, 0, 'two are still talking');
  assert.equal((await get(`/calls/${callId}`, 2)).body.hostId, 2, 'the longest-present person is the host now');
  ok(await post(`/calls/${callId}/leave`, 3));
  assert.ok(since(mark, 'call_ended').length > 0, 'one person alone in a one-to-one call: it is over');
});

test('merge: someone in a call is rung one-to-one and brings the caller into their call', async () => {
  const { callId: bigCall, channelId } = await megAndAnn();
  const dm = await openDm(db, 3, 2);
  const ring = await post(`/channels/${dm.id}/calls`, 3, { socketId: 's3' }); // Bob rings Ann
  ok(ring, 201);
  const ringId = ring.body.call.id;

  isErr(await post(`/calls/${ringId}/merge`, 2, {}), 400, 'bad_call');
  isErr(await post(`/calls/${ringId}/merge`, 2, { into_call_id: ringId }), 400, 'bad_call');
  isErr(await post(`/calls/${ringId}/merge`, 3, { into_call_id: bigCall }), 409, 'not_ringing'); // the caller cannot merge their own ring
  isErr(await post(`/calls/${ringId}/merge`, 5, { into_call_id: bigCall }), 403, 'not_member');

  const mark = events.length;
  ok(await post(`/calls/${ringId}/merge`, 2, { into_call_id: bigCall }));
  const ended = since(mark, 'call_ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].p.call_id, ringId);
  assert.equal(ended[0].p.status, 'declined');
  const note = since(mark, 'new_message')[0];
  assert.equal(note.id, dm.id);
  assert.equal(note.p.message.content, 'Call joined to a call already going on');
  assert.deepEqual(since(mark, 'call_merge'), [
    {
      to: 'socket',
      id: 's3',
      ev: 'call_merge',
      p: { from_call_id: ringId, join_call_id: bigCall, channel_id: channelId },
    },
  ]);
  // The caller is not in the big call's channel, yet may now join that call.
  ok(await post(`/calls/${bigCall}/join`, 3, { socketId: 's3' }));
  assert.deepEqual(await inCall(bigCall), [1, 2, 3]);
  isErr(await post(`/calls/${ringId}/merge`, 2, { into_call_id: bigCall }), 409, 'not_ringing');
});

test('merge is refused when the person is not in the other call, or it is full', async () => {
  const small = build({ callRingMs: RING, callMaxParticipants: 2 });
  const { callId: fullCall } = await megAndAnn(small); // two people: full
  const dm = await openDm(db, 5, 2);
  const ring = await post(`/channels/${dm.id}/calls`, 5, { socketId: 's5' }, small);
  ok(ring, 201);
  isErr(await post(`/calls/${ring.body.call.id}/merge`, 2, { into_call_id: fullCall }, small), 403, 'call_full');
  ok(await post(`/calls/${fullCall}/leave`, 2, {}, small));
  isErr(await post(`/calls/${ring.body.call.id}/merge`, 2, { into_call_id: fullCall }, small), 403, 'not_in_call');
  // The ring was not touched by the refusals.
  const still = await request(small).get(`/api/chat/calls/${ring.body.call.id}`).set('Authorization', auth(5));
  assert.equal(still.body.call.status, 'ringing');
});
