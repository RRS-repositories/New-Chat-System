import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatReducer, initialState } from '../src/context/chatReducer.ts';

const ch = (id: string, unread = 0) => ({ id, name: id, displayName: id, type: 'public', purpose: '', header: '', unreadCount: unread, lastMessageAt: null, dmUserId: null, dmUserName: null, memberCount: 1 }) as any;
const msg = (id: string, channelId = 'c1', createdAt = '2026-09-28T10:00:00.000Z') => ({ id, channelId, userId: 1, userName: 'A', content: id, type: 'message', createdAt, editedAt: null, replyToId: null, threadId: null }) as any;

test('message_added appends once (no duplicate on refetch) and bumps unread for other channels only', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1'), ch('c2')] });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m1')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'message_added', message: msg('m2'), currentChannelId: 'c1', selfId: 9 });
  s = chatReducer(s, { type: 'message_added', message: msg('m2'), currentChannelId: 'c1', selfId: 9 });
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['m1', 'm2']);
  assert.equal(s.channels.find((c) => c.id === 'c1')!.unreadCount, 0);
  s = chatReducer(s, { type: 'message_added', message: msg('m3', 'c2'), currentChannelId: 'c1', selfId: 9 });
  assert.equal(s.channels.find((c) => c.id === 'c2')!.unreadCount, 1);
});

test('messages_loaded with prepend puts older messages first and keeps the cursor', () => {
  let s = chatReducer(initialState, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m3')], nextCursor: 'cur1', prepend: false });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m1'), msg('m2')], nextCursor: null, prepend: true });
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(s.messagesByChannel.c1.nextCursor, null);
});

test('a non-prepend reload merges by id and sorts by createdAt', () => {
  let s = chatReducer(initialState, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m1', 'c1', '2026-09-28T10:00:01.000Z')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m1', 'c1', '2026-09-28T10:00:01.000Z'), msg('m2', 'c1', '2026-09-28T10:00:02.000Z')], nextCursor: null, prepend: false });
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['m1', 'm2']);
});

test('edit and delete update in place; typing expires', () => {
  let s = chatReducer(initialState, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m1'), msg('m2')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'message_edited', channelId: 'c1', messageId: 'm1', content: 'new', editedAt: 'x' });
  assert.equal(s.messagesByChannel.c1.items[0].content, 'new');
  s = chatReducer(s, { type: 'message_deleted', channelId: 'c1', messageId: 'm2' });
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['m1']);
  s = chatReducer(s, { type: 'typing', channelId: 'c1', userId: 5, name: 'Bob', until: 1000 });
  assert.equal(s.typingByChannel.c1[5].name, 'Bob');
  s = chatReducer(s, { type: 'typing_expire', now: 1001 });
  assert.equal(s.typingByChannel.c1?.[5], undefined);
});

test('read clears unread; channel_upsert replaces or adds', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1', 4)] });
  s = chatReducer(s, { type: 'read', channelId: 'c1' });
  assert.equal(s.channels[0].unreadCount, 0);
  s = chatReducer(s, { type: 'channel_upsert', channel: ch('c9') });
  assert.equal(s.channels.length, 2);
  s = chatReducer(s, { type: 'channel_upsert', channel: { ...ch('c9'), displayName: 'Nine' } });
  assert.equal(s.channels.find((c) => c.id === 'c9')!.displayName, 'Nine');
  s = chatReducer(s, { type: 'channel_removed', channelId: 'c9' });
  assert.equal(s.channels.length, 1);
});

