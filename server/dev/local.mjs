// Local chat for testing on a developer machine — never used in production.
//
//   node server/dev/local.mjs            → http://localhost:5021
//
// The REAL server stack (Express + Socket.IO + every route) on an in-process
// Postgres (PGlite) that starts empty each run, with a handful of test people
// and a stand-in for the CRM login. Sign in as any address below with the
// password "local". Nothing here touches the production database or server.
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import { loadConfig } from '../src/config.js';
import { createHttpStack } from '../src/server.js';
import { createTestDb } from '../test/pg-helper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5021', 10);
const SECRET = 'local-dev-secret-'.padEnd(40, 'x');
const PASSWORD = 'local';

const { pg, db } = await createTestDb();
// A few more people so group calls (3+) can be tried; ids continue from the seed (1-5).
await pg.exec(`
  INSERT INTO users (email, full_name, role) VALUES ('dee@x', 'Dee Debt', 'Sales'), ('eli@x', 'Eli IT', 'IT'), ('fay@x', 'Fay Finance', 'Payments');
  INSERT INTO chat.channel_members (channel_id, user_id)
    SELECT c.id, u.id FROM chat.channels c, users u WHERE c.name = 'general' AND u.is_active IS NOT FALSE
    ON CONFLICT DO NOTHING;
`);

const vapid = webpush.generateVAPIDKeys();
const config = {
  ...loadConfig({
    SESSION_JWT_SECRET: SECRET, DB_HOST: 'local', DB_NAME: 'local', DB_USER: 'local', DB_PASSWORD: 'local',
    CHAT_REQUIRE_BETA: process.env.CHAT_REQUIRE_BETA || 'false',
    CHAT_VAPID_PUBLIC: vapid.publicKey, CHAT_VAPID_PRIVATE: vapid.privateKey,
    CHAT_STUN_URLS: process.env.CHAT_STUN_URLS ?? '',   // same machine: host candidates are enough
    CHAT_TURN_URLS: process.env.CHAT_TURN_URLS || '', CHAT_TURN_SECRET: process.env.CHAT_TURN_SECRET || '',
  }),
  port: PORT, redisUrl: '', uploadsDir: mkdtempSync(path.join(tmpdir(), 'chat-local-uploads-')),
};

// Stand-in for the CRM's POST /api/auth/login: any seeded, active person + the local password.
async function fakeCrmLogin(_url, init) {
  const { email, password } = JSON.parse(init.body || '{}');
  const { rows: [u] } = await db.query(`SELECT id, email, full_name, role FROM users WHERE lower(email) = lower($1) AND is_active IS NOT FALSE AND is_approved`, [String(email || '')]);
  if (!u || password !== PASSWORD) return { status: 401, async json() { return { success: false, message: 'Invalid email or password (local: use password "local")' }; } };
  const token = jwt.sign({ sub: u.id, role: u.role, aud: config.sessionAud }, SECRET, { expiresIn: '12h' });
  return { status: 200, async json() { return { success: true, token, user: { id: u.id, email: u.email, fullName: u.full_name, role: u.role } }; } };
}

const stack = createHttpStack({ config, db, fetchImpl: fakeCrmLogin });
await stack.calls?.sweepStaleCalls?.();

const dist = path.resolve(here, '..', '..', 'web', 'dist');
if (!existsSync(path.join(dist, 'index.html'))) console.warn('[local] the web app is not built — run: cd web && npm run build');

stack.httpServer.listen(PORT, '127.0.0.1', async () => {
  const { rows } = await db.query(`SELECT email, full_name, role FROM users WHERE is_active IS NOT FALSE ORDER BY id`);
  console.log(`[local] chat on http://localhost:${PORT}  (password for everyone: "${PASSWORD}")`);
  for (const u of rows) console.log(`        ${u.email.padEnd(8)} ${u.full_name} (${u.role})`);
});

process.on('unhandledRejection', (e) => console.error('[local] unhandled rejection', e));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stack.close().catch(() => {}); await pg.close().catch(() => {}); process.exit(0); });
