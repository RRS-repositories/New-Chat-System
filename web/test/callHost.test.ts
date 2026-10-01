// Call state for host controls: who the host is, being removed, and asking to come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callReducer, initialCallState, type CallUiState } from '../src/context/callState.ts';
import { addJoinRequest, dropJoinRequest } from '../src/utils/joinRequests.ts';

const inCall = (hostId: number): CallUiState => {
  const joining = callReducer(initialCallState, { type: 'join_begin', callId: 'k1', channelId: 'c1' });
  return callReducer(joining, { type: 'joined', callId: 'k1', channelId: 'c1', hostId });
};

test('joining records who the host is; leaving forgets it', () => {
  const s = inCall(7);
  assert.equal(s.hostId, 7);
  assert.equal(callReducer(s, { type: 'left' }).hostId, null);
  assert.equal(callReducer(s, { type: 'ended', callId: 'k1', status: 'ended' }).hostId, null);
});

test('being removed is remembered for that call, once', () => {
  let s = callReducer(inCall(7), { type: 'removed', callId: 'k1' });
  s = callReducer(s, { type: 'removed', callId: 'k1' });
  assert.deepEqual(s.removedFrom, ['k1']);
  s = callReducer(s, { type: 'left', notice: 'The host removed you from the call' });
  assert.equal(s.phase, 'idle');
  assert.deepEqual(s.removedFrom, ['k1'], 'still remembered after dropping out');
});

test('asking to come back: waiting, then let in', () => {
  let s = callReducer(initialCallState, { type: 'removed', callId: 'k1' });
  s = callReducer(s, { type: 'asking', callId: 'k1', channelId: 'c1' });
  assert.deepEqual(s.asking, { callId: 'k1', channelId: 'c1' });
  assert.equal(s.error, null);
  s = callReducer(s, { type: 'ask_done', callId: 'k1', allowed: true });
  assert.equal(s.asking, null);
  assert.deepEqual(s.removedFrom, [], 'no longer removed: the next Join is a normal join');
});

test('asking to come back: refused keeps the person out and says why', () => {
  let s = callReducer(initialCallState, { type: 'removed', callId: 'k1' });
  s = callReducer(s, { type: 'asking', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'ask_done', callId: 'k1', allowed: false, notice: 'The host did not let you back in' });
  assert.equal(s.asking, null);
  assert.deepEqual(s.removedFrom, ['k1']);
  assert.equal(s.notice, 'The host did not let you back in');
});

test('an answer about another call does not stop this wait', () => {
  let s = callReducer(initialCallState, { type: 'asking', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'ask_done', callId: 'other', allowed: false, notice: 'no' });
  assert.deepEqual(s.asking, { callId: 'k1', channelId: 'c1' });
  assert.equal(s.notice, null);
});

test('the call ending clears the wait and the removal', () => {
  let s = callReducer(initialCallState, { type: 'removed', callId: 'k1' });
  s = callReducer(s, { type: 'removed', callId: 'k2' });
  s = callReducer(s, { type: 'asking', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'ended', callId: 'k1', status: 'ended' });
  assert.equal(s.asking, null);
  assert.deepEqual(s.removedFrom, ['k2']);
});

test('starting to join stops any wait', () => {
  let s = callReducer(initialCallState, { type: 'asking', callId: 'k1', channelId: 'c1' });
  s = callReducer(s, { type: 'join_begin', callId: 'k1', channelId: 'c1' });
  assert.equal(s.asking, null);
});

test('the host’s list of waiting people: no duplicates, removable', () => {
  let list = addJoinRequest([], { userId: 3, userName: 'Bob' });
  list = addJoinRequest(list, { userId: 3, userName: 'Bob Sales' });
  list = addJoinRequest(list, { userId: 5, userName: 'Cy' });
  assert.deepEqual(list, [
    { userId: 3, userName: 'Bob Sales' },
    { userId: 5, userName: 'Cy' },
  ]);
  assert.deepEqual(dropJoinRequest(list, 3), [{ userId: 5, userName: 'Cy' }]);
  assert.equal(dropJoinRequest(list, 99), list, 'unchanged list is the same object (no needless redraw)');
});
