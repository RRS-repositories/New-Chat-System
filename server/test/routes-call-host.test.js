// Call host controls through the real app and call service on PGlite:
// the person who started a call can mute and remove others; a removed person asks to come back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createCallService } from '../src/services/calls/call.service.js';
import { createTestDb } from './pg-helper.js';
import { createChannel, openDm } from '../src/models/channels.model.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
// Users from the helper: 1 Meg Manager, 2 Ann Agent, 3 Bob Sales, 5 Cy Sales.
const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false, callAskAgainMs: 60_000 };
const events = [];
const sockets = new Map(
  [1, 2, 3, 5].flatMap((u) => [
    [`s${u}`, u],
    [`s${u}b`, u],
  ]),
);
const emit = {
  toChannel: (id, ev, p) => events.push({ to: 'channel', id, ev, p }),
  toUser: (id, ev, p) => events.push({ to: 'user', id, ev, p }),
  toSocket: (id, ev, p) => events.push({ to: 'socket', id, ev, p }),
  toAll() {},
  userOfSocket: (s) => sockets.get(s) ?? null,
  joinRoom() {},
  leaveRoom() {},
};
let clock = Date.parse('2026-10-01T12:00:00Z');
const calls = createCallService({ db, emit, notifier: {}, config, now: () => clock });
const app = createApp({ config, db, emit, calls });
after(() => {
  calls.close();
  return close();
});

const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const post = (path, id, body = {}) => request(app).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body);
const del = (path, id) => request(app).delete(`/api/chat${path}`).set('Authorization', auth(id));
const isErr = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.code, code, JSON.stringify(r.body));
  assert.equal(typeof r.body.message, 'string');
};
const ok = (r) => assert.equal(r.status, 200, JSON.stringify(r.body));
const since = (mark, ev) => events.slice(mark).filter((e) => e.ev === ev);
const inCall = async (callId) =>
  (await request(app).get(`/api/chat/calls/${callId}`).set('Authorization', auth(1))).body.participants.map(
    (p) => p.userId,
  );

let seq = 0;
/** A private channel with Meg, Ann, Bob and Cy; Meg starts a call and the named others join. */
async function callWith(joiners = [2, 3]) {
  const channel = await createChannel(db, {
    name: `host-${++seq}`,
    displayName: `Host ${seq}`,
    type: 'private',
    createdBy: 1,
    memberIds: [2, 3, 5],
  });
  const started = await post(`/channels/${channel.id}/calls`, 1, { socketId: 's1' });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const callId = started.body.call.id;
  for (const u of joiners) ok(await post(`/calls/${callId}/join`, u, { socketId: `s${u}` }));
  return { channelId: channel.id, callId };
}

test('the host mutes someone: only that person’s call device is told, and there is no way to unmute another person', async () => {
  const { callId, channelId } = await callWith();
  const mark = events.length;
  ok(await post(`/calls/${callId}/participants/2/mute`, 1));
  assert.deepEqual(since(mark, 'call_muted_by_host'), [
    {
      to: 'socket',
      id: 's2',
      ev: 'call_muted_by_host',
      p: { call_id: callId, channel_id: channelId, by_user_id: 1, by_user_name: 'Meg Manager' },
    },
  ]);
  assert.deepEqual(await inCall(callId), [1, 2, 3], 'muting removes nobody');
  assert.equal((await post(`/calls/${callId}/participants/2/unmute`, 1)).status, 404);
});

test('only the person who started the call has host controls', async () => {
  const { callId } = await callWith();
  isErr(await post(`/calls/${callId}/participants/3/mute`, 2), 403, 'not_host');
  isErr(await post(`/calls/${callId}/participants/3/remove`, 2), 403, 'not_host');
  isErr(await post(`/calls/${callId}/join-requests/3`, 2, { accept: true }), 403, 'not_host');
  assert.deepEqual(await inCall(callId), [1, 2, 3]);
});

