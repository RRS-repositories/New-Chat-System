import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../src/middleware/auth.js';
import { createChannelRoutes } from '../src/routes/channels.routes.js';
import { createMessageRoutes } from '../src/routes/messages.routes.js';
import { createUserRoutes } from '../src/routes/users.routes.js';
import { createAuthRoutes } from '../src/routes/auth.routes.js';
import { perUserLimiter } from '../src/middleware/rate-limit.js';
import { createSearchRoutes } from '../src/routes/search.routes.js';

const secret = 's'.repeat(40), aud = 'rrs-crm-session';
const token = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const user = { id: 7, email: 'a@b.c', full_name: 'Ann', role: 'cs_agent', is_approved: true, is_active: true, sessions_valid_from: null };

function makeDb({ member = true, rows = {} } = {}) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    if (/LEFT JOIN account_locks/.test(sql)) return { rows: [user], rowCount: 1 };
    if (/FROM chat\.channel_members WHERE channel_id = \$1 AND user_id = \$2/.test(sql)) return { rows: member ? [{ ok: 1 }] : [], rowCount: member ? 1 : 0 };
    for (const [re, r] of Object.entries(rows)) if (new RegExp(re).test(sql)) return { rows: r, rowCount: r.length };
    return { rows: [], rowCount: 0 };
  } };
}
function app(db, emitted = []) {
  const emit = { toChannel: (c, e, p) => emitted.push({ c, e, p }), toUser: (u, e, p) => emitted.push({ u, e, p }), joinRoom: (u, c) => emitted.push({ join: [u, c] }), leaveRoom: (u, c) => emitted.push({ leave: [u, c] }) };
  const a = express(); a.use(express.json());
  const auth = requireAuth({ db, secret, aud });
  a.use('/api/chat/channels', auth, createChannelRoutes({ db, emit }));
  a.use('/api/chat', auth, createMessageRoutes({ db, emit, limiter: perUserLimiter({ windowMs: 1000, max: 1 }) }));
  a.use('/api/chat/users', auth, createUserRoutes({ db }));
  return a;
}
const msgRow = { id: 'm1', channel_id: 'c1', user_id: 7, user_name: 'Ann', content: 'hi', type: 'message', created_at: '2026-09-28T10:00:00.000Z', edited_at: null, reply_to_id: null, thread_id: null };

test('401 without a token on every chat route', async () => {
  const a = app(makeDb());
  for (const p of ['/api/chat/channels', '/api/chat/channels/c1/messages', '/api/chat/users']) {
    const r = await request(a).get(p); assert.equal(r.status, 401, p);
  }
});

test('GET /channels lists the caller’s channels', async () => {
  const db = makeDb({ rows: { 'FROM chat\\.channel_members m': [{ id: 'c1', name: 'general', display_name: 'General', type: 'public', unread_count: '0', member_count: '3' }] } });
  const r = await request(app(db)).get('/api/chat/channels').set('Authorization', token(7));
  assert.equal(r.status, 200); assert.equal(r.body.channels[0].displayName, 'General');
});

test('POST /channels/:id/messages: non-member gets 403 and nothing is emitted', async () => {
  const emitted = [];
  const r = await request(app(makeDb({ member: false }), emitted)).post('/api/chat/channels/c1/messages').set('Authorization', token(7)).send({ content: 'hi' });
  assert.equal(r.status, 403); assert.equal(emitted.length, 0);
});

test('POST /channels/:id/messages: member’s message is stored, returned and broadcast as new_message', async () => {
  const emitted = [];
  const db = makeDb({ rows: { 'INSERT INTO chat\\.messages|WHERE x\\.id = \\$1': [msgRow] } });
  const r = await request(app(db, emitted)).post('/api/chat/channels/c1/messages').set('Authorization', token(7)).send({ content: ' <b>hi</b> ' });
  assert.equal(r.status, 201); assert.equal(r.body.message.content, 'hi');
  assert.deepEqual(emitted[0], { c: 'c1', e: 'new_message', p: { message: r.body.message, channel_id: 'c1' } });
  const ins = db.calls.find((x) => /INSERT INTO chat\.messages/.test(x.sql)); assert.equal(ins.params[2], 'hi', 'sanitised before insert');
});

