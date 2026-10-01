// Restriction routes and enforcement with the SQL-shape stub: Management-only admin routes,
// DM refusal (even for an existing DM), private-channel refusal before any insert, the
// public-channel short-circuit and the people-picker filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../src/middleware/auth.js';
import { createAdminRoutes } from '../src/routes/admin.routes.js';
import { createChannelRoutes } from '../src/routes/channels.routes.js';
import { createUserRoutes } from '../src/routes/users.routes.js';
import { makeDb, token, user, secret, aud } from './route-helper.js';
import { addRestriction } from '../src/models/restrictions.model.js';
import { createMessageRoutes } from '../src/routes/messages.routes.js';
import { createFileRoutes } from '../src/routes/files.routes.js';
import { perUserLimiter } from '../src/middleware/rate-limit.js';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const manager = { ...user, id: 1, full_name: 'Meg Manager', role: 'Management' };

function app(db) {
  const emit = { toChannel() {}, toUser() {}, joinRoom() {}, leaveRoom() {} };
  const a = express();
  a.use(express.json());
  const auth = requireAuth({ db, secret, aud });
  a.use('/api/chat/admin', auth, createAdminRoutes({ db }));
  a.use('/api/chat/channels', auth, createChannelRoutes({ db, emit }));
  a.use('/api/chat/users', auth, createUserRoutes({ db }));
  return a;
}
const R1 = '11111111-2222-4333-8444-555555555555',
  R9 = '99999999-2222-4333-8444-555555555555';
const restrictionRow = {
  id: R1,
  user_id: 2,
  target_user_id: 3,
  restriction: 'dm',
  reason: 'HR',
  restricted_by: 1,
  created_at: '2026-09-29T10:00:00.000Z',
  user_name: 'Ann',
  target_name: 'Bob',
  restricted_by_name: 'Meg Manager',
};
const touched = (db, re) => db.calls.some((c) => re.test(c.sql));