test('host controls refuse a bad target: yourself, someone not in the call, nonsense', async () => {
  const { callId } = await callWith([2]);
  isErr(await post(`/calls/${callId}/participants/1/mute`, 1), 400, 'bad_target');
  isErr(await post(`/calls/${callId}/participants/1/remove`, 1), 400, 'bad_target');
  isErr(await post(`/calls/${callId}/participants/3/mute`, 1), 404, 'not_in_call');
  isErr(await post(`/calls/${callId}/participants/abc/remove`, 1), 400, 'bad_target');
  isErr(await post(`/calls/00000000-0000-4000-8000-000000000000/participants/2/mute`, 1), 404, 'not_found');
  isErr(await post(`/calls/not-a-uuid/participants/2/mute`, 1), 404, 'not_found');
});

test('a host who has left the call has no controls until they are back in it', async () => {
  const { callId } = await callWith();
  ok(await post(`/calls/${callId}/leave`, 1));
  isErr(await post(`/calls/${callId}/participants/2/mute`, 1), 403, 'not_in_call');
  ok(await post(`/calls/${callId}/join`, 1, { socketId: 's1b' }));
  ok(await post(`/calls/${callId}/participants/2/mute`, 1));
});

test('the host removes someone: they are told why, leave the call, and cannot simply join back', async () => {
  const { callId, channelId } = await callWith();
  const mark = events.length;
  ok(await post(`/calls/${callId}/participants/3/remove`, 1));
  assert.deepEqual(since(mark, 'call_removed'), [
    {
      to: 'user',
      id: 3,
      ev: 'call_removed',
      p: { call_id: callId, channel_id: channelId, by_user_name: 'Meg Manager' },
    },
  ]);
  assert.deepEqual(
    since(mark, 'call_participant_left').map((e) => e.p.user_id),
    [3],
  );
  assert.equal(since(mark, 'call_ended').length, 0, 'the call goes on for the others');
  assert.deepEqual(await inCall(callId), [1, 2]);
  isErr(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }), 403, 'removed');
  assert.deepEqual(await inCall(callId), [1, 2]);
  // Signals from the removed person no longer reach anyone.
  assert.equal(
    calls.relaySignal({ fromSocketId: 's3', fromUserId: 3, callId, toUserId: 2, signalData: { type: 'state' } }),
    false,
  );
});

test('a person who was only disconnected joins back freely', async () => {
  const { callId } = await callWith();
  ok(await post(`/calls/${callId}/leave`, 3));
  ok(await post(`/calls/${callId}/join`, 3, { socketId: 's3b' }));
  assert.deepEqual(await inCall(callId), [1, 2, 3]);
  isErr(await post(`/calls/${callId}/join-requests`, 3), 400, 'not_removed');
});

test('a removed person asks to come back; the host lets them in; they can then join', async () => {
  const { callId, channelId } = await callWith();
  ok(await post(`/calls/${callId}/participants/3/remove`, 1));
  let mark = events.length;
  ok(await post(`/calls/${callId}/join-requests`, 3));
  assert.deepEqual(since(mark, 'call_join_request'), [
    {
      to: 'socket',
      id: 's1',
      ev: 'call_join_request',
      p: { call_id: callId, channel_id: channelId, user_id: 3, user_name: 'Bob Sales' },
    },
  ]);
  isErr(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }), 403, 'removed');
  mark = events.length;
  ok(await post(`/calls/${callId}/join-requests/3`, 1, { accept: true }));
  assert.deepEqual(since(mark, 'call_join_answer'), [
    { to: 'user', id: 3, ev: 'call_join_answer', p: { call_id: callId, channel_id: channelId, accepted: true } },
  ]);
  ok(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }));
  assert.deepEqual(await inCall(callId), [1, 2, 3]);
  isErr(await post(`/calls/${callId}/join-requests/3`, 1, { accept: true }), 404, 'no_request');
});