test('POST /channels/:id/messages: empty content is 400, second message within a second is 429', async () => {
  const db = makeDb({ rows: { 'INSERT INTO chat\\.messages|WHERE x\\.id = \\$1': [msgRow] } });
  const a = app(db);
  assert.equal((await request(a).post('/api/chat/channels/c1/messages').set('Authorization', token(7)).send({ content: '  ' })).status, 400);
  assert.equal((await request(a).post('/api/chat/channels/c1/messages').set('Authorization', token(7)).send({ content: 'x' })).status, 201);
  assert.equal((await request(a).post('/api/chat/channels/c1/messages').set('Authorization', token(7)).send({ content: 'y' })).status, 429);
});

test('POST /channels/dm refuses self and validates userId', async () => {
  const a = app(makeDb());
  assert.equal((await request(a).post('/api/chat/channels/dm').set('Authorization', token(7)).send({ userId: 7 })).status, 400);
  assert.equal((await request(a).post('/api/chat/channels/dm').set('Authorization', token(7)).send({ userId: 'abc' })).status, 400);
});

test('GET /users excludes the caller and inactive users (SQL shape)', async () => {
  const db = makeDb({ rows: { 'FROM public\\.users u WHERE': [{ id: 8, full_name: 'Bob', role: 'Sales' }] } });
  const r = await request(app(db)).get('/api/chat/users').set('Authorization', token(7));
  assert.equal(r.status, 200); assert.deepEqual(r.body.users, [{ id: 8, fullName: 'Bob', role: 'Sales' }]);
  const q = db.calls.find((x) => /FROM public\.users u WHERE/.test(x.sql));
  assert.ok(/is_approved = TRUE/.test(q.sql) && /is_active IS NOT FALSE/.test(q.sql) && /u\.id <> \$1/.test(q.sql));
});

test('POST /auth/login forwards to the CRM and returns its body and status', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { status: 200, async json() { return { success: true, token: 't', user: { id: 7 }, mattermostToken: 'mm' }; } }; };
  const a = express(); a.use(express.json()); a.use('/api/chat/auth', createAuthRoutes({ crmInternalUrl: 'http://127.0.0.1:5000', fetchImpl }));
  const r = await request(a).post('/api/chat/auth/login').send({ email: 'a@b.c', password: 'p' });
  assert.equal(r.status, 200); assert.equal(r.body.token, 't');
  assert.equal(seen[0].url, 'http://127.0.0.1:5000/api/auth/login');
  assert.equal(JSON.parse(seen[0].init.body).email, 'a@b.c');
  assert.ok(!('mattermostToken' in r.body));
});

test('GET /channels joins the caller to #general first (idempotent insert)', async () => {
  const db = makeDb();
  await request(app(db)).get('/api/chat/channels').set('Authorization', token(7));
  const q = db.calls.find((x) => /INSERT INTO chat\.channel_members[\s\S]*name = 'general'/.test(x.sql));
  assert.ok(q, 'ensureDefaultMembership ran'); assert.equal(q.params[0], 7);
});

test('POST /channels/:id/members: a DM cannot gain members; a room emits only to ids actually inserted and joins their rooms', async () => {
  const emitted = [];
  const dmDb = makeDb({ rows: { 'FROM chat\\.channels c WHERE c\\.id': [{ id: 'd1', name: 'dm:7:8', display_name: '', type: 'dm', member_count: '2' }] } });
  assert.equal((await request(app(dmDb, emitted)).post('/api/chat/channels/d1/members').set('Authorization', token(7)).send({ userIds: [9] })).status, 403);
  assert.equal(emitted.length, 0);
  const roomDb = makeDb({ rows: { 'FROM chat\\.channels c WHERE c\\.id': [{ id: 'c1', name: 'irl', display_name: 'IRL', type: 'private', member_count: '2' }], 'RETURNING user_id': [{ user_id: 9 }] } });
  const r = await request(app(roomDb, emitted)).post('/api/chat/channels/c1/members').set('Authorization', token(7)).send({ userIds: [9, 10] });
  assert.equal(r.status, 200); assert.equal(r.body.added, 1);
  assert.deepEqual(emitted.filter((e) => e.join).map((e) => e.join), [[9, 'c1']]);
  assert.deepEqual(emitted.filter((e) => e.u).map((e) => e.u), [9], 'user 10 was already a member: no event');
});

