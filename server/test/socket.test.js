import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { attachSocket } from '../src/sockets/index.js';

const secret = 's'.repeat(40),
  aud = 'rrs-crm-session';
const tok = (id) => jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' });
const users = {
  7: { id: 7, email: 'a', full_name: 'Ann', role: 'cs_agent', is_approved: true, is_active: true },
  8: { id: 8, email: 'b', full_name: 'Bob', role: 'Sales', is_approved: true, is_active: true },
};
const gone = new Set();
const db = {
  marks: [],
  async query(sql, p) {
    if (/LEFT JOIN account_locks/.test(sql)) return { rows: users[p[0]] && !gone.has(p[0]) ? [users[p[0]]] : [] };
    if (/SELECT channel_id FROM chat\.channel_members WHERE user_id/.test(sql)) return { rows: [{ channel_id: 'c1' }] };
    if (/FROM chat\.channel_members WHERE channel_id/.test(sql)) return { rows: p[0] === 'c1' ? [{ ok: 1 }] : [] };
    if (/UPDATE chat\.channel_members SET last_read_at/.test(sql)) {
      db.marks.push(p);
      return { rows: [] };
    }
    return { rows: [] };
  },
};

const httpServer = createServer();
const io = new Server(httpServer);
const { emit } = attachSocket(io, { db, secret, aud, redisUrl: '', sessionRecheckMs: 60 });
await new Promise((r) => httpServer.listen(0, r));
const url = `http://127.0.0.1:${httpServer.address().port}`;
const client = (id) => connect(`${url}/chat`, { auth: { token: tok(id) }, transports: ['websocket'], forceNew: true });
const once = (s, ev) => new Promise((r) => s.once(ev, r));
after(() => {
  io.close();
  httpServer.close();
});

test('a bad token cannot connect', async () => {
  const s = connect(`${url}/chat`, { auth: { token: 'junk' }, transports: ['websocket'], forceNew: true });
  const err = await once(s, 'connect_error');
  assert.equal(err.message, 'token_invalid');
  s.close();
});

test('connect: ready carries user + channel ids; channel room receives toChannel; user room receives toUser', async () => {
  const a = client(7);
  const ready = await once(a, 'ready');
  assert.equal(ready.user.id, 7);
  assert.deepEqual(ready.channel_ids, ['c1']);
  const p1 = once(a, 'new_message');
  emit.toChannel('c1', 'new_message', { x: 1 });
  assert.deepEqual(await p1, { x: 1 });
  const p2 = once(a, 'channel_updated');
  emit.toUser(7, 'channel_updated', { y: 2 });
  assert.deepEqual(await p2, { y: 2 });
  a.close();
});

test('typing reaches the other member, not the sender, and is throttled to one per 3s', async () => {
  const a = client(7),
    b = client(8);
  await Promise.all([once(a, 'ready'), once(b, 'ready')]);
  let aGot = 0,
    bGot = 0;
  a.on('typing', () => aGot++);
  b.on('typing', () => bGot++);
  a.emit('typing', { channel_id: 'c1' });
  a.emit('typing', { channel_id: 'c1' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(bGot, 1);
  assert.equal(aGot, 0);
  a.close();
  b.close();
});

test('mark_read updates last_read_at for a member and acks; non-member is refused', async () => {
  const a = client(7);
  await once(a, 'ready');
  const ack = await new Promise((r) => a.emit('mark_read', { channel_id: 'c1' }, r));
  assert.deepEqual(ack, { ok: true });
  assert.equal(db.marks.at(-1)[0], 'c1');
  assert.equal(db.marks.at(-1)[1], 7);
  const bad = await new Promise((r) => a.emit('mark_read', { channel_id: 'nope' }, r));
  assert.equal(bad.ok, false);
  a.close();
});

test('leaveRoom stops a removed user receiving the channel; joinRoom starts it', async () => {
  const a = client(7);
  await once(a, 'ready');
  let got = 0;
  a.on('new_message', () => got++);
  emit.leaveRoom(7, 'c1');
  await new Promise((r) => setTimeout(r, 50));
  emit.toChannel('c1', 'new_message', { x: 1 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(got, 0, 'no delivery after leaving the room');
  emit.joinRoom(7, 'c1');
  await new Promise((r) => setTimeout(r, 50));
  const p = once(a, 'new_message');
  emit.toChannel('c1', 'new_message', { x: 2 });
  assert.deepEqual(await p, { x: 2 });
  a.close();
});

test('a live socket is disconnected once its session no longer authenticates', async () => {
  const b = client(8);
  await once(b, 'ready');
  gone.add(8);
  const ended = once(b, 'session_ended');
  const disc = once(b, 'disconnect');
  assert.deepEqual(await ended, { reason: 'token_invalid' });
  await disc;
  gone.delete(8);
  b.close();
});

test('mark_read tells the user’s other sockets to clear the badge (unread_update)', async () => {
  const a1 = client(7),
    a2 = client(7);
  await Promise.all([once(a1, 'ready'), once(a2, 'ready')]);
  const p = once(a2, 'unread_update');
  await new Promise((r) => a1.emit('mark_read', { channel_id: 'c1' }, r));
  assert.deepEqual(await p, { channel_id: 'c1', unread_count: 0, mention_count: 0 });
  a1.close();
  a2.close();
});
