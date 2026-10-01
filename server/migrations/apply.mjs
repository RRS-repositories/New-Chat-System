// Applies the database files in this folder to the database named in the settings file.
//
//   node server/migrations/apply.mjs                              DRY RUN: lists what would run, changes nothing
//   node server/migrations/apply.mjs --commit                     applies every file, in order
//   node server/migrations/apply.mjs --commit --only=chat_004_x.sql   applies one file
//
// Dry run is the default because on the server the settings point at the live database.
// Every file is written so it can be run again safely, and carries its own BEGIN/COMMIT.
import { config as loadEnv } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/index.js';
import { createPool } from '../src/models/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '..', '..', '.env') });

const commit = process.argv.includes('--commit');
const only = (process.argv.find((arg) => arg.startsWith('--only=')) || '').split('=')[1] || null;

const config = loadConfig();
const db = createPool(config);

const files = (await readdir(here)).filter((f) => /^chat_\d{3}_.*\.sql$/.test(f) && (!only || f === only)).sort();
const { rows } = await db.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'chat' ORDER BY 1`,
);
console.log(`Database: ${config.dbHost}/${config.dbName}`);
console.log(`Chat tables now: ${rows.map((r) => r.table_name).join(', ') || '(none)'}`);
console.log(`${commit ? 'APPLYING' : 'DRY RUN (add --commit to apply)'}: ${files.join(', ') || '(no files)'}`);

if (commit) {
  for (const file of files) {
    const client = await db.connect();
    try {
      await client.query(await readFile(path.join(here, file), 'utf8'));
      console.log(`done   ${file}`);
    } catch (e) {
      console.error(`FAILED ${file}: ${e.message}`);
      await client.query('ROLLBACK').catch(() => {});
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }
}
await db.end();
