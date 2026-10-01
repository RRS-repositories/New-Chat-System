// Search against real Postgres (PGlite): what people actually typed on the live site and got nothing for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { createChannel } from '../src/models/channels.model.js';
import { createMessage } from '../src/models/messages.model.js';
import { SEARCH_PAGE, searchMessages } from '../src/models/search.model.js';

let db, close, general, secret;

before(async () => {
  ({ db, close } = await createTestDb());
  ({
    rows: [general],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`));
  secret = await createChannel(db, { displayName: 'Secret Ops', type: 'private', createdBy: 1, memberIds: [1] });
  // Users: 1 Meg Manager, 2 Ann Agent, 3 Bob Sales (all in #general); only Meg is in Secret Ops.
  await createMessage(db, { channelId: general.id, userId: 2, content: 'The Vanquis invoice is overdue' });
  await createMessage(db, { channelId: general.id, userId: 3, content: 'Call the client back at 4pm' });
  await createMessage(db, { channelId: general.id, userId: 1, content: 'Discount is 100% today, ref A_1' });
  await createMessage(db, { channelId: secret.id, userId: 1, content: 'private invoice talk' });
});
after(() => close());

const texts = (result) => result.hits.map((h) => h.snippet.replace(/<\/?b>/g, ''));

test('part of a word finds the message, and the part is what gets marked', async () => {
  const r = await searchMessages(db, { userId: 3, q: 'invo' });
  assert.equal(r.hits.length, 1, 'Bob is not in Secret Ops, so only the #general message');
  assert.equal(r.hits[0].snippet, 'The Vanquis <b>invo</b>ice is overdue');
  assert.equal((await searchMessages(db, { userId: 3, q: 'VANQ' })).hits.length, 1, 'letter case does not matter');
});

test('a person’s name finds what they wrote', async () => {
  const byAnn = await searchMessages(db, { userId: 3, q: 'ann' });
  assert.deepEqual(texts(byAnn), ['The Vanquis invoice is overdue']);
  assert.equal(byAnn.hits[0].userName, 'Ann Agent');
  const fullName = await searchMessages(db, { userId: 3, q: 'Bob Sales' });
  assert.deepEqual(texts(fullName), ['Call the client back at 4pm']);
});

test('every word typed must be there, in the text or the sender’s name', async () => {
  assert.equal((await searchMessages(db, { userId: 3, q: 'ann invoice' })).hits.length, 1, 'name + word');
  assert.equal((await searchMessages(db, { userId: 3, q: 'bob invoice' })).hits.length, 0, 'Bob never said invoice');
  assert.equal((await searchMessages(db, { userId: 3, q: 'client 4pm' })).hits.length, 1);
});

test('whole-word matching still works when the typed form differs (invoices finds invoice)', async () => {
  const r = await searchMessages(db, { userId: 3, q: 'invoices' });
  assert.equal(r.hits.length, 1);
  assert.match(r.hits[0].snippet, /<b>invoice<\/b>/, 'falls back to the database’s own highlight');
});

test('wildcard characters in the query are taken literally', async () => {
  assert.equal((await searchMessages(db, { userId: 1, q: '100%' })).hits.length, 1);
  assert.equal((await searchMessages(db, { userId: 1, q: 'A_1' })).hits.length, 1);
  assert.equal((await searchMessages(db, { userId: 1, q: 'A_2' })).hits.length, 0);
  assert.equal(
    (await searchMessages(db, { userId: 1, q: '%' })).hits.length,
    1,
    'only the message with a percent sign',
  );
});

test('only the caller’s channels, and "this channel only" narrows further', async () => {
  assert.equal((await searchMessages(db, { userId: 1, q: 'invoice' })).hits.length, 2, 'Meg sees both');
  const scoped = await searchMessages(db, { userId: 1, q: 'invoice', channelId: secret.id });
  assert.deepEqual(texts(scoped), ['private invoice talk']);
  assert.equal((await searchMessages(db, { userId: 3, q: 'invoice', channelId: secret.id })).hits.length, 0);
});

test('deleted messages are not found; blank queries return nothing', async () => {
  const gone = await createMessage(db, { channelId: general.id, userId: 2, content: 'zebra crossing' });
  assert.equal((await searchMessages(db, { userId: 3, q: 'zebra' })).hits.length, 1);
  await db.query(`UPDATE chat.messages SET deleted_at = now() WHERE id = $1`, [gone.id]);
  assert.equal((await searchMessages(db, { userId: 3, q: 'zebra' })).hits.length, 0);
  assert.deepEqual(await searchMessages(db, { userId: 3, q: '   ' }), { hits: [], page: 1, hasMore: false });
});

test('pages of 20, newest first among equal matches', async () => {
  for (let i = 1; i <= SEARCH_PAGE + 3; i++)
    await createMessage(db, { channelId: general.id, userId: 3, content: `paging sample ${i}` });
  const first = await searchMessages(db, { userId: 3, q: 'pagin' });
  assert.equal(first.hits.length, SEARCH_PAGE);
  assert.equal(first.hasMore, true);
  assert.equal(texts(first)[0], `paging sample ${SEARCH_PAGE + 3}`, 'newest first');
  const second = await searchMessages(db, { userId: 3, q: 'pagin', page: 2 });
  assert.equal(second.hits.length, 3);
  assert.equal(second.hasMore, false);
});
