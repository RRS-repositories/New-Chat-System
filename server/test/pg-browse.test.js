// Real Postgres (PGlite, in-process) for the browse/join SQL: membership visibility,
// idempotent join, and the not_found/not_public branches over real archived_at/type checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { listPublicChannels, joinPublicChannel } from '../src/models/browse.model.js';
import { createChannel } from '../src/models/channels.model.js';

let close, db;

before(async () => { ({ db, close } = await createTestDb()); });
after(async () => { await close(); });

test('#general is listed with joined:true for a seeded member and joined:false after removal', async () => {
  const asAnn = await listPublicChannels(db, { userId: 2 });
  const general = asAnn.find((c) => c.name === 'general');
  assert.ok(general, '#general is listed');
  assert.equal(general.joined, true);
  assert.equal(general.displayName, 'General');
  assert.equal(general.memberCount, 4, 'seeded members 1, 2, 3, 5 (inactive user 4 excluded)');

  await db.query(`DELETE FROM chat.channel_members WHERE channel_id = $1 AND user_id = $2`, [general.id, 5]);
  const asCy = await listPublicChannels(db, { userId: 5 });
  assert.equal(asCy.find((c) => c.name === 'general').joined, false);
});

test('a private channel is not listed', async () => {
  const priv = await createChannel(db, { displayName: 'Secret Ops', type: 'private', createdBy: 1, memberIds: [1] });
  const list = await listPublicChannels(db, { userId: 1 });
  assert.ok(!list.some((c) => c.id === priv.id));
});

test('join is idempotent: only the first call actually joins and audit-logs', async () => {
  const { rows: [g] } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  const first = await joinPublicChannel(db, { channelId: g.id, userId: 5 });
  assert.equal(first.joined, true, 'user 5 was removed from #general by the earlier test');
  assert.equal(first.channel.id, g.id);
  const second = await joinPublicChannel(db, { channelId: g.id, userId: 5 });
  assert.equal(second.joined, false, 'already a member: the ON CONFLICT insert added nothing');
  assert.equal(second.channel.id, g.id);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM chat.channel_members WHERE channel_id = $1 AND user_id = $2`, [g.id, 5]);
  assert.equal(rows[0].n, 1, 'still exactly one membership row after joining twice');
  const audits = await db.query(`SELECT * FROM chat.audit_log WHERE action = 'member.join' AND target_id = $1 AND actor_id = $2`, [g.id, 5]);
  assert.equal(audits.rows.length, 1, 'only the actual join is audit-logged, not the no-op retry');
});

test('joining a private channel is refused with not_public', async () => {
  const priv = await createChannel(db, { displayName: 'Private Room', type: 'private', createdBy: 1, memberIds: [1] });
  await assert.rejects(
    () => joinPublicChannel(db, { channelId: priv.id, userId: 2 }),
    (err) => { assert.equal(err.code, 'not_public'); assert.equal(err.status, 403); return true; },
  );
});

test('joining an archived channel is refused with not_found', async () => {
  const pub = await createChannel(db, { displayName: 'Old Channel', type: 'public', createdBy: 1, memberIds: [1] });
  await db.query(`UPDATE chat.channels SET archived_at = now() WHERE id = $1`, [pub.id]);
  await assert.rejects(
    () => joinPublicChannel(db, { channelId: pub.id, userId: 2 }),
    (err) => { assert.equal(err.code, 'not_found'); assert.equal(err.status, 404); return true; },
  );
});

test('joining a missing channel id is refused with not_found', async () => {
  await assert.rejects(
    () => joinPublicChannel(db, { channelId: '00000000-0000-0000-0000-000000000099', userId: 2 }),
    (err) => { assert.equal(err.code, 'not_found'); assert.equal(err.status, 404); return true; },
  );
});