test('the host refuses: the person stays out and must wait a minute before asking again', async () => {
  const { callId, channelId } = await callWith();
  ok(await post(`/calls/${callId}/participants/3/remove`, 1));
  ok(await post(`/calls/${callId}/join-requests`, 3));
  const mark = events.length;
  ok(await post(`/calls/${callId}/join-requests/3`, 1, { accept: false }));
  assert.deepEqual(since(mark, 'call_join_answer'), [
    {
      to: 'user',
      id: 3,
      ev: 'call_join_answer',
      p: { call_id: callId, channel_id: channelId, accepted: false, reason: 'refused' },
    },
  ]);
  isErr(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }), 403, 'removed');
  isErr(await post(`/calls/${callId}/join-requests`, 3), 429, 'too_soon');
  clock += 61_000;
  ok(await post(`/calls/${callId}/join-requests`, 3));
});

test('the answer must say accept true or false', async () => {
  const { callId } = await callWith();
  ok(await post(`/calls/${callId}/participants/3/remove`, 1));
  ok(await post(`/calls/${callId}/join-requests`, 3));
  isErr(await post(`/calls/${callId}/join-requests/3`, 1, {}), 400, 'bad_answer');
  isErr(await post(`/calls/${callId}/join-requests/3`, 1, { accept: 'yes' }), 400, 'bad_answer');
});

test('asking twice shows the host one request; withdrawing it tells the host', async () => {
  const { callId } = await callWith();
  ok(await post(`/calls/${callId}/participants/3/remove`, 1));
  ok(await post(`/calls/${callId}/join-requests`, 3));
  ok(await post(`/calls/${callId}/join-requests`, 3));
  const rejoin = await post(`/calls/${callId}/join`, 1, { socketId: 's1b' });
  assert.deepEqual(
    rejoin.body.joinRequests,
    [{ userId: 3, userName: 'Bob Sales' }],
    'the host sees it after a reconnect',
  );
  assert.deepEqual((await post(`/calls/${callId}/join`, 2, { socketId: 's2' })).body.joinRequests, [], 'others do not');
  const mark = events.length;
  ok(await del(`/calls/${callId}/join-requests`, 3));
  assert.deepEqual(since(mark, 'call_join_request_cancelled'), [
    { to: 'socket', id: 's1b', ev: 'call_join_request_cancelled', p: { call_id: callId, user_id: 3 } },
  ]);
  isErr(await post(`/calls/${callId}/join-requests/3`, 1, { accept: true }), 404, 'no_request');
});

test('when the starter leaves, the person in the call longest becomes host and takes over the waiting requests', async () => {
  const { callId, channelId } = await callWith([2, 5]);
  ok(await post(`/calls/${callId}/participants/5/remove`, 1));
  ok(await post(`/calls/${callId}/join`, 3, { socketId: 's3' }));
  ok(await post(`/calls/${callId}/join-requests`, 5));
  const mark = events.length;
  ok(await post(`/calls/${callId}/leave`, 1));
  // Ann (2) joined before Bob (3): she is the host now. Both are told; she is shown who is waiting.
  assert.deepEqual(
    since(mark, 'call_host_changed').map((e) => [e.to, e.id, e.p.host_user_id]),
    [
      ['socket', 's2', 2],
      ['socket', 's3', 2],
    ],
  );
  assert.deepEqual(since(mark, 'call_join_request'), [
    {
      to: 'socket',
      id: 's2',
      ev: 'call_join_request',
      p: { call_id: callId, channel_id: channelId, user_id: 5, user_name: 'Cy Sales' },
    },
  ]);
  assert.equal(since(mark, 'call_join_answer').length, 0, 'nobody is turned away just because the starter left');
  isErr(await post(`/calls/${callId}/participants/2/mute`, 3), 403, 'not_host');
  ok(await post(`/calls/${callId}/participants/3/mute`, 2));
  ok(await post(`/calls/${callId}/join-requests/5`, 2, { accept: true }));
  ok(await post(`/calls/${callId}/join`, 5, { socketId: 's5' }));
  assert.deepEqual(await inCall(callId), [2, 3, 5]);
});

