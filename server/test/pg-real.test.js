// Real Postgres (PGlite, in-process) for the SQL the regex stubs cannot vouch for:
// the migration is idempotent, a DM race yields one channel, #general has members,
// and cursor paging does not skip messages that share a millisecond.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  openDm,
  listChannelsForUser,
  ensureDefaultMembership,
  addMembers,
  markRead,
  createChannel,
} from '../src/models/channels.model.js';
import { searchMessages } from '../src/models/search.model.js';
import { insertMentions } from '../src/models/mentions.model.js';
import { listMessages, createMessage, listThread, listAround, getMessage } from '../src/models/messages.model.js';
import { pinMessage, unpinMessage, listPins } from '../src/models/pins.model.js';
import { insertFile, getFile } from '../src/models/files.model.js';
import { parseMentions } from '../src/utils/mentions.js';
import { addReaction, removeReaction } from '../src/models/reactions.model.js';

const migration = readFileSync(new URL('../migrations/chat_001_schema.sql', import.meta.url), 'utf8');
const migration2 = readFileSync(new URL('../migrations/chat_002_rich.sql', import.meta.url), 'utf8');
let pg, db;

before(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT, full_name TEXT, role TEXT, is_approved BOOLEAN DEFAULT TRUE, is_active BOOLEAN DEFAULT TRUE, sessions_valid_from TIMESTAMPTZ);
    INSERT INTO users (email, full_name, role) VALUES ('m@x', 'Meg Manager', 'Management'), ('a@x', 'Ann Agent', 'cs_agent'), ('b@x', 'Bob Sales', 'Sales');
    INSERT INTO users (email, full_name, role, is_active) VALUES ('gone@x', 'Gone User', 'Sales', FALSE);
  `);
  await pg.exec(migration);
  await pg.exec(migration); // idempotent
  await pg.exec(migration2);
  await pg.exec(migration2); // idempotent
  db = {
    async query(sql, params = []) {
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
});
after(async () => {
  await pg.close();
});

test('migration is idempotent and seeds #general with every approved, active user', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  assert.ok(g);
  const { rows } = await db.query(`SELECT user_id FROM chat.channel_members WHERE channel_id = $1 ORDER BY user_id`, [
    g.id,
  ]);
  assert.deepEqual(
    rows.map((r) => r.user_id),
    [1, 2, 3],
    'inactive user 4 is not seeded',
  );
});

test('a user created after the seed is joined to #general on their first channel list', async () => {
  await db.query(`INSERT INTO users (email, full_name, role) VALUES ('new@x', 'New Person', 'Sales')`);
  await ensureDefaultMembership(db, 5);
  const list = await listChannelsForUser(db, 5);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'general');
});

test('opening the same DM from both sides, twice, concurrently, yields exactly one channel', async () => {
  const [x, y, z] = await Promise.all([openDm(db, 2, 3), openDm(db, 3, 2), openDm(db, 2, 3)]);
  assert.equal(x.id, y.id);
  assert.equal(y.id, z.id);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM chat.channels WHERE type = 'dm'`);
  assert.equal(rows[0].n, 1);
  const { rows: m } = await db.query(`SELECT user_id FROM chat.channel_members WHERE channel_id = $1 ORDER BY 1`, [
    x.id,
  ]);
  assert.deepEqual(
    m.map((r) => r.user_id),
    [2, 3],
  );
  assert.equal(x.dmUserName, 'Bob Sales');
});

test('addMembers returns only the ids actually inserted', async () => {
  const dm = await openDm(db, 2, 3);
  assert.deepEqual(await addMembers(db, dm.id, [3, 1, 1], 2), [1]);
});

test('cursor paging never skips messages that share a millisecond', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  for (let i = 0; i < 6; i++) {
    await db.query(`INSERT INTO chat.messages (channel_id, user_id, content, created_at) VALUES ($1, 2, $2, $3)`, [
      g.id,
      `m${i}`,
      `2026-01-01T10:00:00.00000${i}Z`,
    ]);
  }
  const p1 = await listMessages(db, g.id, { limit: 4 });
  assert.deepEqual(
    p1.messages.map((m) => m.content),
    ['m2', 'm3', 'm4', 'm5'],
  );
  assert.ok(p1.nextCursor);
  const p2 = await listMessages(db, g.id, { limit: 4, before: p1.nextCursor });
  assert.deepEqual(
    p2.messages.map((m) => m.content),
    ['m0', 'm1'],
  );
  assert.equal(p2.nextCursor, null);
});