// A pg.Pool stand-in: the pool itself only answers the user-existence check and the final
// select; the transaction must run on the one client handed out by connect().
function poolStub({ failOn = null, rollbackThrows = false } = {}) {
  const poolCalls = [],
    clientCalls = [],
    releases = [];
  let n = 0;
  const client = {
    async query(sql) {
      const s = sql.trim();
      const tag =
        s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK'
          ? s
          : /INSERT INTO chat\.communication_restrictions/.test(s)
            ? 'insert'
            : /INSERT INTO chat\.audit_log/.test(s)
              ? 'audit'
              : s.slice(0, 30);
      clientCalls.push(tag);
      if (tag === 'ROLLBACK' && rollbackThrows) throw new Error('connection lost');
      if (tag === 'insert' && ++n === failOn) throw new Error('insert failed');
      if (tag === 'insert') return { rows: [{ id: n === 1 ? R1 : R9 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release(err) {
      releases.push(err);
    },
  };
  const pool = {
    async connect() {
      return client;
    },
    async query(sql) {
      poolCalls.push(sql);
      if (/SELECT id FROM public\.users WHERE id = ANY/.test(sql)) return { rows: [{ id: 2 }, { id: 3 }], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    },
  };
  return { pool, poolCalls, clientCalls, releases };
}
const both = { userId: 2, targetUserId: 3, restriction: 'dm', reason: 'HR', restrictedBy: 1, bothWays: true };

test('addRestriction on a pool: the whole transaction runs on one connect()ed client, released once', async () => {
  const s = poolStub();
  await addRestriction(s.pool, both);
  assert.deepEqual(s.clientCalls, ['BEGIN', 'insert', 'audit', 'insert', 'audit', 'COMMIT']);
  assert.deepEqual(s.releases, [undefined], 'exactly one release(), no error');
  assert.equal(
    s.poolCalls.some((q) => /BEGIN|COMMIT|INSERT/.test(q)),
    false,
    'nothing transactional on the pool',
  );
});

test('addRestriction on a pool: a failing insert rolls back on the same client and releases it once', async () => {
  const s = poolStub({ failOn: 1 });
  await assert.rejects(addRestriction(s.pool, both), /insert failed/);
  assert.deepEqual(s.clientCalls, ['BEGIN', 'insert', 'ROLLBACK']);
  assert.deepEqual(s.releases, [undefined]);
});

test('addRestriction on a pool: when ROLLBACK itself fails the client is released with the error (discarded)', async () => {
  const s = poolStub({ failOn: 2, rollbackThrows: true });
  await assert.rejects(addRestriction(s.pool, both), /insert failed/, 'the original error surfaces');
  assert.deepEqual(s.clientCalls, ['BEGIN', 'insert', 'audit', 'insert', 'ROLLBACK']);
  assert.equal(s.releases.length, 1);
  assert.match(String(s.releases[0]?.message), /connection lost/);
});

test('admin routes: 403 forbidden for a non-Management role, nothing queried', async () => {
  const db = makeDb();
  const a = app(db);
  for (const [method, path] of [
    ['get', '/api/chat/admin/restrictions'],
    ['post', '/api/chat/admin/restrictions'],
    ['delete', `/api/chat/admin/restrictions/${R1}`],
    ['get', '/api/chat/admin/restrictions/user/2'],
  ]) {
    const r = await request(a)
      [method](path)
      .set('Authorization', token(7))
      .send({ userId: 2, targetUserId: 3, restriction: 'dm' });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, 'forbidden');
  }
  assert.equal(touched(db, /communication_restrictions/), false);
});

test('GET /admin/restrictions lists for Management (optionally by user)', async () => {
  const db = makeDb({ userRow: manager, rows: { 'FROM chat\\.communication_restrictions r\\s': [restrictionRow] } });
  const r = await request(app(db))
    .get('/api/chat/admin/restrictions?userId=2')
    .set('Authorization', token(1, 'Management'));
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.restrictions[0].targetName, 'Bob');
  const q = db.calls.find((c) => /FROM chat\.communication_restrictions r\s/.test(c.sql));
  assert.deepEqual(q.params, [2]);
  const u = await request(app(db))
    .get('/api/chat/admin/restrictions/user/3')
    .set('Authorization', token(1, 'Management'));
  assert.equal(u.status, 200);
  assert.equal(u.body.restrictions.length, 1);
  assert.deepEqual(db.calls.filter((c) => /FROM chat\.communication_restrictions r\s/.test(c.sql)).at(-1).params, [3]);
});

test('POST /admin/restrictions creates (201) and audits; bad input is 400', async () => {
  const db = makeDb({
    userRow: manager,
    rows: {
      'SELECT id FROM public\\.users WHERE id = ANY': [{ id: 2 }, { id: 3 }],
      'INSERT INTO chat\\.communication_restrictions': [{ id: R1 }],
      'FROM chat\\.communication_restrictions r\\s': [restrictionRow],
    },
  });
  const r = await request(app(db))
    .post('/api/chat/admin/restrictions')
    .set('Authorization', token(1, 'Management'))
    .send({ userId: 2, targetUserId: 3, restriction: 'dm', reason: 'HR', bothWays: false });
  assert.equal(r.status, 201);
  assert.equal(r.body.restrictions[0].id, R1);
  const ins = db.calls.find((c) => /INSERT INTO chat\.communication_restrictions/.test(c.sql));
  assert.deepEqual(ins.params, [2, 3, 'dm', 'HR', 1], 'restricted_by is the caller');
  const aud = db.calls.find((c) => /INSERT INTO chat\.audit_log/.test(c.sql));
  assert.equal(aud.params[0], 1);
  assert.match(aud.params[2], /"reason":"HR"/);
  assert.ok(db.calls.findIndex((c) => c.sql === 'BEGIN') < db.calls.indexOf(ins));
  assert.ok(db.calls.some((c) => c.sql === 'COMMIT'));

  const bad = await request(app(db))
    .post('/api/chat/admin/restrictions')
    .set('Authorization', token(1, 'Management'))
    .send({ userId: 2, targetUserId: 2, restriction: 'dm' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'self_restriction');
});

test('DELETE /admin/restrictions/:id removes (200) or 404s', async () => {
  const db = makeDb({ userRow: manager, rows: { 'DELETE FROM chat\\.communication_restrictions': [restrictionRow] } });
  const r = await request(app(db))
    .delete(`/api/chat/admin/restrictions/${R1}`)
    .set('Authorization', token(1, 'Management'));
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.ok(db.calls.some((c) => /INSERT INTO chat\.audit_log/.test(c.sql) && /restriction\.remove/.test(c.sql)));
  const none = await request(app(makeDb({ userRow: manager })))
    .delete(`/api/chat/admin/restrictions/${R9}`)
    .set('Authorization', token(1, 'Management'));
  assert.equal(none.status, 404);
});

test('POST /channels/dm: 403 restricted when blocked, even if the DM already exists', async () => {
  const db = makeDb({
    rows: {
      'FROM chat\\.communication_restrictions\\s+WHERE user_id = \\$1 AND target_user_id': [{ blocked: 1 }],
      'INSERT INTO chat\\.channels': [{ id: 'dm1', name: 'dm:3:7', display_name: '', type: 'dm' }],
    },
  });
  const r = await request(app(db)).post('/api/chat/channels/dm').set('Authorization', token(7)).send({ userId: 3 });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'restricted');
  assert.equal(r.body.message, 'You cannot message this person');
  const q = db.calls.find((c) => /communication_restrictions/.test(c.sql));
  assert.deepEqual(q.params, [7, 3, 'dm']);
  assert.equal(touched(db, /INSERT INTO chat\.(channels|channel_members)/), false);
});

test('POST /channels/dm: allowed when not blocked', async () => {
  const db = makeDb({
    rows: { 'INSERT INTO chat\\.channels': [{ id: 'dm1', name: 'dm:3:7', display_name: '', type: 'dm' }] },
  });
  const r = await request(app(db)).post('/api/chat/channels/dm').set('Authorization', token(7)).send({ userId: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.channel.id, 'dm1');
});

const privateChannel = {
  'FROM chat\\.channels c WHERE c\\.id': [{ id: 'c1', name: 'hr', display_name: 'HR', type: 'private' }],
  'FROM chat\\.channel_members m JOIN public\\.users': [
    { id: 7, full_name: 'Ann', role: 'cs_agent', channel_role: 'owner' },
    { id: 3, full_name: 'Bob', role: 'Sales', channel_role: 'member' },
  ],
};

test('POST /channels/:id/members (private): blocked pair → 403 and no member insert', async () => {
  const db = makeDb({ rows: { ...privateChannel, 'LEAST\\(user_id, target_user_id\\)': [{ a: 3, b: 5 }] } });
  const r = await request(app(db))
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'restricted');
  assert.equal(r.body.message, 'Some of these people cannot share a private channel');
  const q = db.calls.find((c) => /LEAST\(user_id/.test(c.sql));
  assert.deepEqual([...q.params[0]].sort(), [3, 5, 7]);
  assert.equal(touched(db, /INSERT INTO chat\.channel_members/), false);
});

test('POST /channels/:id/members (private): no blocked pair → members added', async () => {
  const db = makeDb({ rows: { ...privateChannel, 'INSERT INTO chat\\.channel_members': [{ user_id: 5 }] } });
  const r = await request(app(db))
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 1);
});

test('POST /channels/:id/members (private): a pair already in the channel does not block a newcomer', async () => {
  const db = makeDb({
    rows: {
      ...privateChannel,
      'LEAST\\(user_id, target_user_id\\)': [{ a: 3, b: 7 }],
      'INSERT INTO chat\\.channel_members': [{ user_id: 5 }],
    },
  });
  const r = await request(app(db))
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 1);
});

test('POST /channels/:id/members (public): no restriction query at all', async () => {
  const db = makeDb({
    rows: {
      'FROM chat\\.channels c WHERE c\\.id': [{ id: 'c1', name: 'general', display_name: 'General', type: 'public' }],
      'INSERT INTO chat\\.channel_members': [{ user_id: 5 }],
    },
  });
  const r = await request(app(db))
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(r.status, 200);
  assert.equal(touched(db, /communication_restrictions/), false);
});

test('POST /channels (private create): blocked pair among creator + members → 403, nothing created', async () => {
  const db = makeDb({ rows: { 'LEAST\\(user_id, target_user_id\\)': [{ a: 3, b: 5 }] } });
  const r = await request(app(db))
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'Team', type: 'private', memberIds: [3, 5] });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'restricted');
  assert.deepEqual([...db.calls.find((c) => /LEAST\(user_id/.test(c.sql)).params[0]].sort(), [3, 5, 7]);
  assert.equal(touched(db, /INSERT INTO chat\.channels/), false);
});

