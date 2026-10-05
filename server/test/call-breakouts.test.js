// Breakout groups: only the host arranges, opens and closes them; everyone in the call is told;
// people who leave drop out of their group; the whiteboard and screen sharing wait meanwhile.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MAX_GROUPS, cleanGroups, createCallBreakouts } from '../src/services/calls/call.breakouts.js';
import { attachCallSignalling } from '../src/sockets/calls.socket.js';
import { createApp } from '../src/app.js';
import { createCallService } from '../src/services/calls/call.service.js';
import { createChannel } from '../src/models/channels.model.js';
import { createTestDb } from './pg-helper.js';
import { secret, aud } from './route-helper.js';

// ---- the module on its own ---------------------------------------------------------------
function setup() {
  const sent = [];
  // Call k1: Meg (1, host) on s1, Ann (2) on s2, Bob (3) on s3, Cy (5) on s5.
  const devices = new Map([
    [
      'k1',
      new Map([
        [1, 's1'],
        [2, 's2'],
        [3, 's3'],
        [5, 's5'],
      ]),
    ],
  ]);
  const toCall = (callId, event, payload) => sent.push({ callId, event, payload });
  return { breakouts: createCallBreakouts({ devices, toCall }), sent, devices };
}
const host = { callId: 'k1', userId: 1, socketId: 's1', hostId: 1 };
const group = (id, name, member_ids) => ({ id, name, member_ids });

test('cleanGroups: only people in the call, nobody twice, never the host, tidy names', () => {
  const inCall = new Map([
    [1, 's1'],
    [2, 's2'],
    [3, 's3'],
  ]);
  assert.deepEqual(
    cleanGroups([group('g1', '  Group   1 ', [2, 2, 1, 99, 'x']), group('g2', 'Trainees', [3, 2])], {
      inCall,
      hostId: 1,
    }),
    [group('g1', 'Group 1', [2]), group('g2', 'Trainees', [3])],
  );
  const bad = [
    null,
    'groups',
    [null],
    [group('', 'A', [])],
    [group('has space', 'A', [])],
    [group('g1', '   ', [])],
    [group('g1', 5, [])],
    [{ id: 'g1', name: 'A' }],
    [group('g1', 'A', []), group('g1', 'B', [])],
    Array.from({ length: MAX_GROUPS + 1 }, (_, i) => group(`g${i}`, `G${i}`, [])),
  ];
  for (const groups of bad) assert.equal(cleanGroups(groups, { inCall, hostId: 1 }), null, JSON.stringify(groups));
  assert.equal(cleanGroups([group('g1', 'x'.repeat(90), [])], { inCall, hostId: 1 })[0].name.length, 40);
});

test('the host arranges groups, opens them and brings everyone back; the call is told each time', () => {
  const { breakouts, sent } = setup();
  assert.deepEqual(breakouts.snapshot('k1'), { breakout: { active: false, groups: [] } });
  assert.equal(breakouts.start(host), false, 'nothing to open yet');
  assert.equal(breakouts.set({ ...host, groups: [group('g1', 'Group 1', [2, 3])] }), true);
  assert.deepEqual(sent.at(-1), {
    callId: 'k1',
    event: 'call_bo_state',
    payload: { call_id: 'k1', active: false, groups: [group('g1', 'Group 1', [2, 3])] },
  });
  assert.equal(breakouts.isActive('k1'), false);
  assert.equal(breakouts.start(host), true);
  assert.equal(breakouts.isActive('k1'), true);
  assert.equal(sent.at(-1).payload.active, true);
  assert.equal(breakouts.start(host), false, 'already open');
  // Moving someone while the groups are open.
  assert.equal(breakouts.set({ ...host, groups: [group('g1', 'Group 1', [2]), group('g2', 'Group 2', [3])] }), true);
  assert.deepEqual(breakouts.snapshot('k1').breakout, {
    active: true,
    groups: [group('g1', 'Group 1', [2]), group('g2', 'Group 2', [3])],
  });
  assert.equal(breakouts.end(host), true);
  assert.equal(breakouts.isActive('k1'), false);
  assert.equal(breakouts.snapshot('k1').breakout.groups.length, 2, 'the groups are kept for next time');
  assert.equal(breakouts.end(host), false);
});

test('nobody but the host, on the host’s own call device, can change anything', () => {
  const { breakouts, sent } = setup();
  const groups = [group('g1', 'Group 1', [3])];
  assert.equal(breakouts.set({ callId: 'k1', userId: 2, socketId: 's2', hostId: 1, groups }), false);
  assert.equal(breakouts.set({ callId: 'k1', userId: 1, socketId: 'another-tab', hostId: 1, groups }), false);
  assert.equal(breakouts.set({ ...host, groups: 'nonsense' }), false);
  assert.equal(sent.length, 0);
  breakouts.set({ ...host, groups });
  assert.equal(breakouts.start({ callId: 'k1', userId: 2, socketId: 's2', hostId: 1 }), false);
  breakouts.start(host);
  assert.equal(breakouts.end({ callId: 'k1', userId: 3, socketId: 's3', hostId: 1 }), false);
  assert.equal(breakouts.isActive('k1'), true);
});

test('someone leaving the call leaves their group; when the last person in the groups goes, they close', () => {
  const { breakouts, sent } = setup();
  breakouts.set({ ...host, groups: [group('g1', 'Group 1', [2, 3])] });
  breakouts.start(host);
  sent.length = 0;
  breakouts.onLeft('k1', 5); // was in the main room: nothing to tell
  assert.equal(sent.length, 0);
  breakouts.onLeft('k1', 2);
  assert.deepEqual(sent.at(-1).payload, { call_id: 'k1', active: true, groups: [group('g1', 'Group 1', [3])] });
  breakouts.onLeft('k1', 3);
  assert.deepEqual(sent.at(-1).payload, { call_id: 'k1', active: false, groups: [group('g1', 'Group 1', [])] });
});