test('createMessage returns the author name from a real join', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const m = await createMessage(db, { channelId: g.id, userId: 3, content: 'hello' });
  assert.equal(m.userName, 'Bob Sales');
  assert.equal(m.channelId, g.id);
});

test('replies: preview comes from the target; a reply to a thread reply is filed under the root; wrong channel is refused', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const root = await createMessage(db, { channelId: g.id, userId: 2, content: 'root question' });
  const r1 = await createMessage(db, {
    channelId: g.id,
    userId: 3,
    content: 'first reply',
    threadId: root.id,
    replyToId: root.id,
  });
  assert.equal(r1.threadId, root.id);
  assert.equal(r1.replyTo.content, 'root question');
  const r2 = await createMessage(db, {
    channelId: g.id,
    userId: 2,
    content: 'reply to reply',
    threadId: r1.id,
    replyToId: r1.id,
  });
  assert.equal(r2.threadId, root.id, 'threads never nest');
  const t = await listThread(db, root.id);
  assert.deepEqual(
    t.replies.map((m) => m.content),
    ['first reply', 'reply to reply'],
  );
  assert.equal((await listMessages(db, g.id, { limit: 50 })).messages.find((m) => m.id === root.id).replyCount, 2);
  const other = await openDm(db, 2, 3);
  await assert.rejects(() => createMessage(db, { channelId: other.id, userId: 2, content: 'x', replyToId: root.id }), {
    code: 'bad_reply',
  });
});

test('listAround returns a window centred on the target and a cursor for older', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const ids = [];
  for (let i = 0; i < 12; i++)
    ids.push((await createMessage(db, { channelId: g.id, userId: 2, content: `around ${i}` })).id);
  const w = await listAround(db, g.id, ids[6], { radius: 3 });
  assert.ok(w.messages.some((m) => m.id === ids[6]));
  const idx = w.messages.findIndex((m) => m.id === ids[6]);
  assert.ok(idx >= 3 && w.messages.length >= 7, `window ${w.messages.length}, idx ${idx}`);
  assert.equal(w.target, ids[6]);
  assert.ok(w.nextCursor);
});

test('mentions drive mentionCount; markRead clears it', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const m = await createMessage(db, { channelId: g.id, userId: 2, content: '@Bob Sales look' });
  await insertMentions(db, { messageId: m.id, channelId: g.id, authorId: 2, userIds: [3], all: false });
  let list = await listChannelsForUser(db, 3);
  assert.equal(list.find((c) => c.id === g.id).mentionCount, 1);
  assert.equal(
    (await listChannelsForUser(db, 2)).find((c) => c.id === g.id).mentionCount,
    0,
    'author is never mentioned',
  );
  await markRead(db, g.id, 3);
  list = await listChannelsForUser(db, 3);
  assert.equal(list.find((c) => c.id === g.id).mentionCount, 0);
  assert.equal(list.find((c) => c.id === g.id).unreadCount, 0);
});

test('@all in a big channel is one insert and mentions everyone but the author', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const m = await createMessage(db, { channelId: g.id, userId: 1, content: '@all standup' });
  const n = await insertMentions(db, { messageId: m.id, channelId: g.id, authorId: 1, userIds: [], all: true });
  const {
    rows: [{ members }],
  } = await db.query(`SELECT count(*)::int AS members FROM chat.channel_members WHERE channel_id = $1`, [g.id]);
  assert.equal(n, members - 1);
});

test('pins: pinned flag, list newest-first, unpin; reactions toggle cleanly and aggregate', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const a = await createMessage(db, { channelId: g.id, userId: 2, content: 'pin me' });
  const b = await createMessage(db, { channelId: g.id, userId: 2, content: 'pin me too' });
  await pinMessage(db, { messageId: a.id, userId: 1 });
  await pinMessage(db, { messageId: b.id, userId: 1 });
  assert.deepEqual(
    (await listPins(db, g.id)).map((m) => m.id),
    [b.id, a.id],
  );
  assert.equal((await unpinMessage(db, { messageId: a.id })).pinned, false);
  assert.deepEqual(
    (await listPins(db, g.id)).map((m) => m.id),
    [b.id],
  );
  assert.equal(await addReaction(db, { messageId: a.id, userId: 3, emoji: '👍' }), true);
  assert.equal(await addReaction(db, { messageId: a.id, userId: 3, emoji: '👍' }), false, 'second add is a no-op');
  await addReaction(db, { messageId: a.id, userId: 2, emoji: '👍' });
  let m = await getMessage(db, a.id);
  assert.deepEqual(m.reactions, [{ emoji: '👍', count: 2, userIds: [3, 2] }]);
  assert.equal(await removeReaction(db, { messageId: a.id, userId: 3, emoji: '👍' }), true);
  assert.equal(await removeReaction(db, { messageId: a.id, userId: 3, emoji: '👍' }), false);
  m = await getMessage(db, a.id);
  assert.deepEqual(m.reactions, [{ emoji: '👍', count: 1, userIds: [2] }]);
});