test('POST /channels (public create): no restriction query', async () => {
  const db = makeDb({
    rows: { 'INSERT INTO chat\\.channels': [{ id: 'c2', name: 'team', display_name: 'Team', type: 'public' }] },
  });
  const r = await request(app(db))
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'Team', type: 'public', memberIds: [3, 5] });
  assert.equal(r.status, 201);
  assert.equal(touched(db, /communication_restrictions/), false);
});

test('GET /users omits people the caller may not DM', async () => {
  const db = makeDb({
    rows: {
      'SELECT DISTINCT target_user_id': [{ target_user_id: 3 }],
      'FROM public\\.users u WHERE u\\.is_approved': [
        { id: 1, full_name: 'Meg', role: 'Management' },
        { id: 3, full_name: 'Bob', role: 'Sales' },
        { id: 5, full_name: 'Cy', role: 'Sales' },
      ],
    },
  });
  const r = await request(app(db)).get('/api/chat/users').set('Authorization', token(7));
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.users.map((u) => u.id),
    [1, 5],
  );
  assert.deepEqual(db.calls.find((c) => /SELECT DISTINCT target_user_id/.test(c.sql)).params, [7]);
});

// --- Posting into a DM that already exists (the dm/all restriction also stops the conversation) ---
const DM_OTHER = 'AS dm_other_id';
const BLOCK_Q = 'FROM chat\\.communication_restrictions\\s+WHERE user_id = \\$1 AND target_user_id';
function msgApp(db) {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'chat-rr-'));
  const emit = { toChannel() {}, toUser() {}, joinRoom() {}, leaveRoom() {} };
  const a = express();
  a.use(express.json());
  const auth = requireAuth({ db, secret, aud });
  a.use('/api/chat', auth, createMessageRoutes({ db, emit, limiter: perUserLimiter({ windowMs: 1000, max: 100 }) }));
  a.use(
    '/api/chat',
    auth,
    createFileRoutes({ db, emit, uploadsDir, limiter: perUserLimiter({ windowMs: 1000, max: 100 }) }),
  );
  return { a, uploadsDir };
}
const msgRow = {
  id: 'm1',
  channel_id: 'd1',
  user_id: 7,
  user_name: 'Ann',
  content: 'hi',
  type: 'message',
  created_at: '2026-09-29T10:00:00.000Z',
  edited_at: null,
  reply_to_id: null,
  thread_id: null,
};