test('the starter coming back is the host again, and everyone is told', async () => {
  const { callId } = await callWith();
  ok(await post(`/calls/${callId}/leave`, 1));
  const mark = events.length;
  const back = await post(`/calls/${callId}/join`, 1, { socketId: 's1b' });
  ok(back);
  assert.equal(back.body.hostId, 1);
  assert.deepEqual(
    since(mark, 'call_host_changed').map((e) => e.p.host_user_id),
    [1, 1, 1],
    'told on each of the three call devices',
  );
  isErr(await post(`/calls/${callId}/participants/3/mute`, 2), 403, 'not_host');
  ok(await post(`/calls/${callId}/participants/3/mute`, 1));
});

test('joining tells you who the host is; a host muting says who did it', async () => {
  const { callId } = await callWith([2]);
  const joined = await post(`/calls/${callId}/join`, 3, { socketId: 's3' });
  assert.equal(joined.body.hostId, 1);
  ok(await post(`/calls/${callId}/leave`, 1));
  const mark = events.length;
  ok(await post(`/calls/${callId}/participants/3/mute`, 2));
  assert.equal(since(mark, 'call_muted_by_host')[0].p.by_user_name, 'Ann Agent');
  const seen = await request(app).get(`/api/chat/calls/${callId}`).set('Authorization', auth(3));
  assert.equal(seen.body.hostId, 2);
});

test('being removed is marked as such in the "left" event', async () => {
  const { callId } = await callWith();
  const mark = events.length;
  ok(await post(`/calls/${callId}/participants/3/remove`, 1));
  assert.equal(since(mark, 'call_participant_left')[0].p.reason, 'removed');
  ok(await post(`/calls/${callId}/leave`, 2));
  assert.equal(since(mark, 'call_participant_left')[1].p.reason, undefined);
});

test('someone outside the channel can do none of this', async () => {
  const channel = await createChannel(db, {
    name: 'host-x',
    displayName: 'Host X',
    type: 'private',
    createdBy: 1,
    memberIds: [2],
  });
  const callId = (await post(`/channels/${channel.id}/calls`, 1, { socketId: 's1' })).body.call.id;
  isErr(await post(`/calls/${callId}/join-requests`, 3), 403, 'not_member');
  isErr(await post(`/calls/${callId}/participants/1/remove`, 3), 403, 'not_member');
});

test('a new call starts clean: the last call’s removal does not carry over', async () => {
  const first = await callWith();
  ok(await post(`/calls/${first.callId}/participants/3/remove`, 1));
  ok(await post(`/calls/${first.callId}/leave`, 2));
  ok(await post(`/calls/${first.callId}/leave`, 1));
  const again = await post(`/channels/${first.channelId}/calls`, 1, { socketId: 's1' });
  assert.equal(again.status, 201);
  ok(await post(`/calls/${again.body.call.id}/join`, 3, { socketId: 's3' }));
});

test('removing the other person in a one-to-one call ends it', async () => {
  const dm = await openDm(db, 1, 2);
  const callId = (await post(`/channels/${dm.id}/calls`, 1, { socketId: 's1' })).body.call.id;
  ok(await post(`/calls/${callId}/join`, 2, { socketId: 's2' }));
  const mark = events.length;
  ok(await post(`/calls/${callId}/participants/2/remove`, 1));
  assert.equal(since(mark, 'call_ended').length, 1);
});

test('once the call is over, host actions say so', async () => {
  const { callId } = await callWith([2]);
  ok(await post(`/calls/${callId}/leave`, 2));
  ok(await post(`/calls/${callId}/leave`, 1));
  isErr(await post(`/calls/${callId}/participants/2/mute`, 1), 409, 'call_ended');
  isErr(await post(`/calls/${callId}/join-requests`, 2), 409, 'call_ended');
});
