// Copies Mattermost into the chat. Run on the server from the repository root:
//
//   MM_DATABASE_URL=postgres://user:pass@127.0.0.1:5433/mattermost MM_FILES_DIR=/opt/chat-import/files \
//   IMPORT_ACTOR_ID=<CRM user id> node server/dev/import-mattermost.mjs            dry run: counts only, nothing written
//   ... node server/dev/import-mattermost.mjs --commit                              the copy itself
//   options: --no-channels  --no-dms  --no-files
//
// MM_FILES_DIR holds a copy of Mattermost's data folder (the files are owned by the container's
// user, so copy them first with: sudo tar -C /opt/mattermost/data/mattermost -cf - . | tar -C $MM_FILES_DIR -xf -).
// See server/dev/import/mattermost.js for the rules.
import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../src/config/index.js';
import { createPool } from '../src/models/db.js';
import { runImport } from './import/mattermost.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '..', '..', '.env') });

const args = new Set(process.argv.slice(2));
const commit = args.has('--commit');
const mmUrl = process.env.MM_DATABASE_URL;
const filesDir = process.env.MM_FILES_DIR;
const actorId = Number(process.env.IMPORT_ACTOR_ID);
if (!mmUrl || !filesDir || !Number.isInteger(actorId)) {
  console.error('Set MM_DATABASE_URL, MM_FILES_DIR and IMPORT_ACTOR_ID (see the top of this file).');
  process.exit(2);
}

const config = loadConfig();
const db = createPool(config);
const client = await db.connect(); // one connection: the whole copy is one transaction
const mmPool = new pg.Pool({ connectionString: mmUrl, max: 2 });
const mm = async (sql, params = []) => (await mmPool.query(sql, params)).rows;
const readMmFile = (relPath) => readFile(path.join(filesDir, relPath)).catch(() => null);

console.log(
  `${commit ? 'COPYING' : 'DRY RUN (add --commit to copy)'} into ${config.dbHost}/${config.dbName}, files to ${config.uploadsDir}`,
);
const started = Date.now();
try {
  const counts = await runImport({
    db: client,
    mm,
    readFile: readMmFile,
    uploadsDir: config.uploadsDir,
    actorId,
    commit,
    channels: !args.has('--no-channels'),
    dms: !args.has('--no-dms'),
    files: !args.has('--no-files'),
  });
  console.log(JSON.stringify(counts, null, 2));
  console.log(`${commit ? 'done' : 'dry run finished'} in ${Math.round((Date.now() - started) / 1000)} s`);
} finally {
  client.release();
  await db.end();
  await mmPool.end();
}
