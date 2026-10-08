// Channel housekeeping through the real app on PGlite: rename, leave and archive.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createCallService } from '../src/services/calls/call.service.js';
import { createTestDb } from './pg-helper.js';
import { createChannel, openDm } from '../src/models/channels.model.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
// Users from the helper: 1 Meg Manager (Management), 2 Ann Agent, 3 Bob Sales, 5 Cy Sales.
const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false };
const events = [];
const emit = {
  toChannel: (id, ev, p) => events.push({ to: 'channel', id, ev, p }),
  toUser: (id, ev, p) => events.push({ to: 'user', id, ev, p }),
  toSocket() {},
  toAll() {},
  userOfSocket: (s) => ({ s1: 1, s2: 2, s3: 3 })[s] ?? null,
  joinRoom() {},
  leaveRoom: (userId, channelId) => events.push({ to: 'leave', id: userId, channelId }),
};
const calls = createCallService({ db, emit, notifier: {}, config });
const app = createApp({ config, db, emit, calls });
after(() => {
  calls.close();
  return close();
});

const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const as = (id) => ({
  get: (path) => request(app).get(`/api/chat${path}`).set('Authorization', auth(id)),
  post: (path, body = {}) => request(app).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body),
  patch: (path, body = {}) => request(app).patch(`/api/chat${path}`).set('Authorization', auth(id)).send(body),
  del: (path) => request(app).delete(`/api/chat${path}`).set('Authorization', auth(id)),
});
const isErr = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.code, code, JSON.stringify(r.body));
};
const ok = (r) => assert.equal(r.status, 200, JSON.stringify(r.body));
const since = (mark, ev) => events.slice(mark).filter((e) => e.ev === ev);
const listed = async (userId) => (await as(userId).get('/channels')).body.channels.map((c) => c.id);
const general = async () => (await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`)).rows[0].id;

let seq = 0;
/** A private channel owned by Ann (2), with Bob (3) and the named others as plain members. */
const room = async (others = []) =>
  (
    await createChannel(db, {
      name: `hk-${++seq}`,
      displayName: `Room ${seq}`,
      type: 'private',
      createdBy: 2,
      memberIds: [3, ...others],
    })
  ).id;

// ---- rename ------------------------------------------------------------------

test('the channel owner renames it and changes its purpose; everyone in it is told', async () => {
  const id = await room();
  const mark = events.length;
  const r = await as(2).patch(`/channels/${id}`, { displayName: '  Complaints team  ', purpose: 'Open complaints' });
  ok(r);
  assert.equal(r.body.channel.displayName, 'Complaints team');
  assert.equal(r.body.channel.purpose, 'Open complaints');
  assert.deepEqual(
    since(mark, 'channel_updated').map((e) => [e.to, e.id]),
    [['channel', id]],
  );
  const seen = (await as(3).get('/channels')).body.channels.find((c) => c.id === id);
  assert.equal(seen.displayName, 'Complaints team');
  assert.equal(seen.purpose, 'Open complaints');
});

test('only the purpose, or only the name, can be changed', async () => {
  const id = await room();
  ok(await as(2).patch(`/channels/${id}`, { purpose: 'Just the purpose' }));
  let channel = (await as(2).get(`/channels/${id}`)).body.channel;
  assert.equal(channel.purpose, 'Just the purpose');
  assert.match(channel.displayName, /^Room /);
  ok(await as(2).patch(`/channels/${id}`, { displayName: 'Just the name' }));
  channel = (await as(2).get(`/channels/${id}`)).body.channel;
  assert.equal(channel.displayName, 'Just the name');
  assert.equal(channel.purpose, 'Just the purpose');
});

test('who may rename: the owner and Management in the channel; not a plain member, not an outsider', async () => {
  const id = await room([1]);
  isErr(await as(3).patch(`/channels/${id}`, { displayName: 'Bob was here' }), 403, 'forbidden');
  isErr(await as(5).patch(`/channels/${id}`, { displayName: 'Cy was here' }), 403, 'not_member');
  ok(await as(1).patch(`/channels/${id}`, { displayName: 'Renamed by a manager' }));
});

test('a bad name or purpose is refused, and a direct message cannot be renamed', async () => {
  const id = await room();
  isErr(await as(2).patch(`/channels/${id}`, { displayName: '   ' }), 400, 'bad_name');
  isErr(await as(2).patch(`/channels/${id}`, { displayName: 'x'.repeat(81) }), 400, 'bad_name');
  isErr(await as(2).patch(`/channels/${id}`, { purpose: 'x'.repeat(251) }), 400, 'bad_purpose');
  isErr(await as(2).patch(`/channels/${id}`, {}), 400, 'nothing_to_change');
  const dm = await openDm(db, 2, 3);
  isErr(await as(2).patch(`/channels/${dm.id}`, { displayName: 'Us' }), 403, 'dm_fixed');
});

// ---- leave -------------------------------------------------------------------

test('a member leaves a channel: it is gone from their list and the others are told', async () => {
  const id = await room();
  const mark = events.length;
  ok(await as(3).del(`/channels/${id}/members/3`));
  assert.ok(!(await listed(3)).includes(id));
  assert.ok((await listed(2)).includes(id), 'the others still have it');
  assert.equal(since(mark, 'member_removed').length, 2, 'the channel and the leaver');
  isErr(await as(3).get(`/channels/${id}/messages`), 403, 'not_member');
});

test('nobody leaves General, and nobody leaves a direct message', async () => {
  isErr(await as(3).del(`/channels/${await general()}/members/3`), 403, 'default_channel');
  const dm = await openDm(db, 2, 3);
  isErr(await as(3).del(`/channels/${dm.id}/members/3`), 403, 'dm_fixed');
});

test('when the last person leaves a private channel it is archived, not left as an orphan', async () => {
  const id = await room();
  ok(await as(3).del(`/channels/${id}/members/3`));
  ok(await as(2).del(`/channels/${id}/members/2`));
  const { rows } = await db.query(`SELECT archived_at FROM chat.channels WHERE id = $1`, [id]);
  assert.ok(rows[0].archived_at, 'archived');
});

test('a public channel that everyone has left stays, so people can join it again', async () => {
  const channel = await createChannel(db, { name: 'hk-pub', displayName: 'HK Public', type: 'public', createdBy: 2 });
  ok(await as(2).del(`/channels/${channel.id}/members/2`));
  const { rows } = await db.query(`SELECT archived_at FROM chat.channels WHERE id = $1`, [channel.id]);
  assert.equal(rows[0].archived_at, null);
});

// ---- archive -----------------------------------------------------------------

test('the owner archives a channel: it disappears for every member, who are told, and nothing more can be read or posted', async () => {
  const id = await room([5]);
  assert.equal((await as(3).post(`/channels/${id}/messages`, { content: 'before' })).status, 201);
  const mark = events.length;
  ok(await as(2).post(`/channels/${id}/archive`));
  assert.deepEqual(
    since(mark, 'channel_archived').map((e) => [e.to, e.id, e.p.channel_id]),
    [['channel', id, id]],
  );
  for (const userId of [2, 3, 5]) assert.ok(!(await listed(userId)).includes(id), `gone for ${userId}`);
  isErr(await as(3).get(`/channels/${id}/messages`), 403, 'not_member');
  isErr(await as(3).post(`/channels/${id}/messages`, { content: 'after' }), 403, 'not_member');
  isErr(await as(2).post(`/channels/${id}/calls`, { socketId: 's2' }), 403, 'not_member');
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM chat.messages WHERE channel_id = $1`, [id]);
  assert.equal(rows[0].n, 1, 'the messages are kept in the database');
  const audit = await db.query(
    `SELECT actor_id FROM chat.audit_log WHERE action = 'channel.archive' AND target_id = $1`,
    [id],
  );
  assert.equal(audit.rows[0]?.actor_id, 2, 'who archived it is recorded');
});

