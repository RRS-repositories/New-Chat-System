// Call service on real Postgres (PGlite) with a fake clock and fake timers: every lifecycle
// branch (ring timeout → missed, second join → active, last leave → ended + summary message,
// dm leave ends, starter leaves while ringing, disconnect grace), the 8-cap, one sharer,
// restrictions, re-join moving the device, decline, signal routing and the boot sweep.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { createChannel, openDm } from '../src/repo/channels.js';
import { addRestriction } from '../src/repo/restrictions.js';
import { createCall, getCall, addParticipant } from '../src/repo/calls.js';
import { createCallService } from '../src/calls/service.js';

const { db, close } = await createTestDb();
after(() => close());

// Extra users 6..13 so a call can be filled to 8 and a 9th refused.
for (let i = 6; i <= 13; i++) await db.query(`INSERT INTO users (id, email, full_name, role) VALUES ($1, $2, $3, 'Sales')`, [i, `u${i}@x`, `User ${i}`]);
const NAMES = { 1: 'Meg Manager', 2: 'Ann Agent', 3: 'Bob Sales', 5: 'Cy Sales' };
const U = (id) => ({ id, fullName: NAMES[id] || `User ${id}` });

const T0 = Date.parse('2026-09-30T10:00:00.000Z');
const CONFIG = { callRingMs: 30_000, callMaxParticipants: 8, callDisconnectGraceMs: 10_000, stunUrls: ['stun:stun.example:3478'], turnUrls: [], turnSecret: '' };

function fakeClock(start = T0) {
  let t = start;
  const handles = [];
  const timers = {
    setTimeout(fn, ms) { const h = { fn, due: t + ms, done: false, unrefed: false, unref() { this.unrefed = true; return this; } }; handles.push(h); return h; },
    clearTimeout(h) { if (h) h.done = true; },
  };
  return {
    now: () => t, timers, handles,
    pending: () => handles.filter((h) => !h.done).length,
    async advance(ms) {
      const until = t + ms;
      for (;;) {
        const next = handles.filter((h) => !h.done && h.due <= until).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        t = next.due; next.done = true;
        await next.fn();
      }
      t = until;
    },
  };
}

// A db whose queries matching `re` throw (the next `times` of them), for DB-blip tests.
function flakyDb(re, times = 1) {
  let left = times;
  return { failed: 0, async query(sql, params) {
    if (left > 0 && re.test(sql)) { left--; this.failed++; throw new Error('db blip'); }
    return db.query(sql, params);
  } };
}

function harness({ config = CONFIG, notifier, useDb = db, userOfSocket = null } = {}) {
  const events = [];
  const sockets = new Map();
  for (const id of [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]) { sockets.set(`s${id}`, id); sockets.set(`s${id}b`, id); }
  const emit = {
    toChannel: (id, ev, p) => events.push({ to: 'channel', id, ev, p }),
    toUser: (id, ev, p) => events.push({ to: 'user', id, ev, p }),
    toSocket: (id, ev, p) => events.push({ to: 'socket', id, ev, p }),
    toAll: (ev, p) => events.push({ to: 'all', ev, p }),
    userOfSocket: (s) => (userOfSocket ? userOfSocket(s, sockets) : sockets.get(s) ?? null),
    joinRoom() {}, leaveRoom() {},
  };
  const notes = [];
  const n = notifier !== undefined ? notifier : {
    onIncomingCall: async (a) => { notes.push(['incoming', a]); },
    onMissedCall: async (a) => { notes.push(['missed', a]); },
  };
  const clock = fakeClock();
  const calls = createCallService({ db: useDb, emit, notifier: n, config, socketsOfUser: () => [], now: clock.now, timers: clock.timers });
  const of = (ev) => events.filter((e) => e.ev === ev);
  return { calls, events, notes, clock, sockets, of };
}

let seq = 0;
const group = async (members = [2, 3, 5]) => (await createChannel(db, { name: `call-${++seq}`, displayName: `Call ${seq}`, type: 'private', createdBy: 1, memberIds: members })).id;
const rejects = async (p, status, code) => {
  await assert.rejects(p, (e) => { assert.equal(e.code, code); assert.equal(e.status, status); return true; });
};
const messagesOf = async (channelId) => (await db.query(
  `SELECT user_id, type, content FROM chat.messages WHERE channel_id = $1 ORDER BY created_at, id`, [channelId])).rows;

