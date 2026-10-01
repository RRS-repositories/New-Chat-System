// A long channel never piles up on the page: the chat keeps a window of it and pages both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatReducer, initialState, type State } from '../src/context/chatReducer.ts';
import { KEEP_WHEN_AWAY, MAX_HELD, cursorOf } from '../src/utils/messageWindow.ts';

const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString();
const msg = (n: number, channelId = 'c1') =>
  ({
    id: `m${String(n).padStart(6, '0')}`,
    channelId,
    userId: 2,
    userName: 'A',
    content: `m${n}`,
    type: 'message',
    createdAt: at(n),
    cursor: `cur-${n}`,
    editedAt: null,
    replyToId: null,
    threadId: null,
  }) as any;
const range = (from: number, to: number, channelId = 'c1') =>
  Array.from({ length: to - from + 1 }, (_, i) => msg(from + i, channelId));
const numbers = (s: State, channelId = 'c1') =>
  s.messagesByChannel[channelId]!.items.map((m) => Number(m.content.slice(1)));
const span = (s: State, channelId = 'c1') => {
  const n = numbers(s, channelId);
  return [n[0], n.at(-1), n.length];
};
const ch = (id: string) => ({ id, name: id, displayName: id, type: 'public', unreadCount: 0, mentionCount: 0 }) as any;

/** The newest page of a 10,000-message channel, then `pages` pages of older messages. */
function scrolledBack(pages: number): State {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1'), ch('c2')] });
  s = chatReducer(s, {
    type: 'messages_loaded',
    channelId: 'c1',
    messages: range(9951, 10000),
    nextCursor: 'cur-9951',
    prepend: false,
  });
  for (let p = 1; p <= pages; p++) {
    const top = 9951 - p * 50;
    s = chatReducer(s, {
      type: 'messages_loaded',
      channelId: 'c1',
      messages: range(top, top + 49),
      nextCursor: `cur-${top}`,
      prepend: true,
    });
  }
  return s;
}

test('scrolling back keeps everything until the cap, then lets go of the newest', () => {
  const some = scrolledBack(7); // 400 messages: exactly the cap
  assert.deepEqual(span(some), [9601, 10000, MAX_HELD]);
  assert.equal(!!some.messagesByChannel.c1!.windowed, false, 'still holds the newest: not a window yet');

  const far = scrolledBack(40);
  assert.deepEqual(span(far), [7951, 7951 + MAX_HELD - 1, MAX_HELD], 'the oldest loaded are kept, the newest dropped');
  assert.equal(far.messagesByChannel.c1!.windowed, true, 'there are newer messages not on the page');
  assert.equal(far.messagesByChannel.c1!.nextCursor, 'cur-7951');
});

test('scrolling down again loads newer messages and lets go of the oldest', () => {
  let s = scrolledBack(40);
  s = chatReducer(s, {
    type: 'messages_loaded',
    channelId: 'c1',
    messages: range(8351, 8400),
    nextCursor: null,
    prepend: false,
    append: true,
    hasNewer: true,
  });
  assert.deepEqual(span(s), [8001, 8400, MAX_HELD]);
  assert.equal(s.messagesByChannel.c1!.windowed, true);
  assert.equal(
    s.messagesByChannel.c1!.nextCursor,
    cursorOf(s.messagesByChannel.c1!.items[0]!),
    'scrolling up again continues from the new top',
  );
  assert.equal(s.messagesByChannel.c1!.nextCursor, 'cur-8001');
});

test('reaching the newest message ends the window: live messages are added again', () => {
  let s = scrolledBack(40);
  s = chatReducer(s, {
    type: 'messages_loaded',
    channelId: 'c1',
    messages: range(9990, 10000),
    nextCursor: null,
    prepend: false,
    append: true,
    hasNewer: false,
  });
  assert.equal(s.messagesByChannel.c1!.windowed, false);
  s = chatReducer(s, { type: 'message_added', message: msg(10001), currentChannelId: 'c1', selfId: 1 });
  assert.equal(numbers(s).at(-1), 10001);
});

