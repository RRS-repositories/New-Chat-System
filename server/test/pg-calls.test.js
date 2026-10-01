// Call rows on real Postgres (PGlite): one live call per channel (the unique index, incl. a
// real race), participants, activation, finishing with duration, screen share and the boot sweep.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { createChannel } from '../src/repo/channels.js';
import {
  createCall, getCall, getLiveCall, listCalls, listParticipants, participantNames, addParticipant,
  removeParticipant, activateCall, finishCall, setScreenShare, sweepStaleCalls,
} from '../src/repo/calls.js';

const { db, close } = await createTestDb();
after(() => close());

const T0 = new Date('2026-09-30T10:00:00.000Z');
const at = (secs) => new Date(T0.getTime() + secs * 1000);
const newChannel = async (name) => (await createChannel(db, { name, displayName: name, type: 'private', createdBy: 1, memberIds: [2, 3, 5] })).id;

test('createCall: ringing voice call with the starter joined; mapped camelCase', async () => {
  const ch = await newChannel('calls-a');
  const call = await createCall(db, { channelId: ch, initiatedBy: 1, at: T0 });
  assert.equal(call.channelId, ch);
  assert.equal(call.initiatedBy, 1);
  assert.equal(call.initiatedByName, 'Meg Manager');
  assert.equal(call.type, 'voice');
  assert.equal(call.status, 'ringing');
  assert.equal(call.startedAt, null);
  assert.equal(call.endedAt, null);
  assert.equal(call.durationSecs, null);
  assert.equal(call.createdAt, T0.toISOString());
  assert.deepEqual(await listParticipants(db, call.id), [{ userId: 1, userName: 'Meg Manager', isSharingScreen: false }]);
  assert.deepEqual(await getCall(db, call.id), call);
  assert.deepEqual(await getLiveCall(db, ch), call);
});

test('getCall: unknown or malformed id is null, never a SQL error', async () => {
  assert.equal(await getCall(db, '00000000-0000-4000-8000-000000000000'), null);
  assert.equal(await getCall(db, 'not-a-uuid'), null);
  assert.equal(await getCall(db, undefined), null);
});

