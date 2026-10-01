// Communication restrictions against real Postgres (PGlite): direction, 'all', both-ways,
// channel pairs, the people-picker filter, validation and audit rows.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { addRestriction, removeRestriction, listRestrictions, isBlocked, blockedPairs, hiddenFromPicker } from '../src/repo/restrictions.js';

// Users: 1 Meg Manager (Management), 2 Ann Agent, 3 Bob Sales, 5 Cy Sales.
const MEG = 1, ANN = 2, BOB = 3, CY = 5;
let t, db;
beforeEach(async () => { t = await createTestDb(); db = t.db; });
afterEach(async () => { await t.close(); });

const audit = async (action) => (await db.query(`SELECT * FROM chat.audit_log WHERE action = $1 ORDER BY id`, [action])).rows;

test('dm restriction is one-way and dm-only', async () => {
  await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'dm', reason: 'complaint', restrictedBy: MEG });
  assert.equal(await isBlocked(db, { fromUserId: ANN, toUserId: BOB, kind: 'dm' }), true);
  assert.equal(await isBlocked(db, { fromUserId: BOB, toUserId: ANN, kind: 'dm' }), false, 'reverse direction is open');
  assert.equal(await isBlocked(db, { fromUserId: ANN, toUserId: BOB, kind: 'channel' }), false);
  assert.equal(await isBlocked(db, { fromUserId: ANN, toUserId: BOB, kind: 'call' }), false);
});

test("'all' covers dm, call and channel", async () => {
  await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'all', restrictedBy: MEG });
  for (const kind of ['dm', 'call', 'channel']) assert.equal(await isBlocked(db, { fromUserId: ANN, toUserId: BOB, kind }), true, kind);
  assert.deepEqual(await blockedPairs(db, { userIds: [ANN, BOB], kind: 'channel' }), [[ANN, BOB]]);
});

test('bothWays writes two rows; removing one leaves the other', async () => {
  const rows = await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'dm', reason: 'dispute', restrictedBy: MEG, bothWays: true });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.userId, r.targetUserId]).sort(), [[ANN, BOB], [BOB, ANN]]);
  assert.equal(await isBlocked(db, { fromUserId: BOB, toUserId: ANN, kind: 'dm' }), true);
  const annToBob = rows.find((r) => r.userId === ANN);
  assert.equal(await removeRestriction(db, { id: annToBob.id, actorId: MEG }), true);
  assert.equal(await isBlocked(db, { fromUserId: ANN, toUserId: BOB, kind: 'dm' }), false);
  assert.equal(await isBlocked(db, { fromUserId: BOB, toUserId: ANN, kind: 'dm' }), true, 'the reverse row stays');
  assert.equal((await listRestrictions(db)).length, 1);
  assert.equal(await removeRestriction(db, { id: annToBob.id, actorId: MEG }), false, 'already gone');
});

test('re-adding the same restriction updates the reason instead of duplicating', async () => {
  await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'dm', reason: 'first', restrictedBy: MEG });
  const [row] = await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'dm', reason: 'second', restrictedBy: MEG });
  assert.equal(row.reason, 'second');
  assert.equal((await listRestrictions(db)).length, 1);
});

test('blockedPairs: each pair once, sorted, either direction; dm rows do not count', async () => {
  await addRestriction(db, { userId: BOB, targetUserId: ANN, restriction: 'channel', restrictedBy: MEG, bothWays: true });
  await addRestriction(db, { userId: MEG, targetUserId: CY, restriction: 'dm', restrictedBy: MEG });
  assert.deepEqual(await blockedPairs(db, { userIds: [MEG, ANN, BOB, CY], kind: 'channel' }), [[ANN, BOB]]);
  assert.deepEqual(await blockedPairs(db, { userIds: [MEG, BOB, CY], kind: 'channel' }), [], 'pair needs both people present');
  assert.deepEqual(await blockedPairs(db, { userIds: [ANN], kind: 'channel' }), []);
});

test('blockedPairs with several kinds: dm and channel rows count (either direction), call rows never do', async () => {
  await addRestriction(db, { userId: BOB, targetUserId: ANN, restriction: 'dm', restrictedBy: MEG });
  await addRestriction(db, { userId: CY, targetUserId: MEG, restriction: 'channel', restrictedBy: MEG });
  await addRestriction(db, { userId: ANN, targetUserId: CY, restriction: 'call', restrictedBy: MEG });
  assert.deepEqual(await blockedPairs(db, { userIds: [MEG, ANN, BOB, CY], kind: ['dm'] }), [[ANN, BOB]]);
  assert.deepEqual(await blockedPairs(db, { userIds: [MEG, ANN, BOB, CY], kind: 'dm' }), [[ANN, BOB]], 'a single kind string still works');
  assert.deepEqual(await blockedPairs(db, { userIds: [MEG, ANN, BOB, CY], kind: ['channel', 'dm'] }), [[MEG, CY], [ANN, BOB]]);
  assert.deepEqual(await blockedPairs(db, { userIds: [ANN, CY], kind: ['channel', 'dm'] }), [], 'call-only is not a membership restriction');
  await addRestriction(db, { userId: CY, targetUserId: ANN, restriction: 'all', restrictedBy: MEG });
  assert.deepEqual(await blockedPairs(db, { userIds: [ANN, CY], kind: ['dm'] }), [[ANN, CY]], "'all' counts for dm");
});

