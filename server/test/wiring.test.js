// The http server, Express and Socket.IO wired the way main.js does it.
// Regression: with Express added as a SECOND 'request' listener after engine.io,
// a polling handshake + POST made both answer the same request and the process
// died on ERR_HTTP_HEADERS_SENT (uncaught). Two anonymous requests = crash loop.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpStack } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const config = { ...loadConfig({ DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p', SESSION_JWT_SECRET: 'x'.repeat(40) }), uiDist: '/nonexistent' };
const db = { async query() { return { rows: [], rowCount: 0 }; } };
const stack = createHttpStack({ config, db, fetchImpl: async () => ({ status: 503, async json() { return {}; } }) });
await new Promise((r) => stack.httpServer.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${stack.httpServer.address().port}`;
after(async () => { await stack.close(); });

let uncaught = null;
process.on('uncaughtException', (e) => { uncaught = e; });

test('a polling handshake followed by a POST is answered once and does not crash the process', async () => {
  const hs = await fetch(`${base}/socket.io/?EIO=4&transport=polling&t=1`);
  assert.equal(hs.status, 200);
  const body = await hs.text();
  const sid = JSON.parse(body.slice(body.indexOf('{'))).sid;
  const post = await fetch(`${base}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: 'POST', body: '40/chat,', headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  assert.ok([200, 400].includes(post.status), `status ${post.status}`);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(uncaught, null, `uncaught: ${uncaught && uncaught.message}`);
  const health = await fetch(`${base}/health`);
  assert.equal((await health.json()).service, 'chat');
});

test('express still serves /health and 404s unknown api paths with socket.io attached', async () => {
  assert.equal((await fetch(`${base}/api/chat/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/chat/channels`)).status, 401);
});