test('stale_all marks every bucket unloaded but keeps items; a reload with no overlap replaces the bucket (offline gap)', () => {
  let s = chatReducer(initialState, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m1', 'c1', '2026-09-28T10:00:01.000Z')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c2', messages: [msg('n1', 'c2')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'stale_all' });
  assert.equal(s.messagesByChannel.c1.loaded, false); assert.equal(s.messagesByChannel.c2.loaded, false);
  assert.equal(s.messagesByChannel.c1.items.length, 1, 'items kept for display until refetched');
  const fresh = Array.from({ length: 3 }, (_, i) => msg(`f${i}`, 'c1', `2026-09-28T11:00:0${i}.000Z`));
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: fresh, nextCursor: 'cur-f0', prepend: false });
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['f0', 'f1', 'f2'], 'no overlap → replaced, no hole');
  assert.equal(s.messagesByChannel.c1.nextCursor, 'cur-f0'); assert.equal(s.messagesByChannel.c1.loaded, true);
});

test('a reload that overlaps the existing items merges and keeps older history', () => {
  let s = chatReducer(initialState, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m1', 'c1', '2026-09-28T10:00:01.000Z'), msg('m2', 'c1', '2026-09-28T10:00:02.000Z')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'stale_all' });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [msg('m2', 'c1', '2026-09-28T10:00:02.000Z'), msg('m3', 'c1', '2026-09-28T10:00:03.000Z')], nextCursor: null, prepend: false });
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['m1', 'm2', 'm3']);
});

const rich = (id: string, channelId = 'c1', extra: any = {}) => ({ ...msg(id, channelId), replyTo: null, replyCount: 0, pinned: false, reactions: [], files: [], ...extra });

test('a thread reply goes to the thread, bumps the root replyCount, and stays out of the channel feed', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1')] });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [rich('root')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'thread_loaded', rootId: 'root', root: rich('root'), replies: [] });
  s = chatReducer(s, { type: 'message_added', message: rich('r1', 'c1', { threadId: 'root' }), currentChannelId: 'c1', selfId: 9 });
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['root']);
  assert.equal(s.messagesByChannel.c1.items[0].replyCount, 1);
  assert.deepEqual(s.threads.root.replies.map((m) => m.id), ['r1']);
});

test('pins and reactions update the message in place; reaction toggling by the same user never duplicates', () => {
  let s = chatReducer(initialState, { type: 'messages_loaded', channelId: 'c1', messages: [rich('m1')], nextCursor: null, prepend: false });
  s = chatReducer(s, { type: 'message_pinned', channelId: 'c1', messageId: 'm1', pinnedBy: 2 });
  assert.equal(s.messagesByChannel.c1.items[0].pinned, true);
  s = chatReducer(s, { type: 'reaction_added', channelId: 'c1', messageId: 'm1', emoji: '👍', userId: 2 });
  s = chatReducer(s, { type: 'reaction_added', channelId: 'c1', messageId: 'm1', emoji: '👍', userId: 2 });
  s = chatReducer(s, { type: 'reaction_added', channelId: 'c1', messageId: 'm1', emoji: '👍', userId: 3 });
  assert.deepEqual(s.messagesByChannel.c1.items[0].reactions, [{ emoji: '👍', count: 2, userIds: [2, 3] }]);
  s = chatReducer(s, { type: 'reaction_removed', channelId: 'c1', messageId: 'm1', emoji: '👍', userId: 2 });
  s = chatReducer(s, { type: 'reaction_removed', channelId: 'c1', messageId: 'm1', emoji: '👍', userId: 3 });
  assert.deepEqual(s.messagesByChannel.c1.items[0].reactions, []);
  s = chatReducer(s, { type: 'message_unpinned', channelId: 'c1', messageId: 'm1' });
  assert.equal(s.messagesByChannel.c1.items[0].pinned, false);
});

test('mention badge: a mention of me bumps mentionCount; read clears both counts', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [{ ...ch('c2'), mentionCount: 0 }] });
  s = chatReducer(s, { type: 'message_added', message: rich('m1', 'c2', { content: '@Me hi', mentionsMe: true }), currentChannelId: 'c1', selfId: 9 });
  assert.equal(s.channels[0].unreadCount, 1); assert.equal(s.channels[0].mentionCount, 1);
  s = chatReducer(s, { type: 'read', channelId: 'c2' });
  assert.equal(s.channels[0].unreadCount, 0); assert.equal(s.channels[0].mentionCount, 0);
});

