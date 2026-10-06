// Copying Mattermost into the chat, run against a stand-in Mattermost and the real chat tables on PGlite.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDb } from './pg-helper.js';
import { runImport, convertContent, normaliseMime } from '../dev/import/mattermost.js';
import { emojiOf } from '../dev/import/emoji.js';
import { listChannelsForUser } from '../src/models/channels.model.js';

const { db, close } = await createTestDb();
after(() => close());
// Users from the helper: 1 Meg m@x, 2 Ann a@x, 3 Bob b@x, 5 Cy c@x.
const uploadsDir = mkdtempSync(path.join(tmpdir(), 'chat-import-'));
const T0 = Date.parse('2026-03-10T09:00:00Z');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// The stand-in Mattermost: what each query the copy makes would return.
const MM = {
  users: [
    { id: 'u-meg', username: 'meg_m', email: 'm@x', name: 'Meg Manager' },
    { id: 'u-ann', username: 'ann_a', email: 'a@x', name: 'Ann Agent' },
    { id: 'u-stranger', username: 'stranger', email: 'nobody@elsewhere', name: 'No Account' },
    // Bob never signed in to Mattermost: the users query leaves him out.
  ],
  channels: [
    {
      id: 'c-town',
      name: 'town-square',
      displayname: 'Town Square',
      type: 'O',
      purpose: '',
      creatorid: 'u-meg',
      createat: T0,
    },
    {
      id: 'c-off',
      name: 'off-topic',
      displayname: 'Off-Topic',
      type: 'O',
      purpose: '',
      creatorid: 'u-meg',
      createat: T0,
    },
    {
      id: 'c-admin',
      name: 'admin-team',
      displayname: 'Admin Team',
      type: 'P',
      purpose: 'The admins',
      creatorid: 'u-stranger',
      createat: T0 + 1000,
    },
    {
      id: 'c-empty',
      name: 'nobody-here',
      displayname: 'Nobody',
      type: 'O',
      purpose: '',
      creatorid: 'u-meg',
      createat: T0,
    },
  ],
  dms: [
    { id: 'd-meg-ann', name: 'u-ann__u-meg' },
    { id: 'd-meg-bob', name: 'u-bob__u-meg' },
    { id: 'd-ann-stranger', name: 'u-ann__u-stranger' },
  ],
  members: {
    'c-town': [
      { userid: 'u-meg', schemeadmin: false },
      { userid: 'u-ann', schemeadmin: false },
      { userid: 'u-bob', schemeadmin: false },
    ],
    'c-admin': [
      { userid: 'u-meg', schemeadmin: false },
      { userid: 'u-ann', schemeadmin: true },
      { userid: 'u-stranger', schemeadmin: true },
    ],
    'c-off': [],
    'c-empty': [],
  },
  posts: {
    'c-admin': [
      {
        id: 'p1',
        userid: 'u-meg',
        rootid: '',
        message: 'Hello @ann_a and @channel, see x@y.com',
        props: '{}',
        createat: T0 + 10_000,
        editat: 0,
        ispinned: true,
        fileids: '[]',
      },
      {
        id: 'p2',
        userid: 'u-ann',
        rootid: 'p1',
        message: 'Hi!',
        props: '{}',
        createat: T0 + 20_000,
        editat: T0 + 25_000,
        ispinned: false,
        fileids: '[]',
      },
      {
        id: 'p3',
        userid: 'u-meg',
        rootid: '',
        message: 'FRL NEEDS ATTENTION',
        props: '{"from_bot":"true"}',
        createat: T0 + 30_000,
        editat: 0,
        ispinned: false,
        fileids: '[]',
      },
      {
        id: 'p4',
        userid: 'u-bob',
        rootid: '',
        message: 'I never signed in',
        props: '{}',
        createat: T0 + 40_000,
        editat: 0,
        ispinned: false,
        fileids: '[]',
      },
      {
        id: 'p5',
        userid: 'u-ann',
        rootid: '',
        message: '',
        props: '{}',
        createat: T0 + 50_000,
        editat: 0,
        ispinned: false,
        fileids: '["f1","f2","f3"]',
      },
      {
        id: 'p6',
        userid: 'u-ann',
        rootid: '',
        message: 'x'.repeat(5000),
        props: '{}',
        createat: T0 + 60_000,
        editat: 0,
        ispinned: false,
        fileids: '[]',
      },
      {
        id: 'p7',
        userid: 'u-meg',
        rootid: '',
        message: '',
        props: '{}',
        createat: T0 + 70_000,
        editat: 0,
        ispinned: false,
        fileids: '["f4"]',
      },
    ],
    'c-town': [
      {
        id: 'p8',
        userid: 'u-ann',
        rootid: '',
        message: 'Morning all',
        props: '{}',
        createat: T0 + 5000,
        editat: 0,
        ispinned: false,
        fileids: '[]',
      },
    ],
    'd-meg-ann': [
      {
        id: 'p9',
        userid: 'u-meg',
        rootid: '',
        message: 'Got a minute?',
        props: '{}',
        createat: T0 + 1000,
        editat: 0,
        ispinned: false,
        fileids: '[]',
      },
    ],
  },
  files: {
    p5: [
      { id: 'f1', name: 'photo.png', mimetype: 'image/png', size: PNG.length, path: 'a/photo.png' },
      { id: 'f2', name: 'tool.exe', mimetype: 'application/x-msdownload', size: 10, path: 'a/tool.exe' },
      { id: 'f3', name: 'big.pdf', mimetype: 'application/pdf', size: 30 * 1024 * 1024, path: 'a/big.pdf' },
    ],
    p7: [{ id: 'f4', name: 'notes.csv', mimetype: 'text/csv; charset=utf-8', size: 5, path: 'a/missing.csv' }],
  },
  reactions: [
    { postid: 'p1', userid: 'u-ann', emojiname: 'white_check_mark', createat: T0 + 11_000 },
    { postid: 'p1', userid: 'u-bob', emojiname: '+1', createat: T0 + 12_000 },
    { postid: 'p2', userid: 'u-meg', emojiname: 'no_such_emoji', createat: T0 + 26_000 },
    { postid: 'p3', userid: 'u-ann', emojiname: '+1', createat: T0 + 31_000 },
  ],
};
const mm = async (sql, params = []) => {
  if (/FROM users u/.test(sql)) return MM.users;
  if (/FROM channels c WHERE c\.deleteat = 0 AND c\.type IN/.test(sql)) return MM.channels;
  if (/FROM channels c WHERE c\.deleteat = 0 AND c\.type = 'D'/.test(sql)) return MM.dms;
  if (/FROM channelmembers/.test(sql)) return MM.members[params[0]] || [];
  if (/count\(\*\)::int AS n FROM posts/.test(sql)) return [{ n: (MM.posts[params[0]] || []).length }];
  if (/FROM posts WHERE channelid/.test(sql)) return MM.posts[params[0]] || [];
  if (/FROM fileinfo/.test(sql)) return MM.files[params[0]] || [];
  if (/FROM reactions/.test(sql)) return MM.reactions.filter((r) => params[0].includes(r.postid));
  throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
};
const readFile = async (relPath) => (relPath === 'a/photo.png' ? PNG : null);
const run = (extra = {}) => runImport({ db, mm, readFile, uploadsDir, actorId: 1, log: () => {}, ...extra });
const count = async (sql) => Number((await db.query(sql)).rows[0].n);

