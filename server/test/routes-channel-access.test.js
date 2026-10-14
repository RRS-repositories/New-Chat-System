// Per-channel access through the real app on PGlite: Management or IT block a person from a channel;
// they are removed, cannot join or be added, are not put back by the Management-and-IT rule, and
// come back when allowed. General cannot be blocked.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createTestDb } from './pg-helper.js';
import { createChannel } from '../src/models/channels.model.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
// Users: 1 Meg Manager (Management), 2 Ann Agent, 3 Bob Sales, 5 Cy Sales. Added: 6 Ivy IT.
await db.query(`INSERT INTO users (email, full_name, role) VALUES ('ivy@x', 'Ivy IT', 'IT')`);
const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false };
const events = [];
const emit = {
  toChannel: (id, ev, p) => events.push({ to: 'channel', id, ev, p }),
  toUser: (id, ev, p) => events.push({ to: 'user', id, ev, p }),
  toSocket() {},
  toAll() {},
  userOfSocket: () => null,
  joinRoom() {},
  leaveRoom: (userId, channelId) => events.push({ to: 'leave', id: userId, channelId }),
};
const app = createApp({ config, db, emit });
after(() => close());
const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const as = (id) => ({
  get: (path) => request(app).get(`/api/chat${path}`).set('Authorization', auth(id)),
  post: (path, body = {}) => request(app).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body),
  put: (path, body = {}) => request(app).put(`/api/chat${path}`).set('Authorization', auth(id)).send(body),
});
const listed = async (userId) => (await as(userId).get('/channels')).body.channels.map((c) => c.id);
const general = async () => (await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`)).rows[0].id;

const sales = await createChannel(db, { displayName: 'Sales Floor', type: 'public', createdBy: 2, memberIds: [3] });

test('the channels list for a person: every channel, with "in it" and "blocked"', async () => {
  const r = await as(1).get('/admin/users/3/channels');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.channels.find((c) => c.id === sales.id);
  assert.deepEqual(
    { member: row.member, blocked: row.blocked, isGeneral: row.isGeneral },
    { member: true, blocked: false, isGeneral: false },
  );
  assert.ok(
    r.body.channels.find((c) => c.isGeneral),
    'General is listed (as not blockable)',
  );
  assert.equal((await as(2).get('/admin/users/3/channels')).status, 403, 'not for a plain member');
  assert.equal((await as(6).get('/admin/users/3/channels')).status, 200, 'IT may');
});

test('blocking removes the person now, tells them, and refuses joining and being added; allowing lets them back', async () => {
  events.length = 0;
  const r = await as(1).put(`/admin/users/3/channels/${sales.id}`, { allowed: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!(await listed(3)).includes(sales.id), 'Bob is out');
  assert.ok(events.some((e) => e.to === 'user' && e.id === 3 && e.ev === 'member_removed'));
  assert.ok(events.some((e) => e.to === 'leave' && e.id === 3));
  const join = await as(3).post(`/channels/${sales.id}/join`);
  assert.equal(join.status, 403);
  assert.equal(join.body.code, 'channel_blocked');
  const add = await as(2).post(`/channels/${sales.id}/members`, { userIds: [3] });
  assert.equal(add.status, 403);
  assert.equal(add.body.code, 'channel_blocked');
  assert.equal(r.body.channels.find((c) => c.id === sales.id).blocked, true);
  const audit = await db.query(
    `SELECT action FROM chat.audit_log WHERE action IN ('channel.block','channel.allow') ORDER BY created_at`,
  );
  assert.deepEqual(
    audit.rows.map((a) => a.action),
    ['channel.block'],
  );
  events.length = 0;
  const ok = await as(6).put(`/admin/users/3/channels/${sales.id}`, { allowed: true });
  assert.equal(ok.status, 200);
  assert.ok((await listed(3)).includes(sales.id), 'a tick puts Bob back in the channel');
  assert.equal(ok.body.channels.find((c) => c.id === sales.id).member, true);
  assert.ok(
    events.some((e) => e.to === 'user' && e.id === 3 && e.ev === 'member_added'),
    'and he is told',
  );
  assert.equal((await as(3).post(`/channels/${sales.id}/join`)).status, 200, 'joining again is harmless');
});

test('a blocked Management or IT person is not put back by the every-channel rule; General cannot be blocked', async () => {
  const priv = await createChannel(db, { displayName: 'Board', type: 'private', createdBy: 2, memberIds: [] });
  assert.ok((await listed(6)).includes(priv.id), 'Ivy (IT) is in it by the rule');
  assert.equal((await as(1).put(`/admin/users/6/channels/${priv.id}`, { allowed: false })).status, 200);
  assert.ok(!(await listed(6)).includes(priv.id), 'and stays out after her list loads again');
  assert.equal((await as(1).put(`/admin/users/6/channels/${priv.id}`, { allowed: true })).status, 200);
  assert.ok((await listed(6)).includes(priv.id), 'allowed again: the rule puts her back');
  const g = await as(1).put(`/admin/users/3/channels/${await general()}`, { allowed: false });
  assert.equal(g.status, 403);
  assert.equal(g.body.code, 'default_channel');
});
