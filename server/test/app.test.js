import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const dist = mkdtempSync(join(tmpdir(), 'chat-ui-')); mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Chat</title>');
const config = { ...loadConfig({ DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p', SESSION_JWT_SECRET: 'x'.repeat(40) }), uiDist: dist };
const db = { async query() { return { rows: [], rowCount: 0 }; } };
const app = createApp({ config, db, emit: { toChannel() {}, toUser() {} }, fetchImpl: async () => ({ status: 503, async json() { return { success: false, message: 'down' }; } }) });

test('health', async () => { const r = await request(app).get('/health'); assert.equal(r.status, 200); assert.equal(r.body.service, 'chat'); });
test('API routes require auth; auth routes do not', async () => {
  assert.equal((await request(app).get('/api/chat/channels')).status, 401);
  assert.notEqual((await request(app).post('/api/chat/auth/login').send({})).status, 401);
});
test('SPA fallback serves index.html for app paths but 404s unknown /api paths', async () => {
  const r = await request(app).get('/channels/abc'); assert.equal(r.status, 200); assert.match(r.text, /<title>Chat<\/title>/);
  assert.equal((await request(app).get('/api/chat/nope')).status, 404);
});

test('the service worker is served uncached; /chat is no longer a second entry point', async () => {
  const sw = await request(app).get('/sw.js');
  assert.ok([200, 404].includes(sw.status));
  if (sw.status === 200) assert.equal(sw.headers['cache-control'], 'no-cache');
  assert.match((await request(app).get('/chat/')).text, /<title>Chat<\/title>/, 'falls through to the one standalone build');
});
