import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertMentions } from '../src/models/mentions.model.js';
import { parseMentions } from '../src/utils/mentions.js';

const members = [
  { id: 1, fullName: 'Ann Agent' },
  { id: 2, fullName: 'Ann' },
  { id: 3, fullName: 'Bob Sales' },
];

test('@Full Name beats @First; case-insensitive; word boundary; no self-match on emails', () => {
  assert.deepEqual(parseMentions('hi @Ann Agent and @bob sales', members), { userIds: [1, 3], all: false });
  assert.deepEqual(parseMentions('hi @ann', members), { userIds: [2], all: false });
  assert.deepEqual(parseMentions('mail ann@x.com', members), { userIds: [], all: false });
  assert.deepEqual(parseMentions('@Annabelle', members), { userIds: [], all: false });
});
test('@all and @channel mention everyone', () => {
  assert.deepEqual(parseMentions('heads up @all', members), { userIds: [], all: true });
  assert.deepEqual(parseMentions('@channel lunch?', members), { userIds: [], all: true });
});
test('insertMentions is one statement, excludes the author, and tags @all rows', async () => {
  const calls = [];
  const db = {
    async query(sql, p) {
      calls.push({ sql, p });
      return { rows: [{ n: 3 }], rowCount: 3 };
    },
  };
  await insertMentions(db, { messageId: 'm1', channelId: 'c1', authorId: 1, userIds: [1, 3], all: false });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].p[3], [3]);
  calls.length = 0;
  await insertMentions(db, { messageId: 'm1', channelId: 'c1', authorId: 1, userIds: [], all: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /'all'/);
  assert.match(calls[0].sql, /user_id <> \$3/);
  assert.equal(await insertMentions(db, { messageId: 'm1', channelId: 'c1', authorId: 1, userIds: [], all: false }), 0);
});