test('DELETE /channels/:id/members/:userId leaves the room for the removed user', async () => {
  const emitted = [];
  const db = makeDb({ rows: { 'FROM chat\\.channel_members m JOIN public\\.users u': [{ id: 7, full_name: 'Ann', role: 'cs_agent', channel_role: 'owner' }, { id: 9, full_name: 'Zed', role: 'Sales', channel_role: 'member' }] } });
  const r = await request(app(db, emitted)).delete('/api/chat/channels/c1/members/9').set('Authorization', token(7));
  assert.equal(r.status, 200);
  assert.deepEqual(emitted.find((e) => e.leave).leave, [9, 'c1']);
});

test('PATCH /messages/:id: a user no longer in the channel cannot edit their old message', async () => {
  const emitted = [];
  const db = makeDb({ member: false, rows: { 'WHERE x\\.id = \\$1': [msgRow] } });
  const r = await request(app(db, emitted)).patch('/api/chat/messages/m1').set('Authorization', token(7)).send({ content: 'edited' });
  assert.equal(r.status, 403); assert.equal(emitted.length, 0);
});

test('POST /auth/login forwards the real client IP and a timeout signal to the CRM', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init); return { status: 200, async json() { return { success: true, token: 't', user: { id: 7 } }; } }; };
  const a = express(); a.set('trust proxy', 1); a.use(express.json()); a.use('/api/chat/auth', createAuthRoutes({ crmInternalUrl: 'http://crm', fetchImpl }));
  await request(a).post('/api/chat/auth/login').set('CF-Connecting-IP', '203.0.113.9').set('X-Forwarded-For', '203.0.113.9, 10.0.0.1').send({ email: 'a', password: 'b' });
  assert.equal(seen[0].headers['CF-Connecting-IP'], '203.0.113.9');
  assert.equal(seen[0].headers['X-Forwarded-For'], '203.0.113.9');
  assert.ok(seen[0].signal, 'abort signal attached');
  const slow = express(); slow.use(express.json()); slow.use('/api/chat/auth', createAuthRoutes({ crmInternalUrl: 'http://crm', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }));
  assert.equal((await request(slow).post('/api/chat/auth/login').send({})).status, 503);
});

