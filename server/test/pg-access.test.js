// Admin panel: bulk allow/block of who a person may contact, on real Postgres (PGlite).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createTestDb } from './pg-helper.js';
import { setAccess, listAdminUsers, listRestrictions, blockedKinds, rowsFor, nextBlocked, isBlocked } from '../src/repo/restrictions.js';
import { createAdminRoutes } from '../src/routes/admin.js';

let t; let db;
before(async () => { t = await createTestDb(); db = t.db; });
after(async () => { await t.close(); });
const rowsOf = async (from, to) => (await db.query(`SELECT restriction FROM chat.communication_restrictions WHERE user_id = $1 AND target_user_id = $2 ORDER BY restriction`, [from, to])).rows.map((r) => r.restriction);
const clear = () => db.query(`DELETE FROM chat.communication_restrictions`);

test('kinds: all three blocked is stored as one "all" row; partial sets as one row each', () => {
  assert.deepEqual(rowsFor(new Set(['dm', 'call', 'channel'])), ['all']);
  assert.deepEqual(rowsFor(new Set(['dm', 'call'])), ['dm', 'call']);
  assert.deepEqual([...blockedKinds(['all'])].sort(), ['call', 'channel', 'dm']);
  assert.deepEqual([...nextBlocked(blockedKinds(['all']), 'call', true)].sort(), ['channel', 'dm']);
  assert.deepEqual([...nextBlocked(new Set(), 'all', false)].sort(), ['call', 'channel', 'dm']);
});

test('block everything for several people at once, one way', async () => {
  await clear();
  const r = await setAccess(db, { userId: 2, targetUserIds: [3, 5], kind: 'all', allowed: false, actorId: 1 });
  assert.equal(r.changed, 2);
  assert.deepEqual(await rowsOf(2, 3), ['all']); assert.deepEqual(await rowsOf(2, 5), ['all']);
  assert.deepEqual(await rowsOf(3, 2), [], 'the other direction is untouched');
  assert.equal(await isBlocked(db, { fromUserId: 2, toUserId: 3, kind: 'dm' }), true);
  assert.equal(await isBlocked(db, { fromUserId: 3, toUserId: 2, kind: 'dm' }), false);
});

test('allowing one kind out of "all" leaves the other two blocked', async () => {
  await clear();
  await setAccess(db, { userId: 2, targetUserIds: [3], kind: 'all', allowed: false, actorId: 1 });
  await setAccess(db, { userId: 2, targetUserIds: [3], kind: 'call', allowed: true, actorId: 1 });
  assert.deepEqual(await rowsOf(2, 3), ['channel', 'dm']);
  await setAccess(db, { userId: 2, targetUserIds: [3], kind: 'call', allowed: false, actorId: 1 });
  assert.deepEqual(await rowsOf(2, 3), ['all'], 'blocking the last kind collapses back to one row');
});

test('both ways applies to each direction; allow-all removes every row for the pairs', async () => {
  await clear();
  await setAccess(db, { userId: 2, targetUserIds: [3, 5], kind: 'dm', allowed: false, bothWays: true, actorId: 1 });
  assert.deepEqual(await rowsOf(2, 3), ['dm']); assert.deepEqual(await rowsOf(3, 2), ['dm']); assert.deepEqual(await rowsOf(5, 2), ['dm']);
  const r = await setAccess(db, { userId: 2, targetUserIds: [3, 5], kind: 'all', allowed: true, bothWays: true, actorId: 1 });
  assert.equal(r.changed, 4);
  assert.equal((await listRestrictions(db, { userId: 2 })).length, 0);
});

test('no-op changes write nothing; bad input is refused', async () => {
  await clear();
  assert.equal((await setAccess(db, { userId: 2, targetUserIds: [3], kind: 'dm', allowed: true, actorId: 1 })).changed, 0);
  await assert.rejects(setAccess(db, { userId: 2, targetUserIds: [2], kind: 'dm', allowed: false, actorId: 1 }), /at least one person/);
  await assert.rejects(setAccess(db, { userId: 2, targetUserIds: [3], kind: 'video', allowed: false, actorId: 1 }), /kind must be/);
  await assert.rejects(setAccess(db, { userId: 2, targetUserIds: [999], kind: 'dm', allowed: false, actorId: 1 }), /User not found/);
});

test('the people list: only active people, chat on for Management, block counts per person', async () => {
  await clear();
  await setAccess(db, { userId: 2, targetUserIds: [3, 5], kind: 'dm', allowed: false, actorId: 1 });
  const users = await listAdminUsers(db);
  assert.ok(!users.some((u) => u.id === 4), 'the inactive person is not listed');
  const meg = users.find((u) => u.id === 1), ann = users.find((u) => u.id === 2), bob = users.find((u) => u.id === 3);
  assert.equal(meg.chatEnabled, true); assert.equal(ann.chatEnabled, false);
  assert.equal(ann.blockedFrom, 2); assert.equal(bob.blockedBy, 1); assert.equal(bob.blockedFrom, 0);
});

test('routes: Management only; people list carries online; bulk access returns the person\'s restrictions', async () => {
  await clear();
  const app = (role) => { const a = express(); a.use(express.json()); a.use((req, _res, next) => { req.user = { id: 1, role }; next(); }); a.use('/admin', createAdminRoutes({ db, presence: { isConnected: (id) => id === 2 } })); return a; };
  assert.equal((await request(app('Sales')).get('/admin/users')).status, 403);
  const list = await request(app('Management')).get('/admin/users');
  assert.equal(list.status, 200); assert.equal(list.body.users.find((u) => u.id === 2).online, true); assert.equal(list.body.users.find((u) => u.id === 3).online, false);
  const put = await request(app('Management')).put('/admin/users/2/access').send({ targetUserIds: [3], kind: 'all', allowed: false, bothWays: true });
  assert.equal(put.status, 200); assert.equal(put.body.changed, 2); assert.equal(put.body.restrictions.length, 2);
  assert.equal((await request(app('Management')).put('/admin/users/2/access').send({ targetUserIds: [3], kind: 'nope', allowed: false })).status, 400);
});