test('message_added is idempotent: the same thread reply (own send + socket echo) counts once', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1'), ch('c2')] });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [rich('root')], nextCursor: null, prepend: false });
  const reply = rich('r1', 'c1', { threadId: 'root' });
  s = chatReducer(s, { type: 'message_added', message: reply, currentChannelId: 'c1', selfId: 9 });
  s = chatReducer(s, { type: 'message_added', message: reply, currentChannelId: 'c1', selfId: 9 });
  assert.equal(s.messagesByChannel.c1.items[0].replyCount, 1, 'thread not loaded, still counted once');
  const other = rich('o1', 'c2');
  s = chatReducer(s, { type: 'message_added', message: other, currentChannelId: 'c1', selfId: 9 });
  s = chatReducer(s, { type: 'message_added', message: other, currentChannelId: 'c1', selfId: 9 });
  assert.equal(s.channels.find((c) => c.id === 'c2')!.unreadCount, 1, 'unread bumped once');
});

test('a jump window is flagged windowed until the latest page is loaded', () => {
  let s = chatReducer(initialState, { type: 'messages_loaded', channelId: 'c1', messages: [rich('w1'), rich('w2')], nextCursor: 'older', prepend: false, windowed: true });
  assert.equal(s.messagesByChannel.c1.windowed, true);
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [rich('w0')], nextCursor: null, prepend: true });
  assert.equal(s.messagesByChannel.c1.windowed, true, 'loading older keeps the window');
  s = chatReducer(s, { type: 'bucket_unload', channelId: 'c1' });
  s = chatReducer(s, { type: 'messages_loaded', channelId: 'c1', messages: [rich('n1'), rich('n2')], nextCursor: null, prepend: false });
  assert.equal(s.messagesByChannel.c1.windowed, false);
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['n1', 'n2'], 'no overlap → replaced with the latest page');
});

test('not_enabled sets the notEnabled flag (initially false) and keeps everything else', () => {
  assert.equal(initialState.notEnabled, false);
  const s0 = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1')] });
  const s = chatReducer(s0, { type: 'not_enabled' });
  assert.equal(s.notEnabled, true);
  assert.deepEqual(s.channels, s0.channels);
});

test('joining a browsed channel via channel_upsert adds it to the sidebar once, even if a reload races it', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1')] });
  s = chatReducer(s, { type: 'channel_upsert', channel: { ...ch('pub'), displayName: 'Public', memberCount: 12 } });
  assert.deepEqual(s.channels.map((c) => c.id), ['c1', 'pub']);
  s = chatReducer(s, { type: 'channel_upsert', channel: { ...ch('pub'), displayName: 'Public', memberCount: 13 } });
  assert.deepEqual(s.channels.map((c) => c.id), ['c1', 'pub']);
  assert.equal(s.channels.find((c) => c.id === 'pub')!.memberCount, 13);
});

test('channels without notifyPref default to "default"; channel_notify sets it', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [ch('c1'), { ...ch('c2'), notifyPref: 'nothing' }] });
  assert.equal(s.channels[0].notifyPref, 'default'); assert.equal(s.channels[1].notifyPref, 'nothing');
  s = chatReducer(s, { type: 'channel_upsert', channel: ch('c3') });
  assert.equal(s.channels[2].notifyPref, 'default');
  s = chatReducer(s, { type: 'channel_notify', channelId: 'c1', pref: 'all' });
  assert.equal(s.channels[0].notifyPref, 'all');
  s = chatReducer(s, { type: 'channel_upsert', channel: { ...ch('c1'), displayName: 'renamed' } });
  assert.equal(s.channels[0].notifyPref, 'all', 'an upsert without notifyPref keeps the known level');
});