test('start: ringing call, starter joined on that socket, call_started to the channel room, incoming-call notifier for the other members', async () => {
  const h = harness(); const ch = await group();
  const out = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  assert.equal(out.call.status, 'ringing');
  assert.equal(out.call.channelId, ch);
  assert.equal(out.call.initiatedBy, 1);
  assert.equal(out.call.initiatedByName, 'Meg Manager');
  assert.equal(out.call.type, 'voice');
  assert.equal(out.call.createdAt, new Date(T0).toISOString());
  assert.deepEqual(out.participants, [{ userId: 1, userName: 'Meg Manager', isSharingScreen: false }]);
  assert.deepEqual(out.iceServers, [{ urls: ['stun:stun.example:3478'] }]);
  assert.deepEqual(h.of('call_started'), [{ to: 'channel', id: ch, ev: 'call_started', p: {
    call_id: out.call.id, channel_id: ch, channel_name: `Call ${seq}`, channel_type: 'private', initiated_by: 1, initiated_by_name: 'Meg Manager', type: 'voice' } }]);
  assert.equal(h.notes.length, 1);
  const [kind, args] = h.notes[0];
  assert.equal(kind, 'incoming');
  assert.equal(args.call.id, out.call.id);
  assert.deepEqual(args.channel, { id: ch, type: 'private', displayName: `Call ${seq}` });
  assert.equal(args.fromName, 'Meg Manager');
  assert.deepEqual([...args.userIds].sort((a, b) => a - b), [2, 3, 5]);
  assert.equal(h.clock.pending(), 1, 'ring timer armed');
  assert.ok(h.clock.handles[0].unrefed, 'timers are unref()ed');
  h.calls.close();
});

test('start refusals: bad_socket (someone else\'s / unknown socket), not_member, call_in_progress with callId', async () => {
  const h = harness(); const ch = await group([2, 3]);
  await rejects(h.calls.start({ channelId: ch, user: U(1), socketId: 's2' }), 400, 'bad_socket');
  await rejects(h.calls.start({ channelId: ch, user: U(1), socketId: 'nope' }), 400, 'bad_socket');
  await rejects(h.calls.start({ channelId: ch, user: U(1), socketId: undefined }), 400, 'bad_socket');
  await rejects(h.calls.start({ channelId: ch, user: U(5), socketId: 's5' }), 403, 'not_member');
  await rejects(h.calls.start({ channelId: 'not-a-uuid', user: U(5), socketId: 's5' }), 403, 'not_member');
  const first = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await assert.rejects(h.calls.start({ channelId: ch, user: U(2), socketId: 's2' }), (e) => {
    assert.equal(e.status, 409); assert.equal(e.code, 'call_in_progress'); assert.equal(e.callId, first.call.id); return true;
  });
  assert.equal(h.of('call_started').length, 1);
  h.calls.close();
});

test('two starts at once: exactly one call, the other gets 409 call_in_progress pointing at it (unique index)', async () => {
  const h = harness(); const ch = await group();
  const res = await Promise.allSettled([
    h.calls.start({ channelId: ch, user: U(1), socketId: 's1' }),
    h.calls.start({ channelId: ch, user: U(2), socketId: 's2' }),
  ]);
  const ok = res.filter((r) => r.status === 'fulfilled'), bad = res.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1); assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.code, 'call_in_progress');
  assert.equal(bad[0].reason.callId, ok[0].value.call.id);
  assert.equal(h.clock.pending(), 1, 'only the winner has a ring timer');
  h.calls.close();
});

test('ring timeout while still ringing → missed, "Missed call from <Name>" by the initiator, call_ended missed, missed-call notifier', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.clock.advance(29_999);
  assert.equal((await getCall(db, call.id)).status, 'ringing');
  await h.clock.advance(1);
  const row = await getCall(db, call.id);
  assert.equal(row.status, 'missed');
  assert.equal(row.durationSecs, 0);
  assert.deepEqual(await messagesOf(ch), [{ user_id: 1, type: 'call', content: 'Missed call from Meg Manager' }]);
  const nm = h.of('new_message');
  assert.equal(nm.length, 1);
  assert.equal(nm[0].id, ch);
  assert.equal(nm[0].p.channel_id, ch);
  assert.equal(nm[0].p.message.type, 'call');
  assert.equal(nm[0].p.message.content, 'Missed call from Meg Manager');
  assert.deepEqual(h.of('call_ended').map((e) => [e.to, e.id, e.p]), [['channel', ch, { call_id: call.id, channel_id: ch, status: 'missed', duration_secs: 0 }]]);
  const missed = h.notes.filter(([k]) => k === 'missed');
  assert.equal(missed.length, 1);
  assert.equal(missed[0][1].fromName, 'Meg Manager');
  assert.deepEqual([...missed[0][1].userIds].sort((a, b) => a - b), [2, 3, 5]);
  assert.deepEqual(missed[0][1].channel, { id: ch, type: 'private', displayName: `Call ${seq}` });
  // The channel is free for a new call.
  assert.equal((await h.calls.start({ channelId: ch, user: U(2), socketId: 's2' })).call.status, 'ringing');
  h.calls.close();
});

test('ring time defaults to 30 s when the config has no call keys', async () => {
  const h = harness({ config: {} }); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.clock.advance(29_999);
  assert.equal((await getCall(db, call.id)).status, 'ringing');
  await h.clock.advance(1);
  assert.equal((await getCall(db, call.id)).status, 'missed');
  h.calls.close();
});

