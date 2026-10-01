import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, dmKey, createChannel, openDm, listChannelsForUser, isMember } from '../src/repo/channels.js';

function stubDb(handlers) {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); for (const [re, fn] of handlers) if (re.test(sql)) { const rows = fn(params); return { rows, rowCount: rows.length }; } return { rows: [], rowCount: 0 }; } };
}

test('slugify and dmKey are deterministic', () => {
  assert.equal(slugify('IRL Team!'), 'irl-team');
  assert.equal(slugify('  Dsar   Team '), 'dsar-team');
  assert.equal(dmKey(9, 3), 'dm:3:9');
  assert.equal(dmKey(3, 9), 'dm:3:9');
});

test('createChannel inserts the channel, then members with the creator as owner', async () => {
  const db = stubDb([
    [/INSERT INTO chat\.channels/, () => [{ id: 'c1', name: 'irl-team', display_name: 'IRL Team', type: 'private', purpose: '', header: '' }]],
    [/INSERT INTO chat\.channel_members/, () => [{}, {}, {}]],
  ]);
  const ch = await createChannel(db, { displayName: 'IRL Team', type: 'private', createdBy: 5, memberIds: [5, 8, 9, 8] });
  assert.equal(ch.id, 'c1'); assert.equal(ch.name, 'irl-team');
  const ins = db.calls.find((c) => /INSERT INTO chat\.channel_members/.test(c.sql));
  assert.ok(/'owner'/.test(ins.sql));
  assert.equal(ins.params[0], 'c1'); assert.equal(ins.params[1], 5); assert.deepEqual(ins.params[2], [5, 8, 9]);
});

test('createChannel refuses a bad type and an empty name', async () => {
  const db = stubDb([]);
  await assert.rejects(() => createChannel(db, { displayName: '', type: 'public', createdBy: 1, memberIds: [] }), { code: 'bad_name' });
  await assert.rejects(() => createChannel(db, { displayName: 'x', type: 'dm', createdBy: 1, memberIds: [] }), { code: 'bad_type' });
});

test('openDm upserts on the full (workspace_id, name) constraint so a race yields one channel', async () => {
  const db = stubDb([
    [/INSERT INTO chat\.channels[\s\S]*ON CONFLICT \(workspace_id, name\) DO UPDATE/, () => [{ id: 'd1', name: 'dm:3:9', display_name: '', type: 'dm', purpose: '', header: '' }]],
    [/FROM public\.users WHERE id/, () => [{ id: 3, full_name: 'Bob' }]],
  ]);
  const ch = await openDm(db, 9, 3);
  assert.equal(ch.id, 'd1'); assert.equal(ch.type, 'dm'); assert.equal(ch.dmUserName, 'Bob');
  const ins = db.calls.find((c) => /INSERT INTO chat\.channels/.test(c.sql));
  assert.ok(ins.params.includes('dm:3:9'));
  await assert.rejects(() => openDm(db, 3, 3), { code: 'self_dm' });
});

test('listChannelsForUser returns [] for a member of nothing, and maps rows', async () => {
  assert.deepEqual(await listChannelsForUser(stubDb([]), 42), []);
  const db = stubDb([[/FROM chat\.channel_members m[\s\S]*WHERE m\.user_id = \$1/, () => [
    { id: 'c1', name: 'general', display_name: 'General', type: 'public', purpose: '', header: '', unread_count: '3', last_message_at: null, dm_user_id: null, dm_user_name: null, member_count: '12' },
  ]]]);
  const [c] = await listChannelsForUser(db, 42);
  assert.equal(c.unreadCount, 3); assert.equal(c.memberCount, 12); assert.equal(c.displayName, 'General');
});

test('isMember is a boolean', async () => {
  assert.equal(await isMember(stubDb([[/FROM chat\.channel_members WHERE channel_id/, () => [{ ok: 1 }]]]), 'c1', 1), true);
  assert.equal(await isMember(stubDb([]), 'c1', 1), false);
});