test('hiddenFromPicker lists the dm/all targets of the caller only', async () => {
  await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'dm', restrictedBy: MEG });
  await addRestriction(db, { userId: ANN, targetUserId: CY, restriction: 'channel', restrictedBy: MEG });
  await addRestriction(db, { userId: MEG, targetUserId: ANN, restriction: 'all', restrictedBy: MEG });
  assert.deepEqual(await hiddenFromPicker(db, { forUserId: ANN }), [BOB]);
  assert.deepEqual(await hiddenFromPicker(db, { forUserId: BOB }), [], 'the target still sees the restricted person');
  assert.deepEqual(await hiddenFromPicker(db, { forUserId: MEG }), [ANN]);
});

test('addRestriction rejects self, unknown types and unknown users, writing nothing', async () => {
  await assert.rejects(addRestriction(db, { userId: ANN, targetUserId: ANN, restriction: 'dm', restrictedBy: MEG }), { code: 'self_restriction' });
  await assert.rejects(addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'email', restrictedBy: MEG }), { code: 'bad_restriction' });
  await assert.rejects(addRestriction(db, { userId: ANN, targetUserId: 999, restriction: 'dm', restrictedBy: MEG }), { code: 'unknown_user' });
  assert.equal((await listRestrictions(db)).length, 0);
  assert.equal((await audit('restriction.add')).length, 0);
});

test('a both-ways add whose SECOND insert fails rolls back the first row', async () => {
  // Pass everything through to PGlite, but fail the second restriction insert: the first row
  // (Ann→Bob) and its audit row are already written by then, so only a real ROLLBACK removes them.
  let inserts = 0;
  const flaky = { async query(sql, params) {
    if (/INSERT INTO chat\.communication_restrictions/.test(sql) && ++inserts === 2) throw new Error('boom on the reverse row');
    return db.query(sql, params);
  } };
  await assert.rejects(addRestriction(flaky, { userId: ANN, targetUserId: BOB, restriction: 'dm', reason: 'x', restrictedBy: MEG, bothWays: true }), /boom/);
  assert.equal(inserts, 2, 'the first insert ran before the failure');
  const { rows } = await db.query(
    `SELECT 1 FROM chat.communication_restrictions WHERE (user_id, target_user_id) IN (($1, $2), ($2, $1))`, [ANN, BOB]);
  assert.equal(rows.length, 0, 'no half-applied restriction');
  assert.equal((await audit('restriction.add')).length, 0, 'no orphan audit row');
  // The connection is usable again (no transaction left open).
  await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'dm', restrictedBy: MEG });
  assert.equal((await listRestrictions(db)).length, 1);
});

test('listRestrictions carries names, filters by either side, newest first', async () => {
  await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'dm', reason: 'r1', restrictedBy: MEG });
  await new Promise((r) => setTimeout(r, 5));
  await addRestriction(db, { userId: CY, targetUserId: ANN, restriction: 'all', reason: 'r2', restrictedBy: MEG });
  const all = await listRestrictions(db);
  assert.equal(all.length, 2);
  assert.equal(all[0].userName, 'Cy Sales', 'newest first');
  assert.equal(all[1].userName, 'Ann Agent');
  assert.equal(all[1].targetName, 'Bob Sales');
  assert.equal(all[1].restrictedByName, 'Meg Manager');
  assert.equal(all[1].reason, 'r1');
  assert.equal((await listRestrictions(db, { userId: ANN })).length, 2, 'both directions');
  assert.deepEqual((await listRestrictions(db, { userId: BOB })).map((r) => r.targetUserId), [BOB]);
  assert.equal((await listRestrictions(db, { userId: MEG })).length, 0);
});

test('add and remove write audit rows with the reason', async () => {
  const rows = await addRestriction(db, { userId: ANN, targetUserId: BOB, restriction: 'channel', reason: 'HR case', restrictedBy: MEG, bothWays: true });
  const adds = await audit('restriction.add');
  assert.equal(adds.length, 2);
  assert.equal(adds[0].actor_id, MEG);
  assert.equal(adds[0].target_type, 'restriction');
  assert.deepEqual(adds.map((a) => a.target_id).sort(), rows.map((r) => r.id).sort());
  assert.deepEqual(adds[0].detail, { userId: ANN, targetUserId: BOB, restriction: 'channel', reason: 'HR case', bothWays: true });
  await removeRestriction(db, { id: rows[0].id, actorId: MEG });
  const [rm] = await audit('restriction.remove');
  assert.equal(rm.target_id, rows[0].id);
  assert.equal(rm.detail.reason, 'HR case');
});