test('search returns only the caller’s channels, ranked, with a headline snippet', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const priv = await createChannel(db, { displayName: 'Secret Ops', type: 'private', createdBy: 1, memberIds: [1] });
  await createMessage(db, { channelId: g.id, userId: 2, content: 'the invoice for Vanquis is overdue' });
  await createMessage(db, { channelId: priv.id, userId: 1, content: 'private invoice talk' });
  const asBob = await searchMessages(db, { userId: 3, q: 'invoice' });
  assert.equal(asBob.hits.length, 1);
  assert.equal(asBob.hits[0].channelName, 'General');
  assert.match(asBob.hits[0].snippet, /<b>invoice<\/b>/);
  const asMeg = await searchMessages(db, { userId: 1, q: 'invoice' });
  assert.equal(asMeg.hits.length, 2);
  assert.deepEqual(await searchMessages(db, { userId: 3, q: '   ' }), { hits: [], page: 1, hasMore: false });
  const scoped = await searchMessages(db, { userId: 1, q: 'invoice', channelId: priv.id });
  assert.equal(scoped.hits.length, 1);
  assert.equal(scoped.hits[0].channelId, priv.id);
});

test('listAround with microsecond timestamps: target appears exactly once, window is exact', async () => {
  const priv = await createChannel(db, { displayName: 'Around Micro', type: 'private', createdBy: 1, memberIds: [1] });
  const ids = [];
  for (let i = 0; i < 9; i++) {
    const {
      rows: [r],
    } = await db.query(
      `INSERT INTO chat.messages (channel_id, user_id, content, created_at) VALUES ($1, 1, $2, $3) RETURNING id`,
      [priv.id, `u${i}`, `2026-02-01T10:00:00.00000${i}Z`],
    );
    ids.push(r.id);
  }
  const w = await listAround(db, priv.id, ids[4], { radius: 2 });
  assert.deepEqual(
    w.messages.map((m) => m.content),
    ['u2', 'u3', 'u4', 'u5', 'u6'],
  );
  assert.equal(w.messages.filter((m) => m.id === ids[4]).length, 1);
});

test('a file on a deleted message is no longer retrievable', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const m = await createMessage(db, { channelId: g.id, userId: 2, content: '', type: 'file' });
  const f = await insertFile(db, {
    messageId: m.id,
    channelId: g.id,
    userId: 2,
    filename: 'x.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    filePath: `${g.id}/x.pdf`,
    thumbnailPath: null,
  });
  assert.ok(await getFile(db, f.id));
  await db.query(`UPDATE chat.messages SET deleted_at = now() WHERE id = $1`, [m.id]);
  assert.equal(await getFile(db, f.id), null);
});

test('server mentions match @FirstName when it is unambiguous, like the client does', () => {
  const members = [
    { id: 1, fullName: 'Ann Agent' },
    { id: 3, fullName: 'Bob Sales' },
    { id: 4, fullName: 'Bob Jones' },
  ];
  assert.deepEqual(parseMentions('hi @ann', members), { userIds: [1], all: false });
  assert.deepEqual(
    parseMentions('hi @Bob', members),
    { userIds: [], all: false },
    'two Bobs: first name alone is ambiguous',
  );
  assert.deepEqual(parseMentions('hi @Bob Jones', members), { userIds: [4], all: false });
});

test('a mention on a deleted message no longer counts toward the badge', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const count = async () => (await listChannelsForUser(db, 3)).find((c) => c.id === g.id).mentionCount;
  const before = await count();
  const m = await createMessage(db, { channelId: g.id, userId: 2, content: '@Bob Sales gone soon' });
  await insertMentions(db, { messageId: m.id, channelId: g.id, authorId: 2, userIds: [3], all: false });
  assert.equal(await count(), before + 1);
  await db.query(`UPDATE chat.messages SET deleted_at = now() WHERE id = $1`, [m.id]);
  assert.equal(await count(), before, 'the deleted message’s mention no longer counts');
});