test('POST /channels/:id/messages into a DM: the restricted sender gets 403 restricted and nothing is stored', async () => {
  const db = makeDb({ rows: { [DM_OTHER]: [{ dm_other_id: 3 }], [BLOCK_Q]: [{ blocked: 1 }] } });
  const { a, uploadsDir } = msgApp(db);
  try {
    const r = await request(a)
      .post('/api/chat/channels/d1/messages')
      .set('Authorization', token(7))
      .send({ content: 'hi' });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { success: false, code: 'restricted', message: 'You cannot message this person' });
    assert.deepEqual(db.calls.find((c) => c.sql.includes(DM_OTHER)).params, ['d1', 7]);
    assert.deepEqual(db.calls.find((c) => new RegExp(BLOCK_Q).test(c.sql)).params, [7, 3, 'dm']);
    assert.equal(touched(db, /INSERT INTO chat\.messages/), false);
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('POST /channels/:id/messages into a DM: the other direction (not restricted) posts normally', async () => {
  const db = makeDb({
    rows: { [DM_OTHER]: [{ dm_other_id: 2 }], 'INSERT INTO chat\\.messages|WHERE x\\.id = \\$1': [msgRow] },
  });
  const { a, uploadsDir } = msgApp(db);
  try {
    const r = await request(a)
      .post('/api/chat/channels/d1/messages')
      .set('Authorization', token(7))
      .send({ content: 'hi' });
    assert.equal(r.status, 201);
    assert.deepEqual(db.calls.find((c) => new RegExp(BLOCK_Q).test(c.sql)).params, [7, 2, 'dm']);
    assert.ok(touched(db, /INSERT INTO chat\.messages/));
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('POST /channels/:id/messages into a non-DM channel: no restriction check at all', async () => {
  const db = makeDb({ rows: { 'INSERT INTO chat\\.messages|WHERE x\\.id = \\$1': [msgRow] } });
  const { a, uploadsDir } = msgApp(db);
  try {
    const r = await request(a)
      .post('/api/chat/channels/c1/messages')
      .set('Authorization', token(7))
      .send({ content: 'hi' });
    assert.equal(r.status, 201);
    assert.equal(touched(db, /communication_restrictions/), false);
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('POST /channels/:id/upload into a DM: the restricted sender gets 403 restricted, no message and no file on disk', async () => {
  const db = makeDb({ rows: { [DM_OTHER]: [{ dm_other_id: 3 }], [BLOCK_Q]: [{ blocked: 1 }] } });
  const { a, uploadsDir } = msgApp(db);
  try {
    const r = await request(a)
      .post('/api/chat/channels/d1/upload')
      .set('Authorization', token(7))
      .attach('files', Buffer.from('%PDF-1.4 test'), { filename: 'a.pdf', contentType: 'application/pdf' });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'restricted');
    assert.equal(touched(db, /INSERT INTO chat\.(messages|files)/), false);
    assert.deepEqual(readdirSync(uploadsDir), []);
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

// --- dm/all restrictions also cover private and group_dm membership ---
// The stub answers blockedPairs' LEAST(...) query from `restrictions` ([from, to, kind]) using
// the query's own params ($1 user ids, $2 kinds), so the route's choice of ids and kinds matters.
function restrictedDb(restrictions, rows = {}) {
  const db = makeDb({ rows });
  const base = db.query.bind(db);
  db.query = async (sql, params) => {
    if (!/LEAST\(user_id, target_user_id\)/.test(sql)) return base(sql, params);
    db.calls.push({ sql, params });
    const ids = params[0].map(Number);
    const kinds = Array.isArray(params[1]) ? params[1] : [params[1], 'all'];
    const seen = new Set(),
      out = [];
    for (const [from, to, kind] of restrictions) {
      if (!ids.includes(from) || !ids.includes(to) || !kinds.includes(kind)) continue;
      const a = Math.min(from, to),
        b = Math.max(from, to);
      if (!seen.has(`${a}:${b}`)) {
        seen.add(`${a}:${b}`);
        out.push({ a, b });
      }
    }
    return { rows: out, rowCount: out.length };
  };
  return db;
}
const REFUSED = { success: false, code: 'restricted', message: 'Some of these people cannot share a private channel' };
const created = (type) => ({ 'INSERT INTO chat\\.channels': [{ id: 'c9', name: 'x', display_name: 'X', type }] });

test('POST /channels (private create) with a dm-restricted target → 403, nothing inserted', async () => {
  const db = restrictedDb([[7, 3, 'dm']], created('private'));
  const r = await request(app(db))
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'Two of us', type: 'private', memberIds: [3] });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, REFUSED);
  assert.equal(touched(db, /INSERT INTO chat\.(channels|channel_members)/), false);
});

test('POST /channels (private create): a dm restriction between two other members does not block', async () => {
  const db = restrictedDb([[3, 5, 'dm']], created('private'));
  const r = await request(app(db))
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'Team', type: 'private', memberIds: [3, 5] });
  assert.equal(r.status, 201);
});

test('POST /channels/:id/members (private): the joiner has a dm restriction TOWARDS the actor → 403, no insert', async () => {
  const db = restrictedDb([[5, 7, 'dm']], {
    ...privateChannel,
    'INSERT INTO chat\\.channel_members': [{ user_id: 5 }],
  });
  const r = await request(app(db))
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, REFUSED);
  assert.equal(touched(db, /INSERT INTO chat\.channel_members/), false);
});

test('POST /channels (group_dm create) with a dm-restricted pair among the joiners → 403, nothing inserted', async () => {
  const db = restrictedDb([[3, 5, 'dm']], created('group_dm'));
  const r = await request(app(db))
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'Chat', type: 'group_dm', memberIds: [3, 5] });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, REFUSED);
  assert.equal(touched(db, /INSERT INTO chat\.(channels|channel_members)/), false);
});

test('POST /channels/:id/members (group_dm): a joiner dm-restricted from an existing non-actor member → 403', async () => {
  const groupDm = {
    ...privateChannel,
    'FROM chat\\.channels c WHERE c\\.id': [{ id: 'c1', name: 'g', display_name: '', type: 'group_dm' }],
    'INSERT INTO chat\\.channel_members': [{ user_id: 5 }],
  };
  const db = restrictedDb([[3, 5, 'all']], groupDm);
  const r = await request(app(db))
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, REFUSED);
  assert.equal(touched(db, /INSERT INTO chat\.channel_members/), false);
});