test('second participant joins → active with started_at = now, ring timer cancelled, call_participant_joined to the room', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.clock.advance(4000);
  const out = await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  assert.equal(out.call.status, 'active');
  assert.equal(out.call.startedAt, new Date(T0 + 4000).toISOString());
  assert.deepEqual(out.participants.map((p) => p.userId), [1, 2]);
  assert.deepEqual(out.iceServers, [{ urls: ['stun:stun.example:3478'] }]);
  assert.deepEqual(h.of('call_participant_joined').map((e) => [e.to, e.id, e.p]), [['channel', ch, { call_id: call.id, channel_id: ch, user_id: 2, user_name: 'Ann Agent' }]]);
  await h.clock.advance(60_000);
  assert.equal((await getCall(db, call.id)).status, 'active', 'no missed after the ring time');
  assert.equal(h.of('call_ended').length, 0);
  assert.equal(h.notes.filter(([k]) => k === 'missed').length, 0);
  h.calls.close();
});

test('group call: leaving is announced; the call ends only when the last person leaves, with the summary message', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.clock.advance(1000);
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });          // active at +1 s
  await h.clock.advance(1000);
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3' });
  await h.clock.advance(60_000);
  await h.calls.leave({ callId: call.id, userId: 1 });
  assert.equal((await getCall(db, call.id)).status, 'active');
  assert.deepEqual(h.of('call_participant_left').map((e) => [e.to, e.id, e.p]), [['channel', ch, { call_id: call.id, channel_id: ch, user_id: 1 }]]);
  await h.calls.leave({ callId: call.id, userId: 1 }); // idempotent
  assert.equal(h.of('call_participant_left').length, 1);
  await h.clock.advance(64_000);
  await h.calls.leave({ callId: call.id, userId: 2 });
  await h.calls.leave({ callId: call.id, userId: 3 });                         // ends at +126 s → 125 s after start
  const row = await getCall(db, call.id);
  assert.equal(row.status, 'ended');
  assert.equal(row.durationSecs, 125);
  const msgs = await messagesOf(ch);
  assert.deepEqual(msgs, [{ user_id: 1, type: 'call', content: 'Voice call — 2m 5s — Meg Manager, Ann Agent, Bob Sales' }]);
  assert.equal(h.of('new_message').length, 1);
  assert.deepEqual(h.of('call_ended').map((e) => e.p), [{ call_id: call.id, channel_id: ch, status: 'ended', duration_secs: 125 }]);
  await h.calls.leave({ callId: call.id, userId: 3 }); // leaving an ended call is still fine
  assert.equal(h.clock.pending(), 0);
  h.calls.close();
});

test('dm: when one person leaves an active call it ends for both', async () => {
  const h = harness(); const dm = await openDm(db, 2, 3);
  const { call } = await h.calls.start({ channelId: dm.id, user: U(2), socketId: 's2' });
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3' });
  await h.clock.advance(7000);
  await h.calls.leave({ callId: call.id, userId: 3 });
  const row = await getCall(db, call.id);
  assert.equal(row.status, 'ended');
  assert.equal(row.durationSecs, 7);
  assert.deepEqual(h.of('call_ended').map((e) => e.p), [{ call_id: call.id, channel_id: dm.id, status: 'ended', duration_secs: 7 }]);
  assert.deepEqual((await messagesOf(dm.id)).map((m) => m.content), ['Voice call — 0m 7s — Ann Agent, Bob Sales']);
  assert.equal((await h.calls.get({ callId: call.id, userId: 2 })).participants.length, 0);
  h.calls.close();
});

test('the starter hanging up while it still rings → missed path without the push', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.clock.advance(5000);
  await h.calls.leave({ callId: call.id, userId: 1 });
  assert.equal((await getCall(db, call.id)).status, 'missed');
  assert.deepEqual((await messagesOf(ch)).map((m) => m.content), ['Missed call from Meg Manager']);
  assert.deepEqual(h.of('call_ended').map((e) => e.p.status), ['missed']);
  assert.equal(h.notes.filter(([k]) => k === 'missed').length, 0, 'no missed-call push');
  assert.equal(h.clock.pending(), 0, 'ring timer cleared');
  await h.clock.advance(60_000);
  assert.equal(h.of('call_ended').length, 1);
  h.calls.close();
});

test('disconnect grace: the call socket going away makes the person leave after the grace unless they re-join; other sockets do not count', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3' });

  h.calls.onSocketDisconnect('s2b', 2);              // not the call device: nothing
  assert.equal(h.clock.pending(), 0);
  h.calls.onSocketDisconnect('s2', 2);
  await h.clock.advance(9_999);
  assert.equal(h.of('call_participant_left').length, 0);
  await h.clock.advance(1);
  assert.deepEqual(h.of('call_participant_left').map((e) => e.p.user_id), [2]);

  // Re-join from another socket within the grace cancels the pending leave.
  h.calls.onSocketDisconnect('s3', 3);
  await h.clock.advance(5000);
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3b' });
  await h.clock.advance(20_000);
  assert.deepEqual(h.of('call_participant_left').map((e) => e.p.user_id), [2]);
  assert.deepEqual((await h.calls.get({ callId: call.id, userId: 1 })).participants.map((p) => p.userId), [1, 3]);

  // The starter's device dropping mid-ring ends a ringing call (missed) after the grace.
  const ch2 = await group();
  const r = await h.calls.start({ channelId: ch2, user: U(5), socketId: 's5' });
  h.calls.onSocketDisconnect('s5', 5);
  await h.clock.advance(10_000);
  assert.equal((await getCall(db, r.call.id)).status, 'missed');
  h.calls.close();
});