test('an upsert (create/DM/join/channel_updated) never changes a known notifyPref; only channels_loaded and channel_notify do', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [{ ...ch('c1'), notifyPref: 'nothing' }] });
  s = chatReducer(s, { type: 'channel_upsert', channel: { ...ch('c1'), notifyPref: 'default', memberCount: 5 } });
  assert.equal(s.channels[0].notifyPref, 'nothing', 'server sends "default" outside GET /channels: ignored');
  assert.equal(s.channels[0].memberCount, 5, 'other fields still update');
  s = chatReducer(s, { type: 'channel_upsert', channel: { ...ch('new'), notifyPref: 'default' } });
  assert.equal(s.channels[1].notifyPref, 'default', 'a never-seen channel starts at default');
  s = chatReducer(s, { type: 'channels_loaded', channels: [{ ...ch('c1'), notifyPref: 'mentions' }] });
  assert.equal(s.channels[0].notifyPref, 'mentions', 'a fresh list is the source of truth');
});

test('the open channel counts unread (and mentions) when the chat is not being looked at', () => {
  let s = chatReducer(initialState, { type: 'channels_loaded', channels: [{ ...ch('c1'), mentionCount: 0 }] });
  s = chatReducer(s, { type: 'message_added', message: rich('m1', 'c1', { userId: 2 }), currentChannelId: 'c1', selfId: 9, looking: true });
  assert.equal(s.channels[0].unreadCount, 0, 'looked at: read straight away');
  s = chatReducer(s, { type: 'message_added', message: rich('m2', 'c1', { userId: 2, mentionsMe: true }), currentChannelId: 'c1', selfId: 9, looking: false });
  assert.equal(s.channels[0].unreadCount, 1); assert.equal(s.channels[0].mentionCount, 1);
  s = chatReducer(s, { type: 'message_added', message: rich('m3', 'c1', { userId: 9 }), currentChannelId: 'c1', selfId: 9, looking: false });
  assert.equal(s.channels[0].unreadCount, 1, 'own messages never count');
  assert.deepEqual(s.messagesByChannel.c1.items.map((m) => m.id), ['m1', 'm2', 'm3'], 'still shown in the feed');
});

test('presence: snapshot then online/offline/away/status events', () => {
  assert.deepEqual(initialState.presence, { online: {}, away: {}, statuses: {} });
  let s = chatReducer(initialState, { type: 'presence_loaded', snapshot: { online: [1, 2], away: [2], statuses: { 1: { text: 'At lunch', emoji: '🍔' } } } });
  assert.deepEqual(s.presence.online, { 1: true, 2: true }); assert.deepEqual(s.presence.away, { 2: true });
  assert.deepEqual(s.presence.statuses[1], { text: 'At lunch', emoji: '🍔' });
  s = chatReducer(s, { type: 'user_online', userId: 3 });
  assert.equal(s.presence.online[3], true);
  s = chatReducer(s, { type: 'user_away', userId: 2, away: false });
  assert.equal(s.presence.away[2], undefined);
  s = chatReducer(s, { type: 'user_away', userId: 3, away: true });
  assert.equal(s.presence.away[3], true);
  s = chatReducer(s, { type: 'user_offline', userId: 3 });
  assert.equal(s.presence.online[3], undefined); assert.equal(s.presence.away[3], undefined, 'offline clears away');
  s = chatReducer(s, { type: 'user_status', userId: 1, text: '', emoji: '' });
  assert.equal(s.presence.statuses[1], undefined, 'an empty status is removed');
  s = chatReducer(s, { type: 'user_status', userId: 2, text: 'Busy', emoji: '' });
  assert.deepEqual(s.presence.statuses[2], { text: 'Busy', emoji: '' });
});

test('prefs: defaults until loaded, then replaced', () => {
  assert.equal(initialState.prefs.desktopNotif, 'mentions'); assert.equal(initialState.prefs.soundEnabled, true); assert.equal(initialState.prefs.sendOnEnter, true);
  const s = chatReducer(initialState, { type: 'prefs_set', prefs: { ...initialState.prefs, desktopNotif: 'all', soundEnabled: false } });
  assert.equal(s.prefs.desktopNotif, 'all'); assert.equal(s.prefs.soundEnabled, false);
});
