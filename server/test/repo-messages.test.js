import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMessages, createMessage, editMessage, deleteMessage, parseCursor, listThread } from '../src/repo/messages.js';

const row = (i) => ({ id: `m${i}`, channel_id: 'c1', user_id: 7, user_name: 'Ann', content: `msg ${i}`, type: 'message',
  created_at: new Date(Date.UTC(2026, 8, 28, 10, 0, i)).toISOString(), edited_at: null, reply_to_id: null, thread_id: null });
function stubDb(rowsFor) { const calls = []; return { calls, async query(sql, params) { calls.push({ sql, params }); const rows = rowsFor(sql, params); return { rows, rowCount: rows.length }; } }; }

test('parseCursor round-trips and rejects junk', () => {
  const c = parseCursor('2026-09-28T10:00:05.000Z|m5');
  assert.equal(c.id, 'm5'); assert.equal(c.at.toISOString(), '2026-09-28T10:00:05.000Z');
  assert.equal(parseCursor('nope'), null); assert.equal(parseCursor(''), null);
});

test('listMessages: newest page fetched DESC, returned oldest→newest, nextCursor only on a full page', async () => {
  const db = stubDb((sql, p) => (/ORDER BY x\.created_at DESC, x\.id DESC/.test(sql) ? Array.from({ length: p[1] }, (_, i) => row(50 - i)) : []));
  const out = await listMessages(db, 'c1', { limit: 50 });
  assert.equal(out.messages.length, 50);
  assert.equal(out.messages[0].id, 'm1'); assert.equal(out.messages[49].id, 'm50');
  assert.equal(out.nextCursor, `${row(1).created_at}|m1`);
  const short = await listMessages(stubDb(() => [row(2), row(1)]), 'c1', { limit: 50 });
  assert.equal(short.nextCursor, null);
});

test('listMessages passes the cursor as (created_at, id) < ($3,$4)', async () => {
  const db = stubDb(() => []);
  await listMessages(db, 'c1', { before: '2026-09-28 10:00:05.000123+00|m5', limit: 20 });
  const q = db.calls[0];
  assert.ok(/\(x\.created_at, x\.id\) < \(\$3::timestamptz, \$4\)/.test(q.sql));
  assert.equal(q.params[2], '2026-09-28 10:00:05.000123+00', 'raw timestamp text goes to Postgres untouched');
  assert.equal(q.params[3], 'm5');
});

test('createMessage returns the inserted row joined with the author name', async () => {
  const db = stubDb((sql) => (/INSERT INTO chat\.messages|WHERE x\.id = \$1/.test(sql) ? [row(1)] : []));
  const m = await createMessage(db, { channelId: 'c1', userId: 7, content: 'msg 1' });
  assert.equal(m.userName, 'Ann'); assert.equal(m.channelId, 'c1');
});

test('editMessage only touches the author’s own message; deleteMessage allows author or channel admin', async () => {
  const db = stubDb((sql) => (/UPDATE chat\.messages SET content|WHERE x\.id = \$1/.test(sql) ? [row(1)] : []));
  const m = await editMessage(db, { messageId: 'm1', userId: 7, content: 'new' });
  assert.ok(/user_id = \$2/.test(db.calls[0].sql)); assert.equal(m.id, 'm1');
  const d = stubDb(() => [{}]);
  assert.equal(await deleteMessage(d, { messageId: 'm1', userId: 9, isChannelAdmin: true }), true);
  assert.ok(/deleted_at = now\(\)/.test(d.calls[0].sql));
  assert.ok(!/user_id = \$2/.test(d.calls[0].sql), 'admin path has no author filter');
});

test('the cursor carries the raw Postgres timestamp text so microseconds survive', () => {
  const c = parseCursor('2026-09-28 10:00:05.000123+00|m5');
  assert.equal(c.id, 'm5'); assert.equal(c.raw, '2026-09-28 10:00:05.000123+00');
});

test('createMessage passes reply_to_id and thread_id and the SELECT carries reply preview, reply_count, pinned, reactions', async () => {
  const db = stubDb((sql) => (/SELECT id, channel_id, thread_id FROM chat\.messages WHERE id/.test(sql) ? [{ id: 'r0', channel_id: 'c1', thread_id: null }]
    : /INSERT INTO chat\.messages|WHERE x\.id = \$1/.test(sql) ? [{ ...row(1), reply_to_id: 'r0', reply_user_id: 8, reply_user_name: 'Bob', reply_content: 'orig', reply_count: '2', pinned: true, reactions: [{ emoji: '👍', count: 2, user_ids: [7, 8] }] }] : []));
  const m = await createMessage(db, { channelId: 'c1', userId: 7, content: 'x', replyToId: 'r0' });
  const ins = db.calls.find((c) => /INSERT INTO chat\.messages/.test(c.sql));
  assert.equal(ins.params[4], 'r0'); assert.equal(ins.params[5], null);
  assert.deepEqual(m.replyTo, { id: 'r0', userId: 8, userName: 'Bob', content: 'orig' });
  assert.equal(m.replyCount, 2); assert.equal(m.pinned, true);
  assert.deepEqual(m.reactions, [{ emoji: '👍', count: 2, userIds: [7, 8] }]);
  assert.deepEqual(m.files, []);
});

test('listThread returns root then replies oldest first', async () => {
  const db = stubDb((sql) => (/WHERE x\.id = \$1/.test(sql) ? [row(1)] : /WHERE x\.thread_id = \$1/.test(sql) ? [row(2), row(3)] : []));
  const t = await listThread(db, 'm1');
  assert.equal(t.root.id, 'm1'); assert.deepEqual(t.replies.map((m) => m.id), ['m2', 'm3']);
  assert.match(db.calls[1].sql, /ORDER BY x\.created_at ASC, x\.id ASC/);
});