test('a new host is taken out of their group (the host is always in the main room); the end forgets everything', () => {
  const { breakouts } = setup();
  breakouts.set({ ...host, groups: [group('g1', 'Group 1', [2, 3])] });
  breakouts.start(host);
  breakouts.onHostChanged('k1', 2);
  assert.deepEqual(breakouts.snapshot('k1').breakout.groups, [group('g1', 'Group 1', [3])]);
  assert.equal(breakouts.set({ callId: 'k1', userId: 2, socketId: 's2', hostId: 2, groups: [] }), true);
  assert.equal(breakouts.isActive('k1'), false, 'no groups left: closed');
  breakouts.set({ ...host, groups: [group('g1', 'Group 1', [3])] });
  breakouts.forget('k1');
  assert.deepEqual(breakouts.snapshot('k1').breakout, { active: false, groups: [] });
});

test('the socket passes the three breakout messages to the call service', async () => {
  const socket = new EventEmitter();
  socket.id = 's1';
  const seen = [];
  const calls = {
    setBreakouts: async (a) => seen.push(['set', a]),
    startBreakouts: async (a) => seen.push(['start', a]),
    endBreakouts: async (a) => seen.push(['end', a]),
    onSocketDisconnect() {},
    relaySignal() {},
  };
  attachCallSignalling({ socket, user: { id: 1 }, calls });
  socket.emit('call_bo_set', { call_id: 'k1', groups: [] });
  socket.emit('call_bo_start', { call_id: 'k1' });
  socket.emit('call_bo_end', { call_id: 'k1' });
  socket.emit('call_bo_start', {});
  const who = { callId: 'k1', userId: 1, socketId: 's1' };
  assert.deepEqual(seen, [
    ['set', { ...who, groups: [] }],
    ['start', who],
    ['end', who],
  ]);
});

// ---- through the real call service -------------------------------------------------------
const { db, close } = await createTestDb();
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
const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false };
const calls = createCallService({ db, emit, notifier: {}, config });
const app = createApp({ config, db, emit, calls });
after(() => {
  calls.close();
  return close();
});
const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const post = (path, id, body = {}) => request(app).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body);

test('in a real call: the join answer carries the groups, the stand-in host takes over, and sharing and the whiteboard wait', async () => {
  const channel = await createChannel(db, {
    name: 'breakout-1',
    displayName: 'Breakout 1',
    type: 'private',
    createdBy: 1,
    memberIds: [2, 3, 5],
  });
  const started = await post(`/channels/${channel.id}/calls`, 1, { socketId: 's1' });
  assert.equal(started.status, 201);
  const callId = started.body.call.id;
  assert.deepEqual(started.body.breakout, { active: false, groups: [] });
  for (const u of [2, 3]) assert.equal((await post(`/calls/${callId}/join`, u, { socketId: `s${u}` })).status, 200);

  const groups = [group('g1', 'Group 1', [2]), group('g2', 'Group 2', [3])];
  assert.equal(await calls.setBreakouts({ callId, userId: 2, socketId: 's2', groups }), false, 'not the host');
  assert.equal(await calls.setBreakouts({ callId, userId: 1, socketId: 's1', groups }), true);

  // Ann shares her screen; opening the groups stops it, and nobody can share or draw while they are open.
  assert.equal((await post(`/calls/${callId}/screen-share`, 2, { on: true, socketId: 's2' })).status, 200);
  const mark = events.length;
  assert.equal(await calls.startBreakouts({ callId, userId: 1, socketId: 's1' }), true);
  assert.ok(
    events.slice(mark).some((e) => e.ev === 'call_screen_share_stopped' && e.p.user_id === 2),
    'the share was stopped',
  );
  const refused = await post(`/calls/${callId}/screen-share`, 3, { on: true, socketId: 's3' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'breakouts_open');
  const stroke = { type: 'stroke', id: 'stroke-1', points: [[0.1, 0.1]], color: '#6C4DE6', size: 6 };
  assert.equal(await calls.whiteboard({ callId, userId: 2, socketId: 's2', op: stroke }), false);

  // Someone joining now is told the arrangement.
  const late = await post(`/calls/${callId}/join`, 5, { socketId: 's5' });
  assert.deepEqual(late.body.breakout, { active: true, groups });

  // The host leaves: Ann (longest in the call) is the host, is taken out of her group, and can end the groups.
  assert.equal((await post(`/calls/${callId}/leave`, 1)).status, 200);
  const now = await request(app).get(`/api/chat/calls/${callId}`).set('Authorization', auth(2));
  assert.equal(now.body.hostId, 2);
  const after = await post(`/calls/${callId}/join`, 2, { socketId: 's2' }); // a re-join returns the current state
  assert.deepEqual(after.body.breakout, {
    active: true,
    groups: [group('g1', 'Group 1', []), group('g2', 'Group 2', [3])],
  });
  assert.equal(await calls.endBreakouts({ callId, userId: 3, socketId: 's3' }), false);
  assert.equal(await calls.endBreakouts({ callId, userId: 2, socketId: 's2' }), true);
  assert.equal((await post(`/calls/${callId}/screen-share`, 3, { on: true, socketId: 's3' })).status, 200);
  assert.equal(await calls.whiteboard({ callId, userId: 2, socketId: 's2', op: stroke }), true);
});
