import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../src/auth.js';
import { createBrowseRoutes } from '../src/routes/browse.js';
import { createChannelRoutes } from '../src/routes/channels.js';
import { makeDb, token, secret, aud } from './route-helper.js';

// Assembled the same way src/app.js mounts them: the browse router first, at the
// same base path as the channels router, so GET /browse is handled here and never
// falls through to the channels router's GET /:id.
function app(db, emitted = []) {
  const emit = {
    toChannel: (c, e, p) => emitted.push({ c, e, p }),
    toUser: (u, e, p) => emitted.push({ u, e, p }),
    joinRoom: (u, c) => emitted.push({ join: [u, c] }),
    leaveRoom: (u, c) => emitted.push({ leave: [u, c] }),
  };
  const a = express();
  a.use(express.json());
  const auth = requireAuth({ db, secret, aud });
  a.use('/api/chat/channels', auth, createBrowseRoutes({ db, emit }));
  a.use('/api/chat/channels', auth, createChannelRoutes({ db, emit }));
  return a;
}

test('GET /browse is served by the browse router, not channels/:id (mount order)', async () => {
  // member: false means the channels router's GET /:id would 403 (not_member) if
  // 'browse' were ever read as a channel id there instead of matching /browse here.
  const db = makeDb({
    member: false,
    rows: { "SELECT c\\.id, c\\.name, c\\.display_name, c\\.purpose": [
      { id: 'c1', name: 'general', display_name: 'General', purpose: 'chat', member_count: '3', joined: true },
    ] },
  });
  const r = await request(app(db)).get('/api/chat/channels/browse').set('Authorization', token(7));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.channels, [{ id: 'c1', name: 'general', displayName: 'General', purpose: 'chat', memberCount: 3, joined: true }]);
});

test('POST /channels/:id/join: a new member joins their socket room and broadcasts member_added', async () => {
  const emitted = [];
  const db = makeDb({
    rows: {
      'SELECT type, archived_at FROM chat\\.channels WHERE id = \\$1': [{ type: 'public', archived_at: null }],
      // RETURNING user_id yields a row: this call is the one that actually inserted the membership.
      'INSERT INTO chat\\.channel_members \\(channel_id, user_id, role\\) VALUES': [{ user_id: 7 }],
      'FROM chat\\.channels c WHERE c\\.id = \\$1 AND c\\.archived_at IS NULL': [
        { id: 'c1', name: 'general', display_name: 'General', type: 'public', purpose: '', header: '', member_count: '4' },
      ],
    },
  });
  const r = await request(app(db, emitted)).post('/api/chat/channels/c1/join').set('Authorization', token(7));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.channel.id, 'c1');
  assert.deepEqual(emitted.find((e) => e.join)?.join, [7, 'c1']);
  assert.deepEqual(emitted.find((e) => e.e === 'member_added'), { c: 'c1', e: 'member_added', p: { channel_id: 'c1', user_ids: [7] } });
  const audit = db.calls.find((x) => /INSERT INTO chat\.audit_log/.test(x.sql));
  assert.ok(audit, 'the actual join is audit-logged');
});

test('POST /channels/:id/join: already a member is a silent no-op — no joinRoom, no member_added, no audit row', async () => {
  const emitted = [];
  const db = makeDb({
    rows: {
      'SELECT type, archived_at FROM chat\\.channels WHERE id = \\$1': [{ type: 'public', archived_at: null }],
      // No RETURNING-id stub for the INSERT: the ON CONFLICT DO NOTHING path returns no rows,
      // exactly as it does for real Postgres when the caller is already a member.
      'FROM chat\\.channels c WHERE c\\.id = \\$1 AND c\\.archived_at IS NULL': [
        { id: 'c1', name: 'general', display_name: 'General', type: 'public', purpose: '', header: '', member_count: '4' },
      ],
    },
  });
  const r = await request(app(db, emitted)).post('/api/chat/channels/c1/join').set('Authorization', token(7));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.channel.id, 'c1', 'still 200 with the channel: idempotent from the client’s view');
  assert.equal(emitted.length, 0, 'no joinRoom and no member_added broadcast for an already-a-member retry');
  const audit = db.calls.find((x) => /INSERT INTO chat\.audit_log/.test(x.sql));
  assert.equal(audit, undefined, 'no spurious audit row for a no-op retry');
});

test('POST /channels/:id/join: a non-public channel is refused with 403 not_public and nothing is emitted', async () => {
  const emitted = [];
  const db = makeDb({ rows: { 'SELECT type, archived_at FROM chat\\.channels WHERE id = \\$1': [{ type: 'private', archived_at: null }] } });
  const r = await request(app(db, emitted)).post('/api/chat/channels/c1/join').set('Authorization', token(7));
  assert.equal(r.status, 403); assert.equal(r.body.code, 'not_public'); assert.equal(emitted.length, 0);
});

test('POST /channels/:id/join: a missing or archived channel is 404 not_found', async () => {
  const missing = makeDb({ rows: { 'SELECT type, archived_at FROM chat\\.channels WHERE id = \\$1': [] } });
  const r1 = await request(app(missing)).post('/api/chat/channels/c1/join').set('Authorization', token(7));
  assert.equal(r1.status, 404); assert.equal(r1.body.code, 'not_found');

  const archived = makeDb({ rows: { 'SELECT type, archived_at FROM chat\\.channels WHERE id = \\$1': [{ type: 'public', archived_at: '2026-01-01T00:00:00.000Z' }] } });
  const r2 = await request(app(archived)).post('/api/chat/channels/c1/join').set('Authorization', token(7));
  assert.equal(r2.status, 404); assert.equal(r2.body.code, 'not_found');
});
