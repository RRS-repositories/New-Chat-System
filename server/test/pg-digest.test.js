// Daily digest against real Postgres (PGlite): selection rule, content, last_digest_at bookkeeping.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { startDigest } from '../src/services/digest/digest.service.js';

const MEG = 1, ANN = 2, BOB = 3, GONE = 4, CY = 5;
const config = { digestEnabled: true, digestHourUtc: 8, publicUrl: 'https://crm.example/chat' };
const HOUR = 3600 * 1000;
let t, db, sent, sendMail;
beforeEach(async () => {
  t = await createTestDb(); db = t.db; sent = [];
  sendMail = async (m) => { sent.push(m); };
});
afterEach(async () => { await t.close(); });

const general = async () => (await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`)).rows[0].id;
async function channel(displayName, type = 'public', archived = false) {
  const name = `${displayName}-${Math.random().toString(36).slice(2, 8)}`;
  return (await db.query(`INSERT INTO chat.channels (name, display_name, type, created_by, archived_at) VALUES ($1,$2,$3,1,${archived ? 'now()' : 'NULL'}) RETURNING id`, [name, displayName, type])).rows[0].id;
}
async function mention(userId, channelId, { read = false, deleted = false, member = true } = {}) {
  if (member) await db.query(`INSERT INTO chat.channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [channelId, userId]);
  const m = (await db.query(`INSERT INTO chat.messages (channel_id, user_id, content, deleted_at) VALUES ($1, 1, 'secret text', ${deleted ? 'now()' : 'NULL'}) RETURNING id`, [channelId])).rows[0].id;
  await db.query(`INSERT INTO chat.mentions (message_id, channel_id, user_id, read) VALUES ($1,$2,$3,$4)`, [m, channelId, userId, read]);
}
const digest = () => startDigest({ db, config, sendMail });
const lastDigest = async (u) => (await db.query(`SELECT last_digest_at FROM chat.user_preferences WHERE user_id = $1`, [u])).rows[0]?.last_digest_at ?? null;