test('decentralised: three in a call, one disconnects → only their call_participant_left; the other two stay in an active call and keep signalling', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3' });
  h.calls.onSocketDisconnect('s3', 3);
  await h.clock.advance(10_000);
  assert.deepEqual(h.of('call_participant_left').map((e) => e.p.user_id), [3]);
  assert.equal(h.of('call_ended').length, 0);
  const now = await h.calls.get({ callId: call.id, userId: 1 });
  assert.equal(now.call.status, 'active');
  assert.deepEqual(now.participants.map((p) => p.userId), [1, 2]);
  assert.equal(h.calls.relaySignal({ fromSocketId: 's1', fromUserId: 1, callId: call.id, toUserId: 2, signalData: { a: 1 } }), true);
  assert.equal(h.calls.relaySignal({ fromSocketId: 's1', fromUserId: 1, callId: call.id, toUserId: 3, signalData: { a: 1 } }), false);
  h.calls.close();
});

test('a relay failing for one pair (emit throws) is dropped for that pair only; the call and the other pairs are untouched', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3' });
  // Make delivery to s3 blow up.
  const events = h.events; const orig = events.push.bind(events);
  events.push = (e) => { if (e.to === 'socket' && e.id === 's3') throw new Error('socket gone'); return orig(e); };
  assert.equal(h.calls.relaySignal({ fromSocketId: 's1', fromUserId: 1, callId: call.id, toUserId: 3, signalData: {} }), false);
  assert.equal(h.calls.relaySignal({ fromSocketId: 's1', fromUserId: 1, callId: call.id, toUserId: 2, signalData: {} }), true);
  events.push = orig;
  const cur = await h.calls.get({ callId: call.id, userId: 1 });
  assert.equal(cur.call.status, 'active');
  assert.deepEqual(cur.participants.map((p) => p.userId), [1, 2, 3]);
  assert.equal(h.of('call_participant_left').length, 0);
  h.calls.close();
});

test('an emit failure while someone leaves does not stop the call from being ended correctly for the rest', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  const events = h.events; const orig = events.push.bind(events);
  events.push = (e) => { if (e.ev === 'call_participant_left') throw new Error('adapter hiccup'); return orig(e); };
  await h.calls.leave({ callId: call.id, userId: 1 });
  await h.calls.leave({ callId: call.id, userId: 2 });
  events.push = orig;
  assert.equal((await getCall(db, call.id)).status, 'ended');
  assert.equal(h.of('call_ended').length, 1);
  h.calls.close();
});

