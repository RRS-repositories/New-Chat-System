// Push subscription storage and notification-candidate SQL against real Postgres (PGlite).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import {
  saveSubscription, removeSubscription, deleteSubscriptionByEndpoint, subscriptionsForUsers,
  messageCandidates, callCandidates, MAX_SUBSCRIPTIONS_PER_USER,
} from '../src/models/push.model.js';

// Users: 1 Meg Manager, 2 Ann Agent, 3 Bob Sales, 4 Gone (inactive), 5 Cy Sales. #general = 1,2,3,5.
const MEG = 1, ANN = 2, BOB = 3, GONE = 4, CY = 5;
let t, db, general;
beforeEach(async () => {
  t = await createTestDb(); db = t.db;
  general = (await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`)).rows[0].id;
});
afterEach(async () => { await t.close(); });

const keys = (n = 1) => ({ p256dh: `p${n}`, auth: `a${n}` });
const ep = (n) => `https://push.example/${n}`;
const all = async () => (await db.query(`SELECT user_id, endpoint, keys, user_agent FROM chat.push_subscriptions ORDER BY endpoint`)).rows;

test('saveSubscription inserts, and re-saving an endpoint moves it to the caller with the new keys', async () => {
  await saveSubscription(db, { userId: ANN, endpoint: ep(1), keys: keys(1), userAgent: 'Firefox' });
  assert.deepEqual(await all(), [{ user_id: ANN, endpoint: ep(1), keys: keys(1), user_agent: 'Firefox' }]);
  await saveSubscription(db, { userId: BOB, endpoint: ep(1), keys: keys(2), userAgent: 'Chrome' });
  assert.deepEqual(await all(), [{ user_id: BOB, endpoint: ep(1), keys: keys(2), user_agent: 'Chrome' }]);
});

test(`at most ${10} subscriptions per user: the oldest are dropped`, async () => {
  assert.equal(MAX_SUBSCRIPTIONS_PER_USER, 10);
  for (let i = 1; i <= 12; i++) {
    await saveSubscription(db, { userId: ANN, endpoint: ep(String(i).padStart(2, '0')), keys: keys(i), userAgent: '' });
    await db.query(`UPDATE chat.push_subscriptions SET created_at = now() - make_interval(secs => $2) WHERE endpoint = $1`, [ep(String(i).padStart(2, '0')), 100 - i]);
  }
  await saveSubscription(db, { userId: BOB, endpoint: ep('bob'), keys: keys(), userAgent: '' });
  const annEndpoints = (await all()).filter((r) => r.user_id === ANN).map((r) => r.endpoint);
  // The cap runs on each save: after the 12th save, 01 and 02 are gone (the 11th save removed 01).
  assert.equal(annEndpoints.length, 10);
  assert.ok(!annEndpoints.includes(ep('01')) && !annEndpoints.includes(ep('02')));
  assert.ok(annEndpoints.includes(ep('12')));
  assert.equal((await all()).filter((r) => r.user_id === BOB).length, 1, 'other users untouched');
});

test('removeSubscription only removes the caller\'s own endpoint', async () => {
  await saveSubscription(db, { userId: ANN, endpoint: ep(1), keys: keys(), userAgent: '' });
  assert.equal(await removeSubscription(db, { userId: BOB, endpoint: ep(1) }), false);
  assert.equal((await all()).length, 1);
  assert.equal(await removeSubscription(db, { userId: ANN, endpoint: ep(1) }), true);
  assert.equal((await all()).length, 0);
});

test('subscriptionsForUsers and deleteSubscriptionByEndpoint', async () => {
  await saveSubscription(db, { userId: ANN, endpoint: ep(1), keys: keys(1), userAgent: '' });
  await saveSubscription(db, { userId: ANN, endpoint: ep(2), keys: keys(2), userAgent: '' });
  await saveSubscription(db, { userId: BOB, endpoint: ep(3), keys: keys(3), userAgent: '' });
  assert.deepEqual(await subscriptionsForUsers(db, []), []);
  const subs = (await subscriptionsForUsers(db, [ANN, CY])).sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  assert.deepEqual(subs, [{ userId: ANN, endpoint: ep(1), keys: keys(1) }, { userId: ANN, endpoint: ep(2), keys: keys(2) }]);
  await deleteSubscriptionByEndpoint(db, ep(1));
  assert.deepEqual((await subscriptionsForUsers(db, [ANN, BOB])).map((s) => s.endpoint).sort(), [ep(2), ep(3)]);
});

test('messageCandidates: the channel, and its active members except the sender with both prefs (desktop_notif defaults to mentions)', async () => {
  await db.query(`INSERT INTO chat.channel_members (channel_id, user_id) VALUES ($1, $2)`, [general, GONE]);
  await db.query(`UPDATE users SET is_approved = false WHERE id = $1`, [CY]);
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'nothing' WHERE channel_id = $1 AND user_id = $2`, [general, BOB]);
  await db.query(`INSERT INTO chat.user_preferences (user_id, desktop_notif) VALUES ($1, 'all')`, [ANN]);
  const r = await messageCandidates(db, { channelId: general, senderId: MEG });
  assert.deepEqual(r.channel, { id: general, type: 'public', displayName: 'General' });
  assert.deepEqual(r.members.sort((a, b) => a.userId - b.userId), [
    { userId: ANN, notifyPref: 'default', desktopNotif: 'all' },
    { userId: BOB, notifyPref: 'nothing', desktopNotif: 'mentions' },
  ]);
});

test('messageCandidates: a channel with nobody else still returns the channel; an unknown channel returns null', async () => {
  const { rows: [c] } = await db.query(`INSERT INTO chat.channels (name, display_name, type, created_by) VALUES ('solo', 'Solo', 'private', 1) RETURNING id`);
  await db.query(`INSERT INTO chat.channel_members (channel_id, user_id) VALUES ($1, 1)`, [c.id]);
  assert.deepEqual(await messageCandidates(db, { channelId: c.id, senderId: MEG }), { channel: { id: c.id, type: 'private', displayName: 'Solo' }, members: [] });
  assert.deepEqual(await messageCandidates(db, { channelId: '00000000-0000-4000-8000-000000000000', senderId: MEG }), { channel: null, members: [] });
});

test('callCandidates: only the given users who are active members, with both prefs', async () => {
  await db.query(`INSERT INTO chat.channel_members (channel_id, user_id) VALUES ($1, $2)`, [general, GONE]);
  await db.query(`INSERT INTO chat.user_preferences (user_id, desktop_notif) VALUES ($1, 'nothing')`, [CY]);
  const r = await callCandidates(db, { channelId: general, userIds: [ANN, CY, GONE, 99] });
  assert.deepEqual(r.sort((a, b) => a.userId - b.userId), [
    { userId: ANN, notifyPref: 'default', desktopNotif: 'mentions' },
    { userId: CY, notifyPref: 'default', desktopNotif: 'nothing' },
  ]);
  assert.deepEqual(await callCandidates(db, { channelId: general, userIds: [] }), []);
});

test('archived channel: messageCandidates and callCandidates return no recipients', async () => {
  await db.query(`UPDATE chat.channels SET archived_at = now() WHERE id = $1`, [general]);
  const r = await messageCandidates(db, { channelId: general, senderId: MEG });
  assert.deepEqual(r.members, []);
  assert.deepEqual(await callCandidates(db, { channelId: general, userIds: [ANN, BOB, CY] }), []);
});
