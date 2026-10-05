// Pure pieces of the call screen: the grid, the timer, and who the host is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/hooks/useCallClock.ts';
import { callReducer, initialCallState } from '../src/context/callState.ts';

// Kept in step with gridColumns in components/calls/CallScreen.tsx (a .tsx file cannot be loaded here).
const gridColumns = (people: number, narrow: boolean) =>
  people <= 1 ? 1 : narrow ? 2 : people <= 4 ? 2 : people <= 6 ? 3 : 4;

test('the grid: one alone, two columns to four people, three to six, four to eight', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => gridColumns(n, false)),
    [1, 2, 2, 2, 3, 3, 4, 4],
  );
  assert.deepEqual(
    [1, 2, 5, 8].map((n) => gridColumns(n, true)),
    [1, 2, 2, 2],
    'a phone never goes past two columns',
  );
});

test('the call timer', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(7.9), '00:07');
  assert.equal(formatDuration(247), '04:07');
  assert.equal(formatDuration(3847), '1:04:07');
  assert.equal(formatDuration(-5), '00:00');
});

const inCall = () => {
  const joining = callReducer(initialCallState, { type: 'join_begin', callId: 'k1', channelId: 'c1' });
  return callReducer(joining, { type: 'joined', callId: 'k1', channelId: 'c1', hostId: 7, since: 1000 });
};

test('joining records when the call began; leaving forgets it', () => {
  const s = inCall();
  assert.equal(s.since, 1000);
  assert.equal(callReducer(s, { type: 'left' }).since, null);
});

test('the host can change during a call (the starter left, or came back)', () => {
  let s = inCall();
  s = callReducer(s, { type: 'host', callId: 'k1', hostId: 9 });
  assert.equal(s.hostId, 9);
  assert.equal(callReducer(s, { type: 'host', callId: 'k1', hostId: 9 }), s, 'no change: same state');
  assert.equal(callReducer(s, { type: 'host', callId: 'another-call', hostId: 3 }).hostId, 9);
});