test('convertContent: mentions become the chat’s form, everyone-mentions become @all, long text is cut', () => {
  const names = new Map([['ann_a', 'Ann Agent']]);
  assert.equal(
    convertContent('Hello @ann_a and @channel, see x@y.com and @unknown', names),
    'Hello @Ann Agent and @all, see x@y.com and @unknown',
  );
  assert.equal(convertContent('@here now', names), '@all now');
  const cut = convertContent('x'.repeat(5000), names);
  assert.ok(cut.length <= 4000 && cut.endsWith('[cut: the original was longer]'));
  assert.equal(normaliseMime('text/csv; charset=utf-8'), 'text/csv');
  assert.equal(emojiOf('white_check_mark'), '✅');
  assert.equal(emojiOf('+1_skin-tone-3'), '👍');
  assert.equal(emojiOf('no_such_emoji'), null);
});

test('a dry run counts everything and writes nothing', async () => {
  const counts = await run({ commit: false });
  assert.equal(counts.people, 2, 'Meg and Ann; the stranger has no CRM account');
  assert.equal(counts.peopleWithoutAccount, 1);
  assert.equal(counts.channelsReused, 1, 'town-square is General');
  assert.equal(counts.channelsCopied, 1, 'admin-team');
  assert.equal(counts.channelsSkipped, 2, 'off-topic and the empty one');
  assert.equal(counts.dmsCopied, 1);
  assert.equal(counts.dmsSkipped, 2, 'Bob never signed in; the stranger has no account');
  assert.equal(counts.messages, 7, 'p1 p2 p5 p6 p7 in the admin channel, p8 in Town Square, p9 in the DM');
  assert.equal(await count(`SELECT count(*) AS n FROM chat.import_map`), 0);
  assert.equal(await count(`SELECT count(*) AS n FROM chat.messages`), 0, 'nothing written');
  assert.equal(await count(`SELECT count(*) AS n FROM chat.channels WHERE name = 'admin-team'`), 0);
  assert.equal(readdirSync(uploadsDir).length, 0, 'no file copied');
});

