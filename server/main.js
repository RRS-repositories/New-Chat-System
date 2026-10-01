// Chat service: its own pm2 process on port 5020. Settings come from the `.env` file in the repository folder
// (on the server that file is a link to the CRM's settings; see deploy/SERVER.md).
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config/index.js';
import { createPool } from './src/models/db.js';
import { createHttpStack } from './src/server.js';
import { startDigest } from './src/services/digest/digest.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '..', '.env') });

const config = loadConfig();
const db = createPool(config);
const stack = createHttpStack({ config, db });
// A restart ends whatever calls were live (their sockets are gone), and the
// optional daily digest starts only when CHAT_DIGEST_ENABLED=true.
stack.calls.sweepStaleCalls().catch((e) => console.error('[chat] stale call sweep failed', e.message));
const digest = startDigest({ db, config, isConnected: (userId) => stack.presence.isConnected(userId) });

stack.httpServer.listen(config.port, '127.0.0.1', () =>
  console.log(`[chat] listening on 127.0.0.1:${config.port} (redis adapter: ${config.redisUrl ? 'on' : 'off'})`),
);

process.on('uncaughtException', (e) => {
  console.error('[chat] uncaught', e);
});
process.on('unhandledRejection', (e) => {
  console.error('[chat] unhandled rejection', e);
});

async function shutdown(sig) {
  console.log(`[chat] ${sig} — closing`);
  digest.stop();
  await stack.close().catch(() => {});
  await db.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