test('POST /channels/:id/messages accepts replyToId/threadId; GET /messages/:id/thread and ?around work', async () => {
  const emitted = [];
  const db = makeDb({ rows: { 'INSERT INTO chat\\.messages': [{ id: 'm1' }], 'WHERE x\\.id = \\$1': [{ ...msgRow, thread_id: 'root1' }], 'WHERE x\\.thread_id = \\$1': [msgRow], 'SELECT id, channel_id, thread_id FROM chat\\.messages WHERE id': [{ id: 'root1', channel_id: 'c1', thread_id: null }] } });
  const a = app(db, emitted);
  const r = await request(a).post('/api/chat/channels/c1/messages').set('Authorization', token(7)).send({ content: 'reply', replyToId: 'root1', threadId: 'root1' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.message.threadId, 'root1');
  assert.equal(emitted[0].p.message.threadId, 'root1');
  const t = await request(a).get('/api/chat/messages/root1/thread').set('Authorization', token(7));
  assert.equal(t.status, 200); assert.equal(t.body.root.id, 'm1'); assert.equal(t.body.replies.length, 1);
  const w = await request(a).get('/api/chat/channels/c1/messages?around=m1').set('Authorization', token(7));
  assert.equal(w.status, 200); assert.equal(w.body.target, 'm1');
});

test('POST /channels/:id/messages inserts mentions once and still emits exactly one new_message', async () => {
  const emitted = [];
  const db = makeDb({ rows: { 'INSERT INTO chat\\.messages|WHERE x\\.id = \\$1': [msgRow], 'FROM chat\\.channel_members m JOIN public\\.users u': [{ id: 7, full_name: 'Ann', role: 'cs_agent', channel_role: 'owner' }, { id: 9, full_name: 'Zed Zee', role: 'Sales', channel_role: 'member' }] } });
  const r = await request(app(db, emitted)).post('/api/chat/channels/c1/messages').set('Authorization', token(7)).send({ content: 'ping @Zed Zee and @all' });
  assert.equal(r.status, 201);
  const ins = db.calls.filter((x) => /INSERT INTO chat\.mentions/.test(x.sql));
  assert.equal(ins.length, 1);
  assert.equal(emitted.filter((e) => e.e === 'new_message').length, 1);
});

test('pin requires owner/admin/Management and emits message_pinned; reactions emit reaction_added/removed', async () => {
  const emitted = [];
  const base = { 'INSERT INTO chat\\.messages|WHERE x\\.id = \\$1': [msgRow], 'FROM chat\\.messages WHERE id = \\$1': [{ id: 'm1', channel_id: 'c1', pinned: false }], 'count\\(\\*\\)[\\s\\S]*pinned = true': [{ n: '0' }], 'UPDATE chat\\.messages SET pinned': [{ ...msgRow, pinned: true }] };
  const memberDb = makeDb({ rows: { ...base, 'FROM chat\\.channel_members m JOIN public\\.users u': [{ id: 7, full_name: 'Ann', role: 'cs_agent', channel_role: 'member' }] } });
  assert.equal((await request(app(memberDb, emitted)).post('/api/chat/messages/m1/pin').set('Authorization', token(7))).status, 403);
  const ownerDb = makeDb({ rows: { ...base, 'FROM chat\\.channel_members m JOIN public\\.users u': [{ id: 7, full_name: 'Ann', role: 'cs_agent', channel_role: 'owner' }] } });
  const r = await request(app(ownerDb, emitted)).post('/api/chat/messages/m1/pin').set('Authorization', token(7));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(emitted.at(-1), { c: 'c1', e: 'message_pinned', p: { message_id: 'm1', channel_id: 'c1', pinned_by: 7 } });
  const reactDb = makeDb({ rows: { ...base, 'INSERT INTO chat\\.reactions': [{ ok: 1 }], 'DELETE FROM chat\\.reactions': [{ ok: 1 }] } });
  const a = app(reactDb, emitted);
  assert.equal((await request(a).post('/api/chat/messages/m1/reactions').set('Authorization', token(7)).send({ emoji: '🎉' })).status, 200);
  assert.deepEqual(emitted.at(-1), { c: 'c1', e: 'reaction_added', p: { message_id: 'm1', channel_id: 'c1', emoji: '🎉', user_id: 7 } });
  assert.equal((await request(a).delete('/api/chat/messages/m1/reactions/' + encodeURIComponent('🎉')).set('Authorization', token(7))).status, 200);
  assert.equal(emitted.at(-1).e, 'reaction_removed');
});

test('GET /search requires q and clamps page', async () => {
  const db = makeDb({ rows: { 'plainto_tsquery': [] } });
  const a = express(); a.use(express.json()); a.use('/api/chat/search', requireAuth({ db, secret, aud }), createSearchRoutes({ db }));
  assert.equal((await request(a).get('/api/chat/search').set('Authorization', token(7))).status, 400);
  const r = await request(a).get('/api/chat/search?q=hello&page=-3').set('Authorization', token(7));
  assert.equal(r.status, 200); assert.deepEqual(r.body, { success: true, hits: [], page: 1, hasMore: false });
});

test('a reaction emoji containing % never causes a 500 (Express already decoded the param)', async () => {
  const db = makeDb({ rows: { 'INSERT INTO chat\.messages|WHERE x\.id = \$1': [msgRow] } });
  const r = await request(app(db)).delete('/api/chat/messages/m1/reactions/%25AB').set('Authorization', token(7));
  assert.ok(r.status < 500, `status ${r.status}`);
});
