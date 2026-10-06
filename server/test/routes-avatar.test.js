// Profile photos through the real app on PGlite, with a real uploads folder and real pictures.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createTestDb } from './pg-helper.js';
import { secret, aud } from './route-helper.js';

const { db, close } = await createTestDb();
const uploadsDir = mkdtempSync(path.join(tmpdir(), 'chat-avatar-test-'));
const config = { sessionSecret: secret, sessionAud: aud, corsOrigins: [], requireBeta: false, uploadsDir };
const events = [];
const emit = {
  toChannel() {},
  toUser() {},
  toSocket() {},
  toAll: (ev, p) => events.push({ ev, p }),
  joinRoom() {},
  leaveRoom() {},
};
const app = createApp({ config, db, emit });
after(async () => {
  await close();
  rmSync(uploadsDir, { recursive: true, force: true });
});

const auth = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const as = (id) => ({
  get: (url) => request(app).get(`/api/chat${url}`).set('Authorization', auth(id)),
  del: (url) => request(app).delete(`/api/chat${url}`).set('Authorization', auth(id)),
  upload: (buffer, filename, contentType) =>
    request(app)
      .post('/api/chat/users/me/avatar')
      .set('Authorization', auth(id))
      .attach('file', buffer, { filename, contentType }),
});
const picture = (width, height, format = 'png') =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 120 } } })
    [format]()
    .toBuffer();
const stored = () =>
  existsSync(path.join(uploadsDir, 'avatars')) ? readdirSync(path.join(uploadsDir, 'avatars')) : [];
const binary = (res, done) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

test('uploading a photo stores a 256 by 256 JPEG, answers with its address, and tells everyone', async () => {
  const mark = events.length;
  const r = await as(2).upload(await picture(900, 400), 'me.png', 'image/png');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.avatarUrl, /^\/api\/chat\/users\/2\/avatar\?v=\d+$/);
  assert.deepEqual(events.slice(mark), [{ ev: 'user_updated', p: { user_id: 2, avatar_url: r.body.avatarUrl } }]);
  assert.equal(stored().length, 1);

  const shown = await as(3).get(r.body.avatarUrl.replace('/api/chat', '')).buffer(true).parse(binary);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers['content-type'], 'image/jpeg');
  assert.match(shown.headers['cache-control'], /immutable/);
  const meta = await sharp(shown.body).metadata();
  assert.deepEqual(
    [meta.format, meta.width, meta.height],
    ['jpeg', 256, 256],
    'made square and small, whatever was sent',
  );
});

test('the address appears wherever people are listed', async () => {
  const online = await as(3).get('/users/online');
  assert.match(online.body.avatars['2'], /^\/api\/chat\/users\/2\/avatar\?v=\d+$/);
  assert.equal(Object.keys(online.body.avatars).length, 1);
  // The pick-from list offers only people who have signed in to the chat (a presence row).
  await db.query(
    `INSERT INTO chat.user_presence (user_id, last_seen_at) VALUES (1, now()), (2, now()) ON CONFLICT DO NOTHING`,
  );
  const people = (await as(3).get('/users')).body.users;
  assert.equal(people.find((u) => u.id === 2).avatarUrl, online.body.avatars['2']);
  assert.equal(people.find((u) => u.id === 1).avatarUrl, null);
  const general = (await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`)).rows[0].id;
  const members = (await as(3).get(`/channels/${general}`)).body.members;
  assert.equal(members.find((m) => m.id === 2).avatarUrl, online.body.avatars['2']);
});

test('a new photo replaces the old one: new address, old file gone', async () => {
  const before = (await as(2).get('/users/online')).body.avatars['2'];
  const [oldFile] = stored();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const r = await as(2).upload(await picture(300, 300, 'jpeg'), 'again.jpg', 'image/jpeg');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(r.body.avatarUrl, before);
  assert.deepEqual(stored().length, 1);
  assert.notEqual(stored()[0], oldFile);
});

test('what is not a picture is refused, and nothing is stored', async () => {
  const count = stored().length;
  const pdf = Buffer.from('%PDF-1.4 not a picture');
  const cases = [
    [pdf, 'cv.pdf', 'application/pdf', 'file_type'],
    [pdf, 'photo.png', 'image/png', 'file_content'],
    [Buffer.from('GIF89a' + 'x'.repeat(40)), 'anim.gif', 'image/gif', 'file_type'],
    [
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]),
      'broken.png',
      'image/png',
      'file_content',
    ],
  ];
  for (const [buffer, filename, type, code] of cases) {
    const r = await as(3).upload(buffer, filename, type);
    assert.equal(r.status, 400, `${filename}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, code, filename);
  }
  const none = await request(app).post('/api/chat/users/me/avatar').set('Authorization', auth(3));
  assert.equal(none.body.code, 'no_file');
  assert.equal(stored().length, count);
  assert.equal((await as(3).get('/users/3/avatar')).status, 404);
});

test('a picture over 2 MB is refused', async () => {
  const big = Buffer.concat([await picture(64, 64, 'jpeg'), Buffer.alloc(2 * 1024 * 1024 + 10)]);
  const r = await as(1).upload(big, 'huge.jpg', 'image/jpeg');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'file_too_large');
});

test('removing the photo: gone everywhere, file deleted, everyone told once', async () => {
  const mark = events.length;
  assert.equal((await as(2).del('/users/me/avatar')).status, 200);
  assert.deepEqual(events.slice(mark), [{ ev: 'user_updated', p: { user_id: 2, avatar_url: null } }]);
  assert.deepEqual(stored(), []);
  assert.deepEqual((await as(3).get('/users/online')).body.avatars, {});
  assert.equal((await as(3).get('/users/2/avatar')).status, 404);
  // Removing again changes nothing and tells nobody.
  assert.equal((await as(2).del('/users/me/avatar')).status, 200);
  assert.equal(events.length, mark + 1);
});

test('photos are for signed-in people only; a nonsense id is simply not found', async () => {
  assert.equal((await request(app).get('/api/chat/users/2/avatar')).status, 401);
  assert.equal((await as(3).get('/users/abc/avatar')).status, 404);
  assert.equal((await as(3).get('/users/999999/avatar')).status, 404);
});

test('a photo does not disturb the person’s other preferences', async () => {
  await request(app)
    .patch('/api/chat/users/me/preferences')
    .set('Authorization', auth(5))
    .send({ soundEnabled: false });
  await as(5).upload(await picture(100, 100), 'cy.png', 'image/png');
  const prefs = (await as(5).get('/users/me/preferences')).body.preferences;
  assert.equal(prefs.soundEnabled, false);
  assert.equal(prefs.desktopNotif, 'mentions');
});

test('at most five uploads a minute per person', async () => {
  const small = await picture(40, 40);
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await as(1).upload(small, 'p.png', 'image/png')).status);
  assert.ok(statuses.includes(429), statuses.join(','));
  assert.equal(statuses.filter((s) => s === 200).length, 4, 'the over-size attempt above counted as one of the five');
});
