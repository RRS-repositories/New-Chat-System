import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, dmKey, createChannel, openDm, listChannelsForUser, isMember } from '../src/models/channels.model.js';

function stubDb(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [re, fn] of handlers)
        if (re.test(sql)) {
          const rows = fn(params);
          return { rows, rowCount: rows.length };
        }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('slugify and dmKey are deterministic', () => {
  assert.equal(slugify('IRL Team!'), 'irl-team');
  assert.equal(slugify('  Dsar   Team '), 'dsar-team');
  assert.equal(dmKey(9, 3), 'dm:3:9');
  assert.equal(dmKey(3, 9), 'dm:3:9');
});

test('createChannel inserts the channel, then members with the creator as owner', async () => {
  const db = stubDb([
    [
      /INSERT INTO chat\.channels/,
      () => [{ id: 'c1', name: 'irl-team', display_name: 'IRL Team', type: 'private', purpose: '', header: '' }],
    ],
    [/INSERT INTO chat\.channel_members/, () => [{}, {}, {}]],
  ]);
  const ch = await createChannel(db, {
    displayName: 'IRL Team',
    type: 'private',
    createdBy: 5,
    memberIds: [5, 8, 9, 8],
  });
  assert.equal(ch.id, 'c1');
  assert.equal(ch.name, 'irl-team');
  const ins = db.calls.find((c) => /INSERT INTO chat\.channel_members/.test(c.sql));
  assert.ok(/'owner'/.test(ins.sql));
  assert.equal(ins.params[0], 'c1');
  assert.equal(ins.params[1], 5);
  assert.deepEqual(ins.params[2], [5, 8, 9]);
});

test('createChannel: a name a live channel holds is refused with 409 and a word on where it is', async () => {
  const held = (type, mine) =>
    stubDb([
      [
        /SELECT c\.id, c\.display_name/,
        () => [{ id: 'old', display_name: 'Admin Training', type, archived_at: null, mine }],
      ],
    ]);
  const attempt = (db) => createChannel(db, { displayName: 'ADMIN TRAINING', type: 'public', createdBy: 7 });
  await assert.rejects(() => attempt(held('public', false)), {
    code: 'name_taken',
    status: 409,
    message: 'A channel called “Admin Training” already exists. Join it from Browse channels.',
  });
  await assert.rejects(() => attempt(held('private', false)), {
    code: 'name_taken',
    message:
      'A channel called “Admin Training” already exists. It is private, so you cannot see it. Choose another name.',
  });
  await assert.rejects(() => attempt(held('private', true)), {
    code: 'name_taken',
    message: 'A channel called “Admin Training” already exists. You are already in it.',
  });
  const db = held('public', false);
  await attempt(db).catch(() => {});
  assert.ok(!db.calls.some((c) => /INSERT/.test(c.sql)), 'nothing was inserted');
});

test('createChannel: a name an archived channel holds is handed over; the archived row is renamed', async () => {
  const db = stubDb([
    [
      /SELECT c\.id, c\.display_name/,
      () => [{ id: 'old', display_name: 'Admin Training', type: 'public', archived_at: '2026-10-01', mine: false }],
    ],
    [/UPDATE chat\.channels SET name = name/, () => [{}]],
    [
      /INSERT INTO chat\.channels/,
      () => [{ id: 'new', name: 'admin-training', display_name: 'ADMIN TRAINING', type: 'public', purpose: '' }],
    ],
  ]);
  const ch = await createChannel(db, { displayName: 'ADMIN TRAINING', type: 'public', createdBy: 7 });
  assert.equal(ch.id, 'new');
  const order = db.calls.map((c) => c.sql.trim().split(/\s+/)[0]);
  assert.deepEqual(order.slice(0, 3), ['SELECT', 'UPDATE', 'INSERT'], 'look, free the name, then insert');
  assert.deepEqual(db.calls[1].params, ['old']);
});

test('createChannel: a clash the look-up missed (two creates at once) is still answered as name_taken', async () => {
  const db = stubDb([
    [
      /INSERT INTO chat\.channels/,
      () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      },
    ],
  ]);
  await assert.rejects(() => createChannel(db, { displayName: 'Admin Training', type: 'public', createdBy: 7 }), {
    code: 'name_taken',
    status: 409,
    message: 'A channel called “Admin Training” already exists.',
  });
});

test('createChannel refuses a bad type and an empty name', async () => {
  const db = stubDb([]);
  await assert.rejects(() => createChannel(db, { displayName: '', type: 'public', createdBy: 1, memberIds: [] }), {
    code: 'bad_name',
  });
  await assert.rejects(() => createChannel(db, { displayName: 'x', type: 'dm', createdBy: 1, memberIds: [] }), {
    code: 'bad_type',
  });
});

test('openDm upserts on the full (workspace_id, name) constraint so a race yields one channel', async () => {
  const db = stubDb([
    [
      /INSERT INTO chat\.channels[\s\S]*ON CONFLICT \(workspace_id, name\) DO UPDATE/,
      () => [{ id: 'd1', name: 'dm:3:9', display_name: '', type: 'dm', purpose: '', header: '' }],
    ],
    [/FROM public\.users WHERE id/, () => [{ id: 3, full_name: 'Bob' }]],
  ]);
  const ch = await openDm(db, 9, 3);
  assert.equal(ch.id, 'd1');
  assert.equal(ch.type, 'dm');
  assert.equal(ch.dmUserName, 'Bob');
  const ins = db.calls.find((c) => /INSERT INTO chat\.channels/.test(c.sql));
  assert.ok(ins.params.includes('dm:3:9'));
  await assert.rejects(() => openDm(db, 3, 3), { code: 'self_dm' });
});

test('listChannelsForUser returns [] for a member of nothing, and maps rows', async () => {
  assert.deepEqual(await listChannelsForUser(stubDb([]), 42), []);
  const db = stubDb([
    [
      /FROM chat\.channel_members m[\s\S]*WHERE m\.user_id = \$1/,
      () => [
        {
          id: 'c1',
          name: 'general',
          display_name: 'General',
          type: 'public',
          purpose: '',
          header: '',
          unread_count: '3',
          last_message_at: null,
          dm_user_id: null,
          dm_user_name: null,
          member_count: '12',
        },
      ],
    ],
  ]);
  const [c] = await listChannelsForUser(db, 42);
  assert.equal(c.unreadCount, 3);
  assert.equal(c.memberCount, 12);
  assert.equal(c.displayName, 'General');
});

test('isMember is a boolean', async () => {
  assert.equal(
    await isMember(stubDb([[/FROM chat\.channel_members WHERE channel_id/, () => [{ ok: 1 }]]]), 'c1', 1),
    true,
  );
  assert.equal(await isMember(stubDb([]), 'c1', 1), false);
});
