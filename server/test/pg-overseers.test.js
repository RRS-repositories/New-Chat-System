// Management and IT are in every channel: added when a channel is made, and to older channels when
// their list loads. Never to direct messages or group conversations. On PGlite.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import {
  createChannel,
  ensureDefaultMembership,
  listChannelsForUser,
  listMembers,
  openDm,
  overseerIds,
} from '../src/models/channels.model.js';

const { db, close } = await createTestDb();
// Helper users: 1 Meg Manager (Management), 2 Ann Agent, 3 Bob Sales, 4 Gone (inactive), 5 Cy Sales. Added: 6 Ivy IT.
await db.query(`INSERT INTO users (email, full_name, role) VALUES ('ivy@x', 'Ivy IT', 'IT')`);
after(() => close());
const memberIds = async (id) => (await listMembers(db, id)).map((m) => m.id).sort((a, b) => a - b);

test('overseerIds: every active, approved Management or IT person', async () => {
  assert.deepEqual(await overseerIds(db), [1, 6]);
  await db.query(`UPDATE users SET is_active = FALSE WHERE id = 6`);
  assert.deepEqual(await overseerIds(db), [1], 'a switched-off person is not one');
  await db.query(`UPDATE users SET is_active = TRUE WHERE id = 6`);
});

test('a new private channel made by Ann with Bob has Meg and Ivy in it too; a group conversation does not', async () => {
  const c = await createChannel(db, { displayName: 'Rota', type: 'private', createdBy: 2, memberIds: [3] });
  assert.deepEqual(await memberIds(c.id), [1, 2, 3, 6]);
  const owner = (await listMembers(db, c.id)).find((m) => m.id === 2);
  assert.equal(owner.channelRole, 'owner', 'Ann still owns it');
  const g = await createChannel(db, { displayName: 'Trio', type: 'group_dm', createdBy: 2, memberIds: [3, 5] });
  assert.deepEqual(await memberIds(g.id), [2, 3, 5]);
});

test('a channel that existed before: Meg is put in when her list loads; Ann is not; direct messages are left alone', async () => {
  const {
    rows: [old],
  } = await db.query(
    `INSERT INTO chat.channels (name, display_name, type, created_by) VALUES ('old-sales', 'Old Sales', 'public', 3) RETURNING id`,
  );
  await db.query(`INSERT INTO chat.channel_members (channel_id, user_id, role) VALUES ($1, 3, 'owner')`, [old.id]);
  const dm = await openDm(db, 3, 5);
  await ensureDefaultMembership(db, 1);
  await ensureDefaultMembership(db, 2);
  assert.ok(
    (await listChannelsForUser(db, 1)).some((c) => c.id === old.id),
    'Meg sees the old channel',
  );
  assert.ok(!(await listChannelsForUser(db, 2)).some((c) => c.id === old.id), 'Ann does not');
  assert.ok(
    !(await listChannelsForUser(db, 1)).some((c) => c.id === dm.id),
    "Meg is not in Bob and Cy's direct message",
  );
  assert.ok(
    (await listChannelsForUser(db, 1)).some((c) => c.name === 'general'),
    'and General, like everyone',
  );
});
