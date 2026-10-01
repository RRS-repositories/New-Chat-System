import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/index.js';

const base = { DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p', SESSION_JWT_SECRET: 'x'.repeat(40), REDIS_URL: 'redis://127.0.0.1:6379' };

test('defaults: port 5020, aud rrs-crm-session, ssl on, CRM at 127.0.0.1:5000', () => {
  const c = loadConfig(base);
  assert.equal(c.port, 5020);
  assert.equal(c.sessionAud, 'rrs-crm-session');
  assert.deepEqual(c.dbSsl, { rejectUnauthorized: false });
  assert.equal(c.crmInternalUrl, 'http://127.0.0.1:5000');
  assert.deepEqual(c.corsOrigins, []);
  assert.equal(c.uploadsDir, '/data/chat-uploads');
});

test('overrides: CHAT_PORT, DB_SSL=false, CHAT_CORS_ORIGINS comma list', () => {
  const c = loadConfig({ ...base, CHAT_PORT: '5021', DB_SSL: 'false', CHAT_CORS_ORIGINS: 'https://a.test, https://b.test' });
  assert.equal(c.port, 5021);
  assert.equal(c.dbSsl, false);
  assert.deepEqual(c.corsOrigins, ['https://a.test', 'https://b.test']);
});

test('refuses to start without a strong SESSION_JWT_SECRET', () => {
  assert.throws(() => loadConfig({ ...base, SESSION_JWT_SECRET: 'short' }), /SESSION_JWT_SECRET/);
});

test('requireBeta: on by default (unset), on when explicitly "true", off when "false"', () => {
  assert.equal(loadConfig(base).requireBeta, true);
  assert.equal(loadConfig({ ...base, CHAT_REQUIRE_BETA: 'true' }).requireBeta, true);
  assert.equal(loadConfig({ ...base, CHAT_REQUIRE_BETA: 'false' }).requireBeta, false);
});
