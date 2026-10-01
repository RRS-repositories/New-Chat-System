import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callReducer, initialCallState, type CallUiState } from '../src/context/callState.ts';

const incoming = {
  callId: 'k1',
  channelId: 'c1',
  channelName: 'general',
  channelType: 'public' as const,
  fromId: 2,
  fromName: 'Meg',
};
const ring = (): CallUiState => callReducer(initialCallState, { type: 'incoming', call: incoming });

test('incoming call rings when idle', () => {
  const s = ring();
  assert.equal(s.phase, 'ringing-in');
  assert.equal(s.incoming?.callId, 'k1');
});

test('incoming → accepted in another tab → idle', () => {
  const s = callReducer(ring(), { type: 'dismissed', callId: 'k1' });
  assert.equal(s.phase, 'idle');
  assert.equal(s.incoming, null);
});

test('a dismissal for another call does not stop this ring', () => {
  assert.equal(callReducer(ring(), { type: 'dismissed', callId: 'other' }).phase, 'ringing-in');
});

test('ended while ringing → idle', () => {
  const s = callReducer(ring(), { type: 'ended', callId: 'k1', status: 'missed' });
  assert.equal(s.phase, 'idle');
});

test('in-call → ended → idle with a notice; joining → joined → in-call', () => {
  let s = callReducer(ring(), { type: 'join_begin', callId: 'k1', channelId: 'c1' });
  assert.equal(s.phase, 'joining');
  assert.equal(s.incoming, null);
  s = callReducer(s, { type: 'joined', callId: 'k1', channelId: 'c1' });
  assert.equal(s.phase, 'in-call');
  assert.equal(s.callId, 'k1');
  s = callReducer(s, { type: 'ended', callId: 'k1', status: 'ended' });
  assert.equal(s.phase, 'idle');
  assert.equal(s.callId, null);
  assert.ok(s.notice);
});

test('a second incoming call does not replace the ring or interrupt a call', () => {
  const other = { ...incoming, callId: 'k2' };
  assert.equal(callReducer(ring(), { type: 'incoming', call: other }).incoming?.callId, 'k1');
  let s = callReducer(initialCallState, { type: 'join_begin', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'joined', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'incoming', call: other });
  assert.equal(s.phase, 'in-call');
  assert.equal(s.incoming, null);
});

test('a failed join returns to idle with the error', () => {
  let s = callReducer(initialCallState, { type: 'join_begin', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'failed', error: 'Microphone access is needed to join the call' });
  assert.equal(s.phase, 'idle');
  assert.equal(s.error, 'Microphone access is needed to join the call');
});

test('ended for an unrelated call leaves the current call alone', () => {
  let s = callReducer(initialCallState, { type: 'join_begin', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'joined', callId: 'k1', channelId: 'c1' });
  assert.equal(callReducer(s, { type: 'ended', callId: 'zz', status: 'ended' }).phase, 'in-call');
});
