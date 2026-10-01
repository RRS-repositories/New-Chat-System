// Paging through a long channel in both directions on real Postgres (PGlite): the web app keeps
// only a window of a long channel on the page, so it must be able to walk older AND newer without
// losing or repeating a message, even when several messages share one timestamp.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { createChannel } from '../src/models/channels.model.js';
import { listMessages, listAround } from '../src/models/messages.model.js';

let db, close, channelId;
const TOTAL = 230;

before(async () => {
  ({ db, close } = await createTestDb());
  channelId = (await createChannel(db, { displayName: 'Long One', type: 'private', createdBy: 1, memberIds: [2] })).id;
  // 230 messages, three per timestamp, so every page boundary can fall between messages of the same instant.
  await db.query(
    `INSERT INTO chat.messages (channel_id, user_id, content, created_at)
     SELECT $1, 1 + (g % 2), 'm' || g, timestamptz '2026-01-01 00:00:00.123456+00' + ((g / 3) || ' seconds')::interval
       FROM generate_series(1, ${TOTAL}) g`,
    [channelId],
  );
});
after(() => close());

const names = (page) => page.messages.map((m) => m.content);

test('every message carries a cursor that pages from exactly that message', async () => {
  const newest = await listMessages(db, channelId, { limit: 50 });
  assert.equal(newest.messages.length, 50);
  for (const m of newest.messages) assert.match(m.cursor, /^2026-01-01 .+\|[0-9a-f-]{36}$/);
  // The cursor of the oldest message held is the same thing the server hands back as "older".
  assert.equal(newest.messages[0].cursor, newest.nextCursor);
});

test('walking older from the newest page reaches the start with nothing lost or repeated', async () => {
  const seen = [];
  let page = await listMessages(db, channelId, { limit: 50 });
  seen.unshift(...names(page));
  while (page.nextCursor) {
    page = await listMessages(db, channelId, { before: page.nextCursor, limit: 50 });
    seen.unshift(...names(page));
  }
  assert.equal(seen.length, TOTAL);
  assert.equal(new Set(seen).size, TOTAL);
});

test('walking newer from the oldest page reaches the end with nothing lost or repeated, oldest first', async () => {
  const all = [];
  let page = await listMessages(db, channelId, { limit: 50 });
  while (page.nextCursor) page = await listMessages(db, channelId, { before: page.nextCursor, limit: 50 });
  all.push(...page.messages);
  let hasNewer = true;
  let hops = 0;
  while (hasNewer) {
    const newer = await listMessages(db, channelId, { after: all.at(-1).cursor, limit: 50 });
    assert.ok(newer.messages.length > 0 || !newer.hasNewer);
    all.push(...newer.messages);
    hasNewer = newer.hasNewer;
    assert.ok(++hops < 20, 'terminates');
  }
  assert.equal(all.length, TOTAL);
  assert.equal(new Set(all.map((m) => m.id)).size, TOTAL);
  const times = all.map((m) => m.cursor);
  assert.deepEqual(times, [...times].sort(), 'oldest first throughout');
});

test('the newest end says there is nothing newer', async () => {
  const newest = await listMessages(db, channelId, { limit: 50 });
  const beyond = await listMessages(db, channelId, { after: newest.messages.at(-1).cursor, limit: 50 });
  assert.deepEqual(beyond.messages, []);
  assert.equal(beyond.hasNewer, false);
});

test('a window around an old message can be continued in both directions', async () => {
  const newest = await listMessages(db, channelId, { limit: 50 });
  let page = newest;
  while (page.nextCursor) page = await listMessages(db, channelId, { before: page.nextCursor, limit: 50 });
  const target = page.messages[15];
  const window = await listAround(db, channelId, target.id);
  const ids = new Set(window.messages.map((m) => m.id));
  const newer = await listMessages(db, channelId, { after: window.messages.at(-1).cursor, limit: 50 });
  assert.equal(newer.messages.length, 50);
  assert.ok(
    newer.messages.every((m) => !ids.has(m.id)),
    'no overlap with the window',
  );
  const older = await listMessages(db, channelId, { before: window.messages[0].cursor, limit: 50 });
  assert.ok(older.messages.every((m) => !ids.has(m.id)));
  assert.equal(window.hasNewer, true, 'a window in old history says there is more below it');
});

test('deleted messages and thread replies are skipped going newer, as they are going older', async () => {
  const first = await listMessages(db, channelId, { limit: 10 });
  const root = first.messages[0];
  await db.query(`INSERT INTO chat.messages (channel_id, user_id, content, thread_id) VALUES ($1, 1, 'a reply', $2)`, [
    channelId,
    root.id,
  ]);
  await db.query(`UPDATE chat.messages SET deleted_at = now() WHERE id = $1`, [first.messages[5].id]);
  const newer = await listMessages(db, channelId, { after: root.cursor, limit: 50 });
  assert.equal(newer.messages.length, 8, 'nine followed it; one is deleted; the thread reply is not listed');
  assert.ok(!names(newer).includes('a reply'));
});

test('a bad cursor is ignored rather than failing', async () => {
  const page = await listMessages(db, channelId, { after: 'nonsense', limit: 5 });
  assert.equal(page.messages.length, 5);
});