test('the copy: channels, members, messages with dates, threads, pins, edits, files, reactions; read for everyone', async () => {
  const counts = await run({ commit: true });
  assert.equal(counts.messages, 7);
  assert.equal(counts.messagesLeftOut, 2, 'the bot post and Bob’s');
  assert.equal(counts.threadReplies, 1);
  assert.equal(counts.files, 1, 'the PNG');
  assert.equal(counts.filesLeftOut, 3, 'the exe (type), the big PDF (size), the missing csv');
  assert.equal(counts.reactions, 1);
  assert.equal(
    counts.reactionsLeftOut,
    2,
    'Bob’s, and an unknown emoji (a reaction on a left-out post is never looked at)',
  );

  const admin = (await db.query(`SELECT * FROM chat.channels WHERE name = 'admin-team'`)).rows[0];
  assert.equal(admin.type, 'private');
  assert.equal(admin.display_name, 'Admin Team');
  assert.equal(admin.purpose, 'The admins');
  assert.equal(admin.created_by, 1, 'the Mattermost creator has no account: the first member owns it');
  const members = (
    await db.query(`SELECT user_id, role FROM chat.channel_members WHERE channel_id = $1 ORDER BY user_id`, [admin.id])
  ).rows;
  assert.deepEqual(members, [
    { user_id: 1, role: 'member' },
    { user_id: 2, role: 'admin' },
  ]);

  const msgs = (
    await db.query(
      `SELECT user_id, content, type, pinned, thread_id, edited_at, created_at FROM chat.messages WHERE channel_id = $1 ORDER BY created_at`,
      [admin.id],
    )
  ).rows;
  assert.equal(msgs.length, 5);
  assert.equal(msgs[0].content, 'Hello @Ann Agent and @all, see x@y.com');
  assert.equal(msgs[0].pinned, true);
  assert.equal(new Date(msgs[0].created_at).toISOString(), '2026-03-10T09:00:10.000Z', 'the original time is kept');
  assert.equal(msgs[1].content, 'Hi!');
  assert.ok(msgs[1].thread_id, 'a thread reply');
  assert.ok(msgs[1].edited_at);
  assert.equal(msgs[2].type, 'file');
  const file = (await db.query(`SELECT filename, mime_type, file_path, thumbnail_path FROM chat.files`)).rows[0];
  assert.equal(file.filename, 'photo.png');
  assert.equal(file.mime_type, 'image/png');
  assert.ok(existsSync(path.join(uploadsDir, file.file_path)), 'the file is in the chat’s uploads');
  assert.equal(msgs[3].content.endsWith('[cut: the original was longer]'), true);
  assert.equal(msgs[4].type, 'message', 'its only file was left out, so it is an ordinary message');
  assert.equal(msgs[4].content, '[a file that could not be copied]');
  const reactions = (await db.query(`SELECT user_id, emoji FROM chat.reactions`)).rows;
  assert.deepEqual(reactions, [{ user_id: 2, emoji: '✅' }]);

  // Town Square went into General; the one-to-one conversation exists for both; nothing is unread.
  const general = (await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`)).rows[0];
  assert.equal(await count(`SELECT count(*) AS n FROM chat.messages WHERE channel_id = '${general.id}'`), 1);
  const annsChannels = await listChannelsForUser(db, 2);
  const dm = annsChannels.find((c) => c.type === 'dm');
  assert.ok(dm && dm.dmUserId === 1);
  assert.ok(
    annsChannels.every((c) => c.unreadCount === 0),
    JSON.stringify(annsChannels.map((c) => [c.name, c.unreadCount])),
  );
});

test('running it again copies nothing twice', async () => {
  const before = await count(`SELECT count(*) AS n FROM chat.messages`);
  const counts = await run({ commit: true });
  assert.equal(counts.messages, 0);
  assert.equal(counts.messagesAlreadyHere, 7);
  assert.equal(counts.channelsCopied + counts.dmsCopied, 0);
  assert.equal(await count(`SELECT count(*) AS n FROM chat.messages`), before);
  assert.equal(await count(`SELECT count(*) AS n FROM chat.files`), 1);
});