test('user with an unread mention gets one email; last_digest_at is set', async () => {
  await mention(ANN, await general());
  const r = await digest().runOnce();
  assert.deepEqual(r, { sent: 1, skipped: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'a@x');
  assert.ok(await lastDigest(ANN));
});

test('excluded: no mentions, read mentions, deleted message, archived channel, inactive user, unapproved', async () => {
  const g = await general();
  await mention(BOB, g, { read: true });
  await mention(CY, g, { deleted: true });
  await mention(MEG, await channel('old', 'public', true));
  await mention(GONE, g);
  await db.query(`UPDATE users SET is_approved = FALSE WHERE id = 2`);
  await mention(ANN, g);
  const r = await digest().runOnce();
  assert.equal(sent.length, 0);
  assert.equal(r.sent, 0);
});

test('excluded: seen within 12 hours; included when older or missing', async () => {
  const g = await general();
  await mention(ANN, g); await mention(BOB, g); await mention(CY, g);
  await db.query(`INSERT INTO chat.user_presence (user_id, last_seen_at) VALUES (2, now() - interval '1 hour'), (3, now() - interval '13 hours')`);
  await digest().runOnce();
  assert.deepEqual(sent.map((m) => m.to).sort(), ['b@x', 'c@x']);
});

test('excluded: digested within 20 hours; included when older', async () => {
  const g = await general();
  await mention(ANN, g); await mention(BOB, g); await mention(CY, g);
  await db.query(`INSERT INTO chat.user_preferences (user_id, last_digest_at) VALUES (2, now() - interval '2 hours'), (3, now() - interval '21 hours')`);
  await digest().runOnce();
  assert.deepEqual(sent.map((m) => m.to).sort(), ['b@x', 'c@x']);
  assert.ok((await lastDigest(BOB)) > new Date(Date.now() - HOUR), 'existing row updated');
});

test('injected now controls the time comparisons', async () => {
  await mention(ANN, await general());
  await db.query(`INSERT INTO chat.user_presence (user_id, last_seen_at) VALUES (2, now())`);
  const later = () => new Date(Date.now() + 13 * HOUR);
  const r = await startDigest({ db, config, sendMail, now: later }).runOnce();
  assert.equal(r.sent, 1);
});

test('email lists channels most mentions first, DM as Direct message, escapes html, no content', async () => {
  const g = await general();
  const dm = await channel('Ann and Meg', 'dm');
  const odd = await channel('<b>R&D</b>');
  await mention(ANN, g);
  await mention(ANN, dm); await mention(ANN, dm); await mention(ANN, dm);
  await mention(ANN, odd); await mention(ANN, odd);
  await digest().runOnce();
  const m = sent[0];
  assert.equal(m.subject, 'You have unread mentions in team chat');
  const lines = m.text.split('\n');
  const idx = (s) => lines.findIndex((l) => l.includes(s));
  assert.ok(idx('Direct message — 3 mentions') >= 0);
  assert.ok(idx('#<b>R&D</b> — 2 mentions') >= 0);
  assert.ok(idx('#General — 1 mention') >= 0);
  assert.ok(!m.text.includes('#General — 1 mentions'));
  assert.ok(idx('Direct message') < idx('R&D') && idx('R&D') < idx('#General'));
  assert.ok(!m.text.includes('Ann and Meg'));
  assert.ok(m.text.trimEnd().endsWith('Open team chat: https://crm.example/chat'));
  assert.ok(m.html.includes('&lt;b&gt;R&amp;D&lt;/b&gt;'));
  assert.ok(!m.html.includes('<b>R&D</b>'));
  assert.ok(m.html.includes('https://crm.example/chat'));
  assert.ok(!m.text.includes('secret text') && !m.html.includes('secret text'));
});

test('a failing send for one user does not stop the others and leaves last_digest_at unset', async () => {
  const g = await general();
  await mention(ANN, g); await mention(BOB, g); await mention(CY, g);
  const errs = []; const orig = console.error; console.error = (...a) => errs.push(a);
  const mail = async (m) => { if (m.to === 'b@x') throw new Error('smtp down'); sent.push(m); };
  let r;
  try { r = await startDigest({ db, config, sendMail: mail }).runOnce(); } finally { console.error = orig; }
  assert.deepEqual(sent.map((m) => m.to).sort(), ['a@x', 'c@x']);
  assert.equal(r.sent, 2); assert.equal(r.skipped, 1);
  assert.equal(await lastDigest(BOB), null);
  assert.ok(await lastDigest(ANN) && await lastDigest(CY));
  assert.equal(errs[0][0], '[chat] digest');
});

test('channels the user has left, or muted, are not counted or listed', async () => {
  const g = await general();
  const left = await channel('secret-room', 'private');
  const muted = await channel('noisy');
  await db.query(`INSERT INTO chat.channel_members (channel_id, user_id, notify_pref) VALUES ($1, 2, 'nothing')`, [muted]);
  await mention(ANN, left, { member: false }); await mention(ANN, muted); await mention(ANN, g);
  await digest().runOnce();
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes('#General — 1 mention'));
  assert.ok(!sent[0].text.includes('secret-room') && !sent[0].text.includes('noisy'));
  assert.ok(!sent[0].html.includes('secret-room') && !sent[0].html.includes('noisy'));
});

test('a user whose only unread mentions are in a channel they left gets no email', async () => {
  await mention(ANN, await channel('secret-room', 'private'), { member: false });
  const r = await digest().runOnce();
  assert.equal(sent.length, 0); assert.equal(r.sent, 0);
});

test('users with an empty or NULL email are never selected', async () => {
  const g = await general();
  await db.query(`INSERT INTO users (id, email, full_name, role) VALUES (10, '', 'Blank', 'Sales'), (11, NULL, 'Null', 'Sales')`);
  await db.query(`INSERT INTO chat.channel_members (channel_id, user_id) VALUES ($1, 10), ($1, 11)`, [g]);
  await mention(10, g); await mention(11, g);
  const r = await digest().runOnce();
  assert.equal(sent.length, 0); assert.equal(r.sent, 0);
});

test('a user who is connected right now is skipped and not marked digested', async () => {
  const g = await general();
  await mention(ANN, g); await mention(BOB, g);
  const r = await startDigest({ db, config, sendMail, isConnected: (id) => id === ANN }).runOnce();
  assert.deepEqual(sent.map((m) => m.to), ['b@x']);
  assert.deepEqual(r, { sent: 1, skipped: 0 });
  assert.equal(await lastDigest(ANN), null);
});

test('a second pass does not resend', async () => {
  await mention(ANN, await general());
  const d = digest();
  await d.runOnce(); await d.runOnce();
  assert.equal(sent.length, 1);
});