test('8-cap: a 9th person gets call_full; someone already in may re-join from another socket', async () => {
  const h = harness(); const ch = await group([2, 3, 5, 6, 7, 8, 9, 10, 11]);
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  for (const id of [2, 3, 5, 6, 7, 8, 9]) await h.calls.join({ callId: call.id, user: U(id), socketId: `s${id}` });
  await rejects(h.calls.join({ callId: call.id, user: U(10), socketId: 's10' }), 403, 'call_full');
  const again = await h.calls.join({ callId: call.id, user: U(9), socketId: 's9b' });
  assert.equal(again.participants.length, 8);
  // Two racing joins for the last seat: only one gets it.
  await h.calls.leave({ callId: call.id, userId: 9 });
  const res = await Promise.allSettled([
    h.calls.join({ callId: call.id, user: U(10), socketId: 's10' }),
    h.calls.join({ callId: call.id, user: U(11), socketId: 's11' }),
  ]);
  assert.deepEqual(res.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(res.find((r) => r.status === 'rejected').reason.code, 'call_full');
  assert.equal((await h.calls.get({ callId: call.id, userId: 1 })).participants.length, 8);
  h.calls.close();
});

test('max participants follows config.callMaxParticipants', async () => {
  const h = harness({ config: { ...CONFIG, callMaxParticipants: 2 } }); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await rejects(h.calls.join({ callId: call.id, user: U(3), socketId: 's3' }), 403, 'call_full');
  h.calls.close();
});

test('join refusals: not_found, not_member, call_ended, bad_socket', async () => {
  const h = harness(); const ch = await group([2]);
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await rejects(h.calls.join({ callId: '00000000-0000-4000-8000-000000000000', user: U(2), socketId: 's2' }), 404, 'not_found');
  await rejects(h.calls.join({ callId: 'junk', user: U(2), socketId: 's2' }), 404, 'not_found');
  await rejects(h.calls.join({ callId: call.id, user: U(3), socketId: 's3' }), 403, 'not_member');
  await rejects(h.calls.join({ callId: call.id, user: U(2), socketId: 's3' }), 400, 'bad_socket');
  await h.calls.leave({ callId: call.id, userId: 1 });
  await rejects(h.calls.join({ callId: call.id, user: U(2), socketId: 's2' }), 409, 'call_ended');
  h.calls.close();
});

test('restrictions: a call or all row either way refuses a DM call (start and join); a group channel is not affected', async () => {
  const h = harness();
  const dm23 = await openDm(db, 2, 3);
  await addRestriction(db, { userId: 3, targetUserId: 2, restriction: 'call', restrictedBy: 1 });
  for (const [u, s] of [[2, 's2'], [3, 's3']]) {
    await assert.rejects(h.calls.start({ channelId: dm23.id, user: U(u), socketId: s }), (e) => {
      assert.equal(e.status, 403); assert.equal(e.code, 'restricted'); assert.equal(e.message, 'You cannot call this person'); return true;
    });
  }
  const dm25 = await openDm(db, 2, 5);
  await addRestriction(db, { userId: 2, targetUserId: 5, restriction: 'all', restrictedBy: 1 });
  await rejects(h.calls.start({ channelId: dm25.id, user: U(5), socketId: 's5' }), 403, 'restricted');
  // A dm-only restriction is not a call restriction.
  const dm15 = await openDm(db, 1, 5);
  await addRestriction(db, { userId: 1, targetUserId: 5, restriction: 'dm', restrictedBy: 1 });
  await h.calls.start({ channelId: dm15.id, user: U(1), socketId: 's1' });
  // Restriction added after the call started: the callee cannot join it.
  const dm35 = await openDm(db, 3, 5);
  const { call } = await h.calls.start({ channelId: dm35.id, user: U(3), socketId: 's3' });
  await addRestriction(db, { userId: 5, targetUserId: 3, restriction: 'call', restrictedBy: 1 });
  await rejects(h.calls.join({ callId: call.id, user: U(5), socketId: 's5' }), 403, 'restricted');
  // Group channel with the same restricted pair: allowed.
  const ch = await group([2, 3]);
  const g = await h.calls.start({ channelId: ch, user: U(2), socketId: 's2' });
  await h.calls.join({ callId: g.call.id, user: U(3), socketId: 's3' });
  h.calls.close();
});

test('screen share: one sharer at a time, not_in_call for outsiders, events, a leaving sharer stops sharing', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3' });
  const share = (userId, on, socketId = `s${userId}`) => h.calls.screenShare({ callId: call.id, userId, on, socketId });
  await rejects(share(5, true), 403, 'not_in_call');
  await rejects(h.calls.screenShare({ callId: 'junk', userId: 1, on: true, socketId: 's1' }), 403, 'not_in_call');
  await share(1, true);
  await share(1, true); // no second event
  await rejects(share(2, true), 409, 'already_sharing');
  assert.deepEqual(h.of('call_screen_share_started').map((e) => [e.to, e.id, e.p]), [['channel', ch, { call_id: call.id, channel_id: ch, user_id: 1 }]]);
  await share(1, false);
  assert.deepEqual(h.of('call_screen_share_stopped').map((e) => e.p), [{ call_id: call.id, channel_id: ch, user_id: 1 }]);
  await share(2, true);
  await h.calls.leave({ callId: call.id, userId: 2 });
  assert.deepEqual(h.of('call_screen_share_stopped').map((e) => e.p.user_id), [1, 2]);
  const left = h.events.findIndex((e) => e.ev === 'call_participant_left');
  const stopped = h.events.findLastIndex((e) => e.ev === 'call_screen_share_stopped');
  assert.ok(left < stopped, 'left, then share stopped');
  await share(3, true); // the seat is free again
  h.calls.close();
});

test('screen share must come from the call device: another tab, someone else\'s or no socket → 400 bad_socket', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  for (const socketId of ['s1b', 's2', undefined]) {
    await rejects(h.calls.screenShare({ callId: call.id, userId: 1, on: true, socketId }), 400, 'bad_socket');
  }
  assert.equal(h.of('call_screen_share_started').length, 0);
  // After moving the device to another tab, only that tab may toggle.
  await h.calls.join({ callId: call.id, user: U(1), socketId: 's1b' });
  await rejects(h.calls.screenShare({ callId: call.id, userId: 1, on: true, socketId: 's1' }), 400, 'bad_socket');
  await h.calls.screenShare({ callId: call.id, userId: 1, on: true, socketId: 's1b' });
  assert.equal(h.of('call_screen_share_started').length, 1);
  h.calls.close();
});