test('a call-only restriction still allows private and group_dm membership', async () => {
  const p = await request(
    app(
      restrictedDb(
        [
          [7, 3, 'call'],
          [3, 7, 'call'],
        ],
        created('private'),
      ),
    ),
  )
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'P', type: 'private', memberIds: [3] });
  assert.equal(p.status, 201);
  const g = await request(app(restrictedDb([[3, 5, 'call']], created('group_dm'))))
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'Chat', type: 'group_dm', memberIds: [3, 5] });
  assert.equal(g.status, 201);
  const add = await request(
    app(restrictedDb([[5, 7, 'call']], { ...privateChannel, 'INSERT INTO chat\\.channel_members': [{ user_id: 5 }] })),
  )
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(add.status, 200);
  assert.equal(add.body.added, 1);
});

test('public channels ignore dm restrictions (create and add, no restriction query)', async () => {
  const db = restrictedDb(
    [
      [7, 3, 'dm'],
      [5, 7, 'all'],
    ],
    {
      ...created('public'),
      'FROM chat\\.channels c WHERE c\\.id': [{ id: 'c1', name: 'general', display_name: 'General', type: 'public' }],
      'INSERT INTO chat\\.channel_members': [{ user_id: 5 }],
    },
  );
  const c = await request(app(db))
    .post('/api/chat/channels')
    .set('Authorization', token(7))
    .send({ displayName: 'Open', type: 'public', memberIds: [3] });
  assert.equal(c.status, 201);
  const add = await request(app(db))
    .post('/api/chat/channels/c1/members')
    .set('Authorization', token(7))
    .send({ userIds: [5] });
  assert.equal(add.status, 200);
  assert.equal(touched(db, /communication_restrictions/), false);
});
