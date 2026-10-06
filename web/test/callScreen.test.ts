// Pure pieces of the call screen: the grid, the timer, and who the host is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/hooks/useCallClock.ts';
import { callReducer, initialCallState } from '../src/context/callState.ts';

// Kept in step with gridColumns in components/calls/CallScreen.tsx (a .tsx file cannot be loaded here).
const gridColumns = (people: number, narrow: boolean) => {
  if (people <= 1) return 1;
  if (narrow) return people <= 6 ? 2 : 3;
  if (people <= 4) return 2;
  if (people <= 6) return 3;
  if (people <= 12) return 4;
  if (people <= 20) return 5;
  return people <= 30 ? 6 : 7;
};

test('the grid: one alone, two columns to four, three to six, four to twelve, up to seven for the largest calls', () => {
  assert.deepEqual(
    [1, 2, 4, 5, 6, 7, 12, 13, 20, 21, 30, 31, 50].map((n) => gridColumns(n, false)),
    [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7],
  );
  assert.deepEqual(
    [1, 2, 6, 7, 50].map((n) => gridColumns(n, true)),
    [1, 2, 2, 3, 3],
    'a phone never goes past three columns',
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

const ring = (callId: string, extra = {}) => ({
  callId,
  channelId: 'c9',
  channelName: '',
  channelType: 'dm' as const,
  fromId: 4,
  fromName: 'Dee',
  ...extra,
});

test('a call ringing in while this tab is in a call waits, and does not disturb the call', () => {
  let s = callReducer(inCall(), { type: 'incoming', call: ring('k2') });
  assert.equal(s.phase, 'in-call');
  assert.equal(s.waiting?.callId, 'k2');
  assert.equal(callReducer(s, { type: 'incoming', call: ring('k3') }).waiting?.callId, 'k2', 'one at a time');
  assert.equal(callReducer(inCall(), { type: 'incoming', call: ring('k1') }).waiting, null, 'never my own call');
  s = callReducer(s, { type: 'dismissed', callId: 'k2' });
  assert.equal(s.waiting, null);
  assert.equal(s.phase, 'in-call');
});

test('the waiting call ends, or my call ends first', () => {
  const waiting = callReducer(inCall(), { type: 'incoming', call: ring('k2') });
  const gone = callReducer(waiting, { type: 'ended', callId: 'k2', status: 'missed' });
  assert.equal(gone.waiting, null);
  assert.equal(gone.phase, 'in-call');
  // My own call ends while the other still rings: it now rings in the ordinary way.
  const mineOver = callReducer(waiting, { type: 'ended', callId: 'k1', status: 'ended' });
  assert.equal(mineOver.phase, 'ringing-in');
  assert.equal(mineOver.incoming?.callId, 'k2');
  assert.equal(mineOver.waiting, null);
});

test('answering the waiting call by changing calls clears it', () => {
  const waiting = callReducer(inCall(), { type: 'incoming', call: ring('k2', { invited: true }) });
  const s = callReducer(waiting, { type: 'join_begin', callId: 'k2', channelId: 'c9' });
  assert.equal(s.waiting, null);
  assert.equal(s.phase, 'joining');
});