test('a second live call in the same channel is refused with call_in_progress + callId (unique index), even in a race', async () => {
  const ch = await newChannel('calls-race');
  const results = await Promise.allSettled([
    createCall(db, { channelId: ch, initiatedBy: 1, at: T0 }),
    createCall(db, { channelId: ch, initiatedBy: 2, at: T0 }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const bad = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.code, 'call_in_progress');
  assert.equal(bad[0].reason.status, 409);
  assert.equal(bad[0].reason.callId, ok[0].value.id);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM chat.calls WHERE channel_id = $1`, [ch]);
  assert.equal(rows[0].n, 1);
});

test('join, activate, leave, finish: duration from started_at, names in join order, everyone marked left', async () => {
  const ch = await newChannel('calls-b');
  const call = await createCall(db, { channelId: ch, initiatedBy: 2, at: T0 });
  await addParticipant(db, { callId: call.id, userId: 3, at: at(5) });
  const active = await activateCall(db, { callId: call.id, at: at(5) });
  assert.equal(active.status, 'active');
  assert.equal(active.startedAt, at(5).toISOString());
  assert.equal(await activateCall(db, { callId: call.id, at: at(6) }), null, 'only a ringing call activates');
  await addParticipant(db, { callId: call.id, userId: 1, at: at(10) });
  assert.deepEqual((await listParticipants(db, call.id)).map((p) => p.userId), [2, 3, 1]);

  // Leaving and re-joining keeps the original join position.
  assert.deepEqual(await removeParticipant(db, { callId: call.id, userId: 3, at: at(20) }), { wasParticipant: true, wasSharing: false });
  assert.deepEqual(await removeParticipant(db, { callId: call.id, userId: 3, at: at(21) }), { wasParticipant: false, wasSharing: false });
  assert.deepEqual((await listParticipants(db, call.id)).map((p) => p.userId), [2, 1]);
  await addParticipant(db, { callId: call.id, userId: 3, at: at(30) });
  assert.deepEqual((await listParticipants(db, call.id)).map((p) => p.userId), [2, 3, 1]);
  assert.deepEqual(await participantNames(db, call.id), ['Ann Agent', 'Bob Sales', 'Meg Manager']);

  const ended = await finishCall(db, { callId: call.id, status: 'ended', at: at(5 + 125) });
  assert.equal(ended.status, 'ended');
  assert.equal(ended.durationSecs, 125);
  assert.equal(ended.endedAt, at(130).toISOString());
  assert.deepEqual(await listParticipants(db, call.id), []);
  assert.equal(await getLiveCall(db, ch), null);
  assert.equal(await finishCall(db, { callId: call.id, status: 'ended', at: at(200) }), null, 'finishing twice is a no-op');
  // The channel is free for a new call again.
  assert.equal((await createCall(db, { channelId: ch, initiatedBy: 1, at: at(300) })).status, 'ringing');
});

test('a call that never started finishes with duration 0 (missed / declined)', async () => {
  const ch = await newChannel('calls-c');
  const call = await createCall(db, { channelId: ch, initiatedBy: 1, at: T0 });
  const missed = await finishCall(db, { callId: call.id, status: 'missed', at: at(30) });
  assert.equal(missed.status, 'missed');
  assert.equal(missed.durationSecs, 0);
});

test('screen share: one sharer at a time; not_in_call for someone not in it; leaving reports wasSharing', async () => {
  const ch = await newChannel('calls-d');
  const call = await createCall(db, { channelId: ch, initiatedBy: 1, at: T0 });
  await addParticipant(db, { callId: call.id, userId: 2, at: at(1) });
  assert.equal(await setScreenShare(db, { callId: call.id, userId: 5, on: true }), 'not_in_call');
  assert.equal(await setScreenShare(db, { callId: call.id, userId: 1, on: true }), 'changed');
  assert.equal(await setScreenShare(db, { callId: call.id, userId: 1, on: true }), 'unchanged');
  assert.equal(await setScreenShare(db, { callId: call.id, userId: 2, on: true }), 'already_sharing');
  assert.deepEqual((await listParticipants(db, call.id)).map((p) => [p.userId, p.isSharingScreen]), [[1, true], [2, false]]);
  assert.equal(await setScreenShare(db, { callId: call.id, userId: 2, on: false }), 'unchanged');
  assert.deepEqual(await removeParticipant(db, { callId: call.id, userId: 1, at: at(2) }), { wasParticipant: true, wasSharing: true });
  assert.equal(await setScreenShare(db, { callId: call.id, userId: 2, on: true }), 'changed');
  assert.equal(await setScreenShare(db, { callId: call.id, userId: 2, on: false }), 'changed');
});

test('listCalls: newest first, at most 30', async () => {
  const ch = await newChannel('calls-e');
  for (let i = 0; i < 32; i++) {
    const c = await createCall(db, { channelId: ch, initiatedBy: 1, at: at(i * 60) });
    await finishCall(db, { callId: c.id, status: 'missed', at: at(i * 60 + 30) });
  }
  const calls = await listCalls(db, ch);
  assert.equal(calls.length, 30);
  assert.equal(calls[0].createdAt, at(31 * 60).toISOString());
  assert.ok(calls.every((c, i) => i === 0 || c.createdAt < calls[i - 1].createdAt));
});

test('sweepStaleCalls ends every ringing/active call (status ended) and leaves finished ones alone', async () => {
  const a = await newChannel('sweep-a'), b = await newChannel('sweep-b'), c = await newChannel('sweep-c');
  const ringing = await createCall(db, { channelId: a, initiatedBy: 1, at: T0 });
  const active = await createCall(db, { channelId: b, initiatedBy: 2, at: T0 });
  await addParticipant(db, { callId: active.id, userId: 3, at: at(1) });
  await activateCall(db, { callId: active.id, at: at(1) });
  const done = await createCall(db, { channelId: c, initiatedBy: 1, at: T0 });
  await finishCall(db, { callId: done.id, status: 'missed', at: at(30) });

  const n = await sweepStaleCalls(db, { at: at(61) });
  assert.ok(n >= 2);
  assert.equal((await getCall(db, ringing.id)).status, 'ended');
  const act = await getCall(db, active.id);
  assert.equal(act.status, 'ended');
  assert.equal(act.durationSecs, 60);
  assert.equal((await getCall(db, done.id)).status, 'missed');
  assert.deepEqual(await listParticipants(db, active.id), []);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM chat.calls WHERE status IN ('ringing','active')`);
  assert.equal(rows[0].n, 0);
});
