// Presence over real sockets: the full http stack (as main.js builds it) on a real database (PGlite).
// Every positive expectation waits for the event itself; fixed waits are used only to show that
// something did NOT happen.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { createHttpStack } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createTestDb } from './pg-helper.js';

const secret = 's'.repeat(40), aud = 'rrs-crm-session';
const tok = (id) => jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' });
const { db, close } = await createTestDb();
const GRACE = 150;
const config = { ...loadConfig({ DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p', SESSION_JWT_SECRET: secret, CHAT_REQUIRE_BETA: 'false' }), uiDist: '/nonexistent', uiDistCrm: '/nonexistent', presenceOfflineGraceMs: GRACE };
const stack = createHttpStack({ config, db, fetchImpl: async () => ({ status: 503, async json() { return {}; } }) });
await new Promise((r) => stack.httpServer.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${stack.httpServer.address().port}`;
const client = (id) => connect(`${url}/chat`, { auth: { token: tok(id) }, transports: ['websocket'], forceNew: true, reconnection: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves with the first `event` payload matching `match`; rejects after `ms`. Register before the trigger. */
function waitFor(s, event, match = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off(event, on); reject(new Error(`timed out waiting for ${event}`)); }, ms);
    function on(p) { if (!match(p)) return; clearTimeout(timer); s.off(event, on); resolve(p); }
    s.on(event, on);
  });
}
const collect = (s, events) => { const got = []; for (const e of events) s.on(e, (p) => got.push([e, p])); return got; };
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('condition not met in time'); await sleep(10); }
}
const EVENTS = ['user_online', 'user_offline', 'user_away'];
const lastSeen = async (id) => (await db.query(`SELECT last_seen_at FROM chat.user_presence WHERE user_id = $1`, [id])).rows[0]?.last_seen_at ?? null;
after(async () => { await stack.close(); await close(); });

test('online → second tab (no repeat) → away only when both tabs away → offline after the grace, last_seen_at written', async () => {
  const watcher = client(1); await waitFor(watcher, 'ready');
  const seen = collect(watcher, EVENTS);

  const online2 = waitFor(watcher, 'user_online', (p) => p.user_id === 2);
  const a1 = client(2); await waitFor(a1, 'ready');
  await online2;
  // The first connect records last_seen_at (so a long-lived connection is not "offline" to the digest).
  const seenAtConnect = await until(() => lastSeen(2));

  const a2 = client(2); await waitFor(a2, 'ready');
  await until(() => stack.presence.socketsOf(2).length === 2);

  const online = await fetch(`${url}/api/chat/users/online`, { headers: { Authorization: `Bearer ${tok(1)}` } }).then((r) => r.json());
  assert.deepEqual(online.online, [1, 2]); assert.deepEqual(online.away, []);

  // Away only once BOTH tabs are away. a1's report is acknowledged by a2's making the user away.
  a1.emit('set_away', { away: true });
  const awayTrue = waitFor(watcher, 'user_away', (p) => p.user_id === 2);
  a2.emit('set_away', { away: true });
  assert.deepEqual(await awayTrue, { user_id: 2, away: true });

  // Back to both active, so the order in which the two closes are handled cannot matter.
  const awayFalse = waitFor(watcher, 'user_away', (p) => p.user_id === 2);
  a1.emit('set_away', { away: false });
  assert.deepEqual(await awayFalse, { user_id: 2, away: false });
  a2.emit('set_away', { away: false }); // already active: user-level state unchanged, no event

  const offline = waitFor(watcher, 'user_offline', (p) => p.user_id === 2);
  const closedAt = Date.now();
  a1.close(); a2.close();
  assert.deepEqual(await offline, { user_id: 2 });
  assert.ok(Date.now() - closedAt >= GRACE - 20, 'user_offline only after the grace');
  assert.deepEqual(seen.filter(([, p]) => p.user_id === 2), [
    ['user_online', { user_id: 2 }],
    ['user_away', { user_id: 2, away: true }],
    ['user_away', { user_id: 2, away: false }],
    ['user_offline', { user_id: 2 }],
  ], 'one user_online for two tabs; nothing else in between');
  await until(async () => { const t = await lastSeen(2); return t && new Date(t) >= new Date(seenAtConnect); });
  watcher.close();
});

test('a reload (reconnect within the grace) sends neither user_offline nor another user_online', async () => {
  const watcher = client(1); await waitFor(watcher, 'ready');
  const online3 = waitFor(watcher, 'user_online', (p) => p.user_id === 3);
  const b1 = client(3); await waitFor(b1, 'ready');
  await online3;
  const seen = collect(watcher, EVENTS);
  b1.close();
  await until(() => !stack.presence.isConnected(3));
  const b2 = client(3); await waitFor(b2, 'ready');
  await sleep(GRACE + 100); // negative check: the grace has passed and nothing was announced
  assert.deepEqual(seen.filter(([, p]) => p.user_id === 3), []);
  assert.equal(stack.presence.isConnected(3), true);
  b2.close(); watcher.close();
});