test('decline: in a dm while ringing ends it as declined with "Call declined"; in a group only dismisses the decliner\'s own ring', async () => {
  const h = harness(); const dm = await openDm(db, 1, 2);
  const { call } = await h.calls.start({ channelId: dm.id, user: U(1), socketId: 's1' });
  await h.calls.decline({ callId: call.id, user: U(2) });
  assert.equal((await getCall(db, call.id)).status, 'declined');
  assert.deepEqual(h.of('call_ended').map((e) => [e.id, e.p]), [[dm.id, { call_id: call.id, channel_id: dm.id, status: 'declined', duration_secs: 0 }]]);
  assert.deepEqual(await messagesOf(dm.id), [{ user_id: 1, type: 'call', content: 'Call declined' }]);
  assert.equal(h.notes.filter(([k]) => k === 'missed').length, 0);
  assert.equal(h.clock.pending(), 0);

  const ch = await group();
  const g = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.decline({ callId: g.call.id, user: U(3) });
  assert.equal((await getCall(db, g.call.id)).status, 'ringing');
  assert.deepEqual(h.of('call_dismissed').map((e) => [e.to, e.id, e.p]), [['user', 3, { call_id: g.call.id }]]);
  await rejects(h.calls.decline({ callId: g.call.id, user: U(13) }), 403, 'not_member');
  await rejects(h.calls.decline({ callId: 'junk', user: U(3) }), 404, 'not_found');
  h.calls.close();
});

test('signal routing: only from the sender\'s call socket, only to a current participant\'s call socket, ≤ 64 KB', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  const sig = { type: 'offer', sdp: 'v=0' };
  const signals = () => h.of('webrtc_signal');

  assert.equal(h.calls.relaySignal({ fromSocketId: 's2', fromUserId: 2, callId: call.id, toUserId: 1, signalData: sig }), true);
  assert.deepEqual(signals(), [{ to: 'socket', id: 's1', ev: 'webrtc_signal', p: { call_id: call.id, from_user_id: 2, signal_data: sig } }]);

  const drop = (args) => assert.equal(h.calls.relaySignal({ callId: call.id, signalData: sig, ...args }), false);
  drop({ fromSocketId: 's2b', fromUserId: 2, toUserId: 1 });           // sender's other tab
  drop({ fromSocketId: 's3', fromUserId: 3, toUserId: 1 });            // not in the call
  drop({ fromSocketId: 's2', fromUserId: 2, toUserId: 3 });            // target not in the call
  drop({ fromSocketId: 's2', fromUserId: 2, toUserId: 2 });            // to self
  drop({ fromSocketId: 's1', fromUserId: 2, toUserId: 1 });            // someone else's socket
  drop({ fromSocketId: 's2', fromUserId: 2, toUserId: 1, callId: 'junk' });
  drop({ fromSocketId: 's2', fromUserId: 2, toUserId: 1, signalData: { sdp: 'x'.repeat(64 * 1024) } });
  assert.equal(h.calls.relaySignal({ fromSocketId: 's2', fromUserId: 2, callId: call.id, toUserId: 1, signalData: { sdp: 'x'.repeat(60 * 1024) } }), true);
  assert.equal(signals().length, 2);

  // Re-joining from another tab moves the device: signals now go to (and only come from) the new socket.
  await h.calls.join({ callId: call.id, user: U(1), socketId: 's1b' });
  assert.equal(h.calls.relaySignal({ fromSocketId: 's2', fromUserId: 2, callId: call.id, toUserId: 1, signalData: sig }), true);
  assert.equal(signals().at(-1).id, 's1b');
  drop({ fromSocketId: 's1', fromUserId: 1, toUserId: 2 });
  assert.equal(h.calls.relaySignal({ fromSocketId: 's1b', fromUserId: 1, callId: call.id, toUserId: 2, signalData: sig }), true);
  assert.equal(signals().at(-1).id, 's2');
  // The old tab disconnecting no longer affects the call.
  h.calls.onSocketDisconnect('s1', 1);
  await h.clock.advance(20_000);
  assert.equal(h.of('call_participant_left').length, 0);

  // After a leave, the leaver neither sends nor receives.
  await h.calls.leave({ callId: call.id, userId: 2 });
  drop({ fromSocketId: 's2', fromUserId: 2, toUserId: 1 });
  h.calls.close();
});

test('get / active / list: members only', async () => {
  const h = harness(); const ch = await group([2]);
  assert.deepEqual(await h.calls.activeCall({ channelId: ch, userId: 2 }), { call: null, participants: [] });
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  const act = await h.calls.activeCall({ channelId: ch, userId: 2 });
  assert.equal(act.call.id, call.id);
  assert.deepEqual(act.participants.map((p) => p.userId), [1]);
  assert.equal((await h.calls.get({ callId: call.id, userId: 2 })).call.id, call.id);
  assert.deepEqual((await h.calls.listCalls({ channelId: ch, userId: 2 })).map((c) => c.id), [call.id]);
  await rejects(h.calls.get({ callId: call.id, userId: 3 }), 403, 'not_member');
  await rejects(h.calls.get({ callId: 'junk', userId: 3 }), 404, 'not_found');
  await rejects(h.calls.activeCall({ channelId: ch, userId: 3 }), 403, 'not_member');
  await rejects(h.calls.listCalls({ channelId: ch, userId: 3 }), 403, 'not_member');
  h.calls.close();
});

