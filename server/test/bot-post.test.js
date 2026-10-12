// The CRM's automatic messages (Phase 8): one way in, a key instead of a session.
// Run: node --test test/bot-post.test.js
//
// No database and no network: a stand-in `db` answers the handful of queries the
// bot route makes, so these check routing and refusals, not Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';
import { renderCard } from '../src/services/bot.service.js';

const KEY = 'test-bot-key-0123456789';
const BOT_ID = 486;
const NOW = new Date('2026-10-12T09:00:00Z');

const dist = mkdtempSync(join(tmpdir(), 'chat-ui-bot-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Chat</title>');

const CHANNELS = [
  { id: 'c-admin', display_name: 'ADMIN', name: 'admin-team', type: 'private' },
  { id: 'c-pay', display_name: 'PAYMENTS DEPT', name: 'payments-department', type: 'private' },
];

function makeDb(overrides = {}) {
  const sent = [];
  return {
    sent,
    async query(sql, params = []) {
      if (/FROM users WHERE id =/.test(sql))
        return { rows: overrides.noBot ? [] : [{ id: BOT_ID, full_name: 'Sarah' }], rowCount: 1 };
      if (/lower\(email\)/.test(sql))
        return params[0] === 'someone@example.com'
          ? { rows: [{ id: 99, full_name: 'Someone' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      if (/FROM chat\.channels/.test(sql) && /archived_at IS NULL/.test(sql))
        return { rows: CHANNELS, rowCount: CHANNELS.length };
      if (/INSERT INTO chat\.channels/.test(sql))
        return {
          rows: [{ id: 'c-dm', name: params[0], display_name: '', type: 'dm', created_at: NOW, updated_at: NOW }],
          rowCount: 1,
        };
      if (/FROM public\.users WHERE id/.test(sql))
        return { rows: [{ id: params[0], full_name: 'Someone' }], rowCount: 1 };
      if (/INSERT INTO chat\.messages/.test(sql)) {
        sent.push({ channelId: params[0], userId: params[1], content: params[2] });
        return { rows: [{ id: 'm-1' }], rowCount: 1 };
      }
      // createMessage re-reads the row it just wrote, through a join with an alias.
      if (/FROM chat\.messages/.test(sql) && /WHERE/.test(sql))
        return {
          rows: [
            {
              id: 'm-1',
              channel_id: sent.at(-1)?.channelId,
              user_id: BOT_ID,
              content: sent.at(-1)?.content,
              created_at: NOW,
              type: 'message',
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    },
  };
}

function makeApp(db, env = {}) {
  const config = {
    ...loadConfig({
      DB_HOST: 'h',
      DB_NAME: 'n',
      DB_USER: 'u',
      DB_PASSWORD: 'p',
      SESSION_JWT_SECRET: 'x'.repeat(40),
      CHAT_BOT_KEY: KEY,
      CHAT_BOT_USER_ID: String(BOT_ID),
      ...env,
    }),
    uiDist: dist,
  };
  return createApp({ config, db, emit: { toChannel() {}, toUser() {} }, notifier: null });
}

const post = (db, body, env) =>
  request(makeApp(db, env)).post('/api/chat/bot/post').set('x-chat-bot-key', KEY).send(body);

// --- the key ------------------------------------------------------------

test('no key at all is refused', async () => {
  const res = await request(makeApp(makeDb())).post('/api/chat/bot/post').send({ channel: 'ADMIN', text: 'hi' });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'bad_bot_key');
});

test('a wrong key is refused', async () => {
  const res = await request(makeApp(makeDb()))
    .post('/api/chat/bot/post')
    .set('x-chat-bot-key', 'not-the-key')
    .send({ channel: 'ADMIN', text: 'hi' });
  assert.equal(res.status, 401);
});

test('a key missing its last character is refused', async () => {
  const res = await request(makeApp(makeDb()))
    .post('/api/chat/bot/post')
    .set('x-chat-bot-key', KEY.slice(0, -1))
    .send({ channel: 'ADMIN', text: 'hi' });
  assert.equal(res.status, 401);
});

test('with no key configured the route is closed, not open', async () => {
  const res = await request(makeApp(makeDb(), { CHAT_BOT_KEY: '' }))
    .post('/api/chat/bot/post')
    .set('x-chat-bot-key', KEY)
    .send({ channel: 'ADMIN', text: 'hi' });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'bot_not_configured');
});

// --- where the message lands --------------------------------------------

test('posts to a channel by its name', async () => {
  const db = makeDb();
  const res = await post(db, { channel: 'ADMIN', text: 'Backup finished' });
  assert.equal(res.status, 200);
  assert.equal(res.body.delivered_to, 'ADMIN');
  assert.equal(db.sent.at(-1).channelId, 'c-admin');
  assert.equal(db.sent.at(-1).content, 'Backup finished');
  assert.equal(db.sent.at(-1).userId, BOT_ID);
});

test('the name may be written any sensible way', async () => {
  for (const name of ['PAYMENTS DEPT', 'Payments Dept', 'payments dept', 'payments-dept', 'payments_dept']) {
    const db = makeDb();
    const res = await post(db, { channel: name, text: 'x' });
    assert.equal(res.status, 200, name);
    assert.equal(db.sent.at(-1).channelId, 'c-pay', name);
  }
});

test('the slug works too', async () => {
  const db = makeDb();
  assert.equal((await post(db, { channel: 'admin-team', text: 'x' })).status, 200);
  assert.equal(db.sent.at(-1).channelId, 'c-admin');
});

test('a channel that does not exist is refused, never posted somewhere else', async () => {
  const db = makeDb();
  const res = await post(db, { channel: 'NOWHERE', text: 'x' });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'no_such_channel');
  assert.equal(db.sent.length, 0, 'nothing should have been posted');
});

test('a direct message goes by email', async () => {
  const db = makeDb();
  const res = await post(db, { email: 'someone@example.com', text: 'Ops Health' });
  assert.equal(res.status, 200);
  assert.equal(res.body.delivered_to, 'Someone');
});

test('an unknown email is refused and nothing is posted', async () => {
  const db = makeDb();
  const res = await post(db, { email: 'nobody@example.com', text: 'x' });
  assert.equal(res.status, 404);
  assert.equal(db.sent.length, 0);
});

test('a channel and an email together is refused - one destination only', async () => {
  const res = await post(makeDb(), { channel: 'ADMIN', email: 'someone@example.com', text: 'x' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'two_targets');
});

test('an empty message is refused', async () => {
  for (const body of [{ channel: 'ADMIN' }, { channel: 'ADMIN', text: '   ' }]) {
    const res = await post(makeDb(), body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('with no bot account set, nothing is posted', async () => {
  const db = makeDb();
  const res = await post(db, { channel: 'ADMIN', text: 'x' }, { CHAT_BOT_USER_ID: '' });
  assert.equal(res.status, 503);
  assert.equal(db.sent.length, 0);
});

// --- cards become text ---------------------------------------------------

test('a card keeps its title, body and fields', () => {
  const out = renderCard(
    { title: 'Deploy OK', text: 'crm-backend restarted', fields: [{ label: 'Commit', value: 'abc123' }] },
    'fallback',
  );
  assert.match(out, /\*\*Deploy OK\*\*/);
  assert.match(out, /crm-backend restarted/);
  assert.match(out, /\*\*Commit:\*\* abc123/);
  assert.ok(!out.includes('fallback'), 'the card body wins over the plain text');
});

test('no card falls back to the plain text', () => {
  assert.equal(renderCard(null, 'just text'), 'just text');
  assert.equal(renderCard(undefined, 'just text'), 'just text');
});

test('a card with only fields still carries them', () => {
  const out = renderCard({ fields: [{ label: 'Queue', value: '12 waiting' }] }, '');
  assert.match(out, /\*\*Queue:\*\* 12 waiting/);
});