test('while looking at old history, a new message is not glued under it', () => {
  let s = scrolledBack(40);
  const before = numbers(s);
  s = chatReducer(s, { type: 'message_added', message: msg(10001), currentChannelId: 'c1', selfId: 1 });
  assert.deepEqual(numbers(s), before, 'the window is unchanged; the message is fetched when the person scrolls down');
  s = chatReducer(s, { type: 'message_added', message: msg(10001), currentChannelId: 'c1', selfId: 1 });
  assert.deepEqual(numbers(s), before);
});

test('a channel left open at the newest end is trimmed only when asked, never by itself', () => {
  let s = scrolledBack(7);
  for (let n = 10001; n <= 10300; n++)
    s = chatReducer(s, { type: 'message_added', message: msg(n), currentChannelId: 'c1', selfId: 1 });
  assert.equal(numbers(s).length, 700, 'nothing vanishes under a person who may be reading further up');
  s = chatReducer(s, { type: 'bucket_trim', channelId: 'c1' });
  assert.deepEqual(span(s), [9901, 10300, MAX_HELD]);
  assert.equal(s.messagesByChannel.c1!.nextCursor, 'cur-9901');
  assert.equal(chatReducer(s, { type: 'bucket_trim', channelId: 'c1' }), s, 'nothing to trim: same state');
});

test('channels that are not open keep only their newest page', () => {
  let s = scrolledBack(7);
  s = chatReducer(s, {
    type: 'messages_loaded',
    channelId: 'c2',
    messages: range(1, 30, 'c2'),
    nextCursor: null,
    prepend: false,
  });
  s = chatReducer(s, { type: 'buckets_rest', keep: 'c2' });
  assert.deepEqual(span(s), [10000 - KEEP_WHEN_AWAY + 1, 10000, KEEP_WHEN_AWAY]);
  assert.equal(s.messagesByChannel.c1!.nextCursor, `cur-${10000 - KEEP_WHEN_AWAY + 1}`);
  assert.equal(numbers(s, 'c2').length, 30, 'the open channel is left alone');

  // Messages keep arriving for the channel that is not open: it stays small.
  for (let n = 10001; n <= 10400; n++)
    s = chatReducer(s, { type: 'message_added', message: msg(n), currentChannelId: 'c2', selfId: 1 });
  assert.ok(numbers(s).length <= KEEP_WHEN_AWAY * 2, `${numbers(s).length} kept`);
  assert.equal(numbers(s).at(-1), 10400);
  assert.equal(s.channels.find((c) => c.id === 'c1')!.unreadCount, 400, 'unread still counts every one');
});

test('a window into old history is dropped when the person goes elsewhere', () => {
  let s = scrolledBack(40);
  s = chatReducer(s, { type: 'buckets_rest', keep: 'c2' });
  assert.equal(s.messagesByChannel.c1, undefined, 'it reloads from the newest page next time');
});

test('the same message arriving twice is counted once, however long the session', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1'), ch('c2')] });
  for (let n = 1; n <= 1200; n++) {
    s = chatReducer(s, { type: 'message_added', message: msg(n), currentChannelId: 'c2', selfId: 1 });
    s = chatReducer(s, { type: 'message_added', message: msg(n), currentChannelId: 'c2', selfId: 1 });
  }
  assert.equal(s.channels.find((c) => c.id === 'c1')!.unreadCount, 1200);
  assert.ok(s.seen.length <= 300, `the list of recent ids stays short (${s.seen.length})`);
});

test('cursorOf prefers the server’s exact position and falls back to the time', () => {
  assert.equal(cursorOf(msg(5)), 'cur-5');
  assert.equal(cursorOf({ ...msg(5), cursor: null }), `${at(5)}|m000005`);
});