test('a notifier without the call hooks, or one that rejects/throws, never breaks a call', async () => {
  for (const notifier of [null, {}, { onIncomingCall: async () => { throw new Error('boom'); }, onMissedCall: () => { throw new Error('sync boom'); } }]) {
    const h = harness({ notifier }); const ch = await group();
    const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
    await h.clock.advance(30_000);
    assert.equal((await getCall(db, call.id)).status, 'missed');
    h.calls.close();
  }
  await new Promise((r) => setImmediate(r));
});

test('sweepStaleCalls ends ringing/active calls left over from before a restart, with no system message', async () => {
  const ch = await group();
  const stale = await createCall(db, { channelId: ch, initiatedBy: 1, at: new Date(T0 - 60_000) });
  await addParticipant(db, { callId: stale.id, userId: 2 });
  const h = harness();
  await h.calls.sweepStaleCalls();
  assert.equal((await getCall(db, stale.id)).status, 'ended');
  assert.deepEqual(await messagesOf(ch), []);
  assert.equal((await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' })).call.status, 'ringing');
  h.calls.close();
});

test('close() clears every pending timer and later callbacks do nothing', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  const ch2 = await group();
  await h.calls.start({ channelId: ch2, user: U(3), socketId: 's3' });
  h.calls.onSocketDisconnect('s2', 2);
  assert.equal(h.clock.pending(), 2);
  h.calls.close();
  assert.equal(h.clock.pending(), 0);
  for (const hd of h.clock.handles) await hd.fn();
  assert.equal(h.of('call_participant_left').length, 0);
  assert.equal(h.of('call_ended').length, 0);
});

// ---- Fix round 1 ----

test('ghost starter: the start socket disconnecting while start is in flight → the starter leaves after the grace, the call is missed, the channel is free', async () => {
  let checks = 0;
  // The start socket is live for the first ownership check only, then it is gone.
  const h = harness({ userOfSocket: (s, sockets) => (s === 's1' ? (checks++ === 0 ? 1 : null) : sockets.get(s) ?? null) });
  const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  // (Its disconnect was handled before the device was recorded, so onSocketDisconnect found nothing.)
  await h.clock.advance(9_999);
  assert.equal((await getCall(db, call.id)).status, 'ringing');
  await h.clock.advance(1);
  assert.equal((await getCall(db, call.id)).status, 'missed');
  assert.deepEqual(h.of('call_participant_left').map((e) => e.p.user_id), [1]);
  assert.equal((await h.calls.start({ channelId: ch, user: U(2), socketId: 's2' })).call.status, 'ringing');
  h.calls.close();
});

test('ghost joiner: the join socket gone by the time the device is recorded → they leave after the grace, the call carries on', async () => {
  let s3checks = 0;
  const h = harness({ userOfSocket: (s, sockets) => (s === 's3' ? (s3checks++ === 0 ? 3 : null) : sockets.get(s) ?? null) });
  const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await h.calls.join({ callId: call.id, user: U(3), socketId: 's3' });
  await h.clock.advance(10_000);
  assert.deepEqual(h.of('call_participant_left').map((e) => e.p.user_id), [3]);
  const cur = await h.calls.get({ callId: call.id, userId: 1 });
  assert.equal(cur.call.status, 'active');
  assert.deepEqual(cur.participants.map((p) => p.userId), [1, 2]);
  h.calls.close();
});

// A call live in the DB that this process does not know (the boot sweep failed or raced).
async function orphanCall(ch, { active = false } = {}) {
  const c = await createCall(db, { channelId: ch, initiatedBy: 1, at: new Date(T0 - 60_000) });
  if (active) {
    await addParticipant(db, { callId: c.id, userId: 2 });
    await db.query(`UPDATE chat.calls SET status = 'active', started_at = $2 WHERE id = $1`, [c.id, new Date(T0 - 50_000)]);
  }
  return c;
}

test('stale repair on start: a live call unknown to this process is ended (no system message) and the new call starts', async () => {
  const h = harness(); const ch = await group();
  const stale = await orphanCall(ch, { active: true });
  const { call } = await h.calls.start({ channelId: ch, user: U(3), socketId: 's3' });
  assert.equal(call.status, 'ringing');
  assert.notEqual(call.id, stale.id);
  assert.equal((await getCall(db, stale.id)).status, 'ended');
  assert.deepEqual(await messagesOf(ch), []);
  assert.deepEqual(h.of('call_ended').map((e) => e.p), [{ call_id: stale.id, channel_id: ch, status: 'ended', duration_secs: 50 }]);
  h.calls.close();
});

test('stale repair on join → 409 call_ended; on GET active → call null; on GET one → the ended call', async () => {
  const h = harness();
  const a = await group(); const s1 = await orphanCall(a);
  await rejects(h.calls.join({ callId: s1.id, user: U(2), socketId: 's2' }), 409, 'call_ended');
  assert.equal((await getCall(db, s1.id)).status, 'ended');
  const b = await group(); const s2 = await orphanCall(b, { active: true });
  assert.deepEqual(await h.calls.activeCall({ channelId: b, userId: 2 }), { call: null, participants: [] });
  assert.equal((await getCall(db, s2.id)).status, 'ended');
  const c = await group(); const s3 = await orphanCall(c);
  const got = await h.calls.get({ callId: s3.id, userId: 2 });
  assert.equal(got.call.status, 'ended');
  assert.deepEqual(got.participants, []);
  assert.deepEqual([...await messagesOf(a), ...await messagesOf(b), ...await messagesOf(c)], []);
  h.calls.close();
});

test('a live call this process knows is never treated as stale by GET active / get / a second start', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  assert.equal((await h.calls.activeCall({ channelId: ch, userId: 2 })).call.id, call.id);
  assert.equal((await h.calls.get({ callId: call.id, userId: 2 })).call.status, 'ringing');
  await rejects(h.calls.start({ channelId: ch, user: U(2), socketId: 's2' }), 409, 'call_in_progress');
  assert.equal((await getCall(db, call.id)).status, 'ringing');
  h.calls.close();
});

