// Call signalling on the socket: the handler wiring with a fake socket, then the real stack
// (createHttpStack + PGlite + socket.io-client) with one user in two tabs — both tabs hear the
// call, only the tab that joined gets the WebRTC signals, and closing that tab makes them leave.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { attachCallSignalling } from '../src/sockets/calls.socket.js';
import { createHttpStack } from '../src/server.js';
import { createTestDb } from './pg-helper.js';
import { createChannel } from '../src/models/channels.model.js';

const fakeSocket = (id) => Object.assign(new EventEmitter(), { id });

test('attachCallSignalling: webrtc_signal is relayed with the socket\'s own id and user; disconnect is reported', () => {
  const seen = [];
  const calls = { relaySignal: (a) => { seen.push(['signal', a]); return true; }, onSocketDisconnect: (...a) => seen.push(['disconnect', ...a]) };
  const socket = fakeSocket('sock-1');
  attachCallSignalling({ nsp: null, socket, user: { id: 7, fullName: 'Ann' }, calls });
  socket.emit('webrtc_signal', { call_id: 'c1', to_user_id: 8, signal_data: { sdp: 'x' }, from_user_id: 99 });
  socket.emit('webrtc_signal', null);       // junk payloads are ignored, not thrown
  socket.emit('webrtc_signal', 'nonsense');
  socket.emit('disconnect', 'transport close');
  assert.deepEqual(seen, [
    ['signal', { fromSocketId: 'sock-1', fromUserId: 7, callId: 'c1', toUserId: 8, signalData: { sdp: 'x' } }],
    ['disconnect', 'sock-1', 7],
  ]);
});

test('attachCallSignalling: a throwing service never escapes the handler; null calls is a no-op', () => {
  const socket = fakeSocket('s');
  attachCallSignalling({ nsp: null, socket, user: { id: 1 }, calls: { relaySignal() { throw new Error('x'); }, onSocketDisconnect() { throw new Error('y'); } } });
  socket.emit('webrtc_signal', { call_id: 'c', to_user_id: 2, signal_data: {} });
  socket.emit('disconnect');
  const s2 = fakeSocket('s2');
  attachCallSignalling({ nsp: null, socket: s2, user: { id: 1 }, calls: null });
  s2.emit('webrtc_signal', { call_id: 'c', to_user_id: 2, signal_data: {} });
  s2.emit('disconnect');
});

// --- real stack ---
const secret = 's'.repeat(40), aud = 'rrs-crm-session';
const { db, close } = await createTestDb();
const config = {
  sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false, redisUrl: '',
  stunUrls: ['stun:stun.example:3478'], turnUrls: [], turnSecret: '',
  callRingMs: 30_000, callMaxParticipants: 8, callDisconnectGraceMs: 150, presenceOfflineGraceMs: 50,
};
const stack = createHttpStack({ config, db });
await new Promise((r) => stack.httpServer.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${stack.httpServer.address().port}`;
const tok = (id) => jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' });
const client = (id) => connect(`${url}/chat`, { auth: { token: tok(id) }, transports: ['websocket'], forceNew: true });
const once = (s, ev) => new Promise((r) => s.once(ev, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
after(async () => { await stack.close(); await close(); });

test('two tabs: both hear call_started; only the joined tab gets signals; closing it makes the person leave after the grace', async () => {
  const ch = (await createChannel(db, { name: 'tabs', displayName: 'Tabs', type: 'private', createdBy: 1, memberIds: [2] })).id;
  const a1 = client(2), a2 = client(2), m = client(1);
  await Promise.all([once(a1, 'ready'), once(a2, 'ready'), once(m, 'ready')]);
  const heard = [once(a1, 'call_started'), once(a2, 'call_started')];

  const started = await request(stack.app).post(`/api/chat/channels/${ch}/calls`).set('Authorization', `Bearer ${tok(1)}`).send({ socketId: m.id });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const callId = started.body.call.id;
  const [e1, e2] = await Promise.all(heard);
  assert.equal(e1.call_id, callId); assert.equal(e2.call_id, callId);

  // Accept in tab 1: every tab of Ann sees the join (tab 2 stops ringing), the call is active.
  const joinedSeen = once(a2, 'call_participant_joined');
  const joined = await request(stack.app).post(`/api/chat/calls/${callId}/join`).set('Authorization', `Bearer ${tok(2)}`).send({ socketId: a1.id });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.call.status, 'active');
  assert.equal((await joinedSeen).user_id, 2);

  // Signals: Meg → Ann reach tab 1 only; a signal from Ann's other tab is dropped.
  let tab2Signals = 0; a2.on('webrtc_signal', () => tab2Signals++);
  let megSignals = 0; m.on('webrtc_signal', () => megSignals++);
  const got = once(a1, 'webrtc_signal');
  m.emit('webrtc_signal', { call_id: callId, to_user_id: 2, signal_data: { type: 'offer', sdp: 'v=0' } });
  assert.deepEqual(await got, { call_id: callId, from_user_id: 1, signal_data: { type: 'offer', sdp: 'v=0' } });
  a2.emit('webrtc_signal', { call_id: callId, to_user_id: 1, signal_data: { type: 'answer' } });
  const back = once(m, 'webrtc_signal');
  a1.emit('webrtc_signal', { call_id: callId, to_user_id: 1, signal_data: { type: 'answer', sdp: 'ok' } });
  assert.deepEqual(await back, { call_id: callId, from_user_id: 2, signal_data: { type: 'answer', sdp: 'ok' } });
  await wait(50);
  assert.equal(tab2Signals, 0);
  assert.equal(megSignals, 1);

  // Closing the call tab: Ann leaves after the grace; it is a group channel, so the call is still on for Meg.
  const left = once(m, 'call_participant_left');
  a1.close();
  const ev = await left;
  assert.equal(ev.user_id, 2);
  const cur = await request(stack.app).get(`/api/chat/calls/${callId}`).set('Authorization', `Bearer ${tok(1)}`);
  assert.deepEqual(cur.body.participants.map((p) => p.userId), [1]);

  // Meg closes her tab too: the call ends and a summary message is posted.
  const ended = once(a2, 'call_ended');
  m.close();
  assert.equal((await ended).status, 'ended');
  a2.close();
});
