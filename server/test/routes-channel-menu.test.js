// The sidebar menu's two new server pieces: a favourite star, and mark as unread.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createTestDb } from './pg-helper.js';
import { createChannel, listChannelsForUser } from '../src/models/channels.model.js';
import { createMessage } from '../src/models/messages.model.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
const events = [];
const emit = {
  toChannel() {},
  toUser: (id, ev, p) => events.push({ id, ev, p }),
  toSocket() {},
  toAll() {},
  userOfSocket: () => null,
  joinRoom() {},
  leaveRoom() {},
};
const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false };
const app = createApp({ config, db, emit });
after(() => close());
const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const as = (id) => ({
  post: (path, body = {}) => request(app).post(`/api/chat${path}`).set('Authorization', auth(id)).send(body),
  patch: (path, body = {}) => request(app).patch(`/api/chat${path}`).set('Authorization', auth(id)).send(body),
});
const channel = await createChannel(db, {
  name: 'menu',
  displayName: 'Menu',
  type: 'private',
  createdBy: 1,
  memberIds: [2],
});
const mine = async (id) => (await listChannelsForUser(db, id)).find((c) => c.id === channel.id);

test('a favourite is the person’s own: it shows in their list, not the other member’s, and comes off again', async () => {
  assert.equal((await mine(1)).favourite, false);
  const on = await as(1).patch(`/channels/${channel.id}/favourite`, { on: true });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { success: true, favourite: true });
  assert.equal((await mine(1)).favourite, true);
  assert.equal((await mine(2)).favourite, false);
  const off = await as(1).patch(`/channels/${channel.id}/favourite`, { on: false });
  assert.equal(off.body.favourite, false);
  assert.equal((await as(3).patch(`/channels/${channel.id}/favourite`, { on: true })).status, 403, 'not a member');
});

test('mark as unread: the newest message from someone else is unread again, and every device is told', async () => {
  await createMessage(db, { channelId: channel.id, userId: 2, content: 'from Ann' });
  await as(1).post(`/channels/${channel.id}/read`);
  assert.equal((await mine(1)).unreadCount, 0);
  events.length = 0;
  const r = await as(1).post(`/channels/${channel.id}/unread`);
  assert.equal(r.status, 200);
  assert.equal(r.body.unreadCount, 1);
  assert.equal((await mine(1)).unreadCount, 1);
  assert.deepEqual(events, [
    { id: 1, ev: 'unread_update', p: { channel_id: channel.id, unread_count: 1, mention_count: 0 } },
  ]);
  // Only my own messages in a conversation: nothing to mark.
  const own = await createChannel(db, {
    name: 'solo',
    displayName: 'Solo',
    type: 'private',
    createdBy: 1,
    memberIds: [],
  });
  await createMessage(db, { channelId: own.id, userId: 1, content: 'just me' });
  assert.equal((await as(1).post(`/channels/${own.id}/unread`)).body.unreadCount, 0);
  assert.equal((await as(3).post(`/channels/${channel.id}/unread`)).status, 403);
});