test('who may archive: the owner and Management in the channel; not a plain member', async () => {
  const id = await room([1]);
  isErr(await as(3).post(`/channels/${id}/archive`), 403, 'forbidden');
  isErr(await as(5).post(`/channels/${id}/archive`), 403, 'not_member');
  ok(await as(1).post(`/channels/${id}/archive`));
  isErr(await as(1).post(`/channels/${id}/archive`), 403, 'not_member');
});

test('General and direct messages cannot be archived', async () => {
  isErr(await as(1).post(`/channels/${await general()}/archive`), 403, 'default_channel');
  const dm = await openDm(db, 1, 2);
  isErr(await as(1).post(`/channels/${dm.id}/archive`), 403, 'dm_fixed');
});

test('a channel with a call going on is not archived under the people in it', async () => {
  const id = await room();
  const started = await as(2).post(`/channels/${id}/calls`, { socketId: 's2' });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  isErr(await as(2).post(`/channels/${id}/archive`), 409, 'call_in_progress');
  ok(await as(2).post(`/calls/${started.body.call.id}/leave`));
  ok(await as(2).post(`/channels/${id}/archive`));
});

// ---- delete ------------------------------------------------------------------

test('Management or IT delete a channel for good: rows gone, members told, audit written', async () => {
  await db.query(`UPDATE users SET role = 'IT' WHERE id = 5`);
  const id = await room([1, 5]);
  const m = (
    await db.query(`INSERT INTO chat.messages (channel_id, user_id, content) VALUES ($1, 2, 'root') RETURNING id`, [id])
  ).rows[0].id;
  await db.query(
    `INSERT INTO chat.messages (channel_id, user_id, content, thread_id, reply_to_id) VALUES ($1, 3, 'reply', $2, $2)`,
    [id, m],
  );
  await db.query(`INSERT INTO chat.reactions (message_id, user_id, emoji) VALUES ($1, 3, '👍')`, [m]);
  await db.query(`INSERT INTO chat.mentions (message_id, channel_id, user_id) VALUES ($1, $2, 3)`, [m, id]);
  await db.query(
    `INSERT INTO chat.files (message_id, channel_id, user_id, filename, mime_type, size_bytes, file_path) VALUES ($1, $2, 2, 'a.txt', 'text/plain', 1, 'x/a.txt')`,
    [m, id],
  );
  // A plain member may not, even the owner.
  isErr(await as(2).del(`/channels/${id}`), 403, 'forbidden');
  isErr(await as(3).del(`/channels/${id}`), 403, 'forbidden');
  const mark = events.length;
  const r = await as(5).del(`/channels/${id}`);
  ok(r);
  assert.deepEqual(r.body.deleted, { messages: 2, files: 1 });
  for (const t of [
    'channels WHERE id',
    'messages WHERE channel_id',
    'files WHERE channel_id',
    'mentions WHERE channel_id',
    'channel_members WHERE channel_id',
  ])
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM chat.${t} = $1`, [id])).rows[0].n, 0, t);
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM chat.reactions WHERE message_id = $1`, [m])).rows[0].n,
    0,
  );
  const told = since(mark, 'channel_deleted');
  assert.ok(told.some((e) => e.to === 'channel' && e.id === id));
  assert.deepEqual(
    told
      .filter((e) => e.to === 'user')
      .map((e) => e.id)
      .sort(),
    [1, 2, 3, 5],
  );
  assert.ok(!(await listed(2)).includes(id));
  const audit = await db.query(
    `SELECT actor_id, detail FROM chat.audit_log WHERE action = 'channel.delete' AND target_id = $1`,
    [id],
  );
  assert.equal(audit.rows[0].actor_id, 5);
  assert.equal(audit.rows[0].detail.messages, 2);
  isErr(await as(1).del(`/channels/${id}`), 404, 'not_found');
});

test('General and direct messages cannot be deleted; a live call blocks it', async () => {
  isErr(await as(1).del(`/channels/${await general()}`), 403, 'default_channel');
  const dm = await openDm(db, 1, 3);
  isErr(await as(1).del(`/channels/${dm.id}`), 403, 'dm_fixed');
  const id = await room([1]);
  await db.query(`INSERT INTO chat.calls (channel_id, initiated_by, type, status) VALUES ($1, 2, 'voice', 'active')`, [
    id,
  ]);
  isErr(await as(1).del(`/channels/${id}`), 409, 'call_in_progress');
  await db.query(`UPDATE chat.calls SET status = 'ended', ended_at = now() WHERE channel_id = $1`, [id]);
  ok(await as(1).del(`/channels/${id}`));
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM chat.calls WHERE channel_id = $1`, [id])).rows[0].n,
    0,
    'old calls go too',
  );
});