test('a join racing a start for the same channel never "repairs" the call being started', async () => {
  const h = harness(); const ch = await group();
  const starting = h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  // Poll for the row while start is still in flight and GET active at once.
  let seen = null;
  for (let i = 0; i < 50 && !seen; i++) {
    const r = await db.query(`SELECT id FROM chat.calls WHERE channel_id = $1 AND status IN ('ringing','active')`, [ch]);
    if (r.rows[0]) { seen = r.rows[0].id; await h.calls.activeCall({ channelId: ch, userId: 2 }); }
  }
  const { call } = await starting;
  assert.equal((await getCall(db, call.id)).status, 'ringing');
  h.calls.close();
});

test('a live call with nobody left (end failed on a DB blip) is ended by the next start', async () => {
  const flaky = flakyDb(/UPDATE chat\.calls SET status = \$3/, 1);
  const h = harness({ useDb: flaky }); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await h.calls.leave({ callId: call.id, userId: 1 });
  await assert.rejects(h.calls.leave({ callId: call.id, userId: 2 }), /db blip/);
  assert.equal(flaky.failed, 1);
  assert.equal((await getCall(db, call.id)).status, 'active', 'the blip left it live with 0 participants');
  const next = await h.calls.start({ channelId: ch, user: U(3), socketId: 's3' });
  assert.equal(next.call.status, 'ringing');
  assert.equal((await getCall(db, call.id)).status, 'ended');
  h.calls.close();
});

test('join: a failed participant insert leaves no signalling-capable device behind', async () => {
  const flaky = flakyDb(/INSERT INTO chat\.call_participants \(call_id, user_id, joined_at\) VALUES/, 1);
  const h = harness({ useDb: flaky }); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await assert.rejects(h.calls.join({ callId: call.id, user: U(2), socketId: 's2' }), /db blip/);
  assert.equal(h.calls.relaySignal({ fromSocketId: 's2', fromUserId: 2, callId: call.id, toUserId: 1, signalData: {} }), false);
  assert.equal(h.calls.relaySignal({ fromSocketId: 's1', fromUserId: 1, callId: call.id, toUserId: 2, signalData: {} }), false);
  // A retry works normally.
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  assert.equal(h.calls.relaySignal({ fromSocketId: 's2', fromUserId: 2, callId: call.id, toUserId: 1, signalData: {} }), true);
  h.calls.close();
});

test('a notifier whose onIncomingCall throws synchronously: start still resolves and call_started is sent', async () => {
  const h = harness({ notifier: { onIncomingCall() { throw new Error('sync boom'); } } }); const ch = await group();
  const out = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  assert.equal(out.call.status, 'ringing');
  assert.equal(h.of('call_started').length, 1);
  h.calls.close();
});

test('grace timer and an HTTP leave for the same person at once → one participant_left, one call_ended, one message', async () => {
  const h = harness(); const ch = await group();
  const { call } = await h.calls.start({ channelId: ch, user: U(1), socketId: 's1' });
  await h.calls.join({ callId: call.id, user: U(2), socketId: 's2' });
  await h.calls.leave({ callId: call.id, userId: 1 });
  h.calls.onSocketDisconnect('s2', 2);
  await h.clock.advance(9_999);
  await Promise.all([h.clock.advance(1), h.calls.leave({ callId: call.id, userId: 2 }), h.calls.leave({ callId: call.id, userId: 2 })]);
  assert.deepEqual(h.of('call_participant_left').map((e) => e.p.user_id), [1, 2]);
  assert.equal(h.of('call_ended').length, 1);
  assert.equal((await messagesOf(ch)).length, 1);
  assert.equal(h.of('new_message').length, 1);
  h.calls.close();
});
