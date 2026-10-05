// In-call reactions and raised hands: relayed to the people in the call and nobody else,
// only from the sender's own call device, never stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { REACTION_BURST, REACTION_WINDOW_MS, createCallExtras, isEmoji } from '../src/services/calls/call.extras.js';
import { attachCallSignalling } from '../src/sockets/calls.socket.js';

function setup() {
  const sent = [];
  let clock = 1_000_000;
  // Call k1: Meg (1) on s1, Ann (2) on s2. Call k2: Bob (3) on s3.
  const devices = new Map([
    [
      'k1',
      new Map([
        [1, 's1'],
        [2, 's2'],
      ]),
    ],
    ['k2', new Map([[3, 's3']])],
  ]);
  const toCall = (callId, event, payload) => {
    for (const socketId of devices.get(callId)?.values() || []) sent.push({ socketId, event, payload });
  };
  const extras = createCallExtras({ devices, toCall, now: () => clock });
  return { extras, sent, devices, tick: (ms) => (clock += ms) };
}

test('isEmoji: an emoji, not text', () => {
  for (const good of ['👍', '❤️', '🎉', '👩‍💻', '🏳️‍🌈']) assert.equal(isEmoji(good), true, good);
  for (const bad of ['', 'hello', 'a', '<b>', '👍'.repeat(9), 5, null, undefined, {}])
    assert.equal(isEmoji(bad), false, String(bad));
});

test('a reaction reaches everyone in that call, and only them', () => {
  const { extras, sent } = setup();
  assert.equal(extras.react({ callId: 'k1', userId: 2, socketId: 's2', emoji: '🎉' }), true);
  assert.deepEqual(sent, [
    { socketId: 's1', event: 'call_reaction', payload: { call_id: 'k1', from_user_id: 2, emoji: '🎉' } },
    { socketId: 's2', event: 'call_reaction', payload: { call_id: 'k1', from_user_id: 2, emoji: '🎉' } },
  ]);
});

test('reactions are dropped from outside the call, from another tab, and when they are not an emoji', () => {
  const { extras, sent } = setup();
  assert.equal(extras.react({ callId: 'k1', userId: 3, socketId: 's3', emoji: '🎉' }), false, 'Bob is in another call');
  assert.equal(extras.react({ callId: 'k1', userId: 2, socketId: 'other-tab', emoji: '🎉' }), false);
  assert.equal(extras.react({ callId: 'k1', userId: 2, socketId: 's2', emoji: 'buy now' }), false);
  assert.equal(extras.react({ callId: 'nope', userId: 2, socketId: 's2', emoji: '🎉' }), false);
  assert.deepEqual(sent, []);
});

test('at most five reactions in three seconds per person; the allowance comes back', () => {
  const { extras, sent, tick } = setup();
  const react = () => extras.react({ callId: 'k1', userId: 2, socketId: 's2', emoji: '👍' });
  const results = Array.from({ length: REACTION_BURST + 2 }, react);
  assert.deepEqual(results, [true, true, true, true, true, false, false]);
  assert.equal(
    extras.react({ callId: 'k1', userId: 1, socketId: 's1', emoji: '👍' }),
    true,
    'someone else is not held back',
  );
  tick(REACTION_WINDOW_MS + 1);
  assert.equal(react(), true);
  assert.equal(sent.filter((e) => e.payload.from_user_id === 2).length, (REACTION_BURST + 1) * 2);
});

test('raising a hand tells the call once; lowering it too; late joiners get the raised hands', () => {
  const { extras, sent } = setup();
  assert.deepEqual(extras.snapshot('k1'), { hands: [] });
  extras.setHand({ callId: 'k1', userId: 2, socketId: 's2', up: true });
  extras.setHand({ callId: 'k1', userId: 2, socketId: 's2', up: true });
  assert.equal(sent.length, 2, 'the repeat is not announced');
  assert.deepEqual(sent[0], {
    socketId: 's1',
    event: 'call_hand_changed',
    payload: { call_id: 'k1', user_id: 2, up: true },
  });
  assert.deepEqual(extras.snapshot('k1'), { hands: [2] });
  assert.deepEqual(extras.snapshot('k2'), { hands: [] });
  extras.setHand({ callId: 'k1', userId: 2, socketId: 's2', up: false });
  assert.deepEqual(extras.snapshot('k1'), { hands: [] });
  assert.equal(sent.at(-1).payload.up, false);
});

test('a hand cannot be raised for someone else, or from outside the call', () => {
  const { extras, sent } = setup();
  assert.equal(
    extras.setHand({ callId: 'k1', userId: 2, socketId: 's1', up: true }),
    false,
    'Meg’s tab cannot raise Ann’s hand',
  );
  assert.equal(extras.setHand({ callId: 'k1', userId: 3, socketId: 's3', up: true }), false);
  assert.deepEqual(sent, []);
});

test('leaving lowers the hand; the end of the call forgets everything', () => {
  const { extras, sent, devices } = setup();
  extras.setHand({ callId: 'k1', userId: 2, socketId: 's2', up: true });
  sent.length = 0;
  devices.get('k1').delete(2);
  extras.onLeft('k1', 2);
  assert.deepEqual(sent, [
    { socketId: 's1', event: 'call_hand_changed', payload: { call_id: 'k1', user_id: 2, up: false } },
  ]);
  extras.onLeft('k1', 2);
  assert.equal(sent.length, 1, 'nothing more to say');
  extras.setHand({ callId: 'k1', userId: 1, socketId: 's1', up: true });
  extras.forget('k1');
  assert.deepEqual(extras.snapshot('k1'), { hands: [] });
});

test('the socket passes reactions and hands to the call service with the sender’s own id and connection', () => {
  const seen = [];
  const calls = {
    relaySignal() {},
    onSocketDisconnect() {},
    react: (a) => seen.push(['react', a]),
    setHand: (a) => seen.push(['hand', a]),
  };
  const socket = Object.assign(new EventEmitter(), { id: 'sock-9' });
  attachCallSignalling({ socket, user: { id: 9 }, calls });
  socket.emit('call_reaction', { call_id: 'k1', emoji: '🎉', from_user_id: 1 });
  socket.emit('call_hand', { call_id: 'k1', up: true, user_id: 1 });
  socket.emit('call_hand', { call_id: 'k1', up: 'yes' });
  socket.emit('call_reaction', null);
  socket.emit('call_hand', { up: true });
  assert.deepEqual(seen, [
    ['react', { callId: 'k1', userId: 9, socketId: 'sock-9', emoji: '🎉' }],
    ['hand', { callId: 'k1', userId: 9, socketId: 'sock-9', up: true }],
    ['hand', { callId: 'k1', userId: 9, socketId: 'sock-9', up: false }],
  ]);
});
