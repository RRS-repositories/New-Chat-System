import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/chat_001_schema.sql', import.meta.url), 'utf8');

test('every user FK is INT, never UUID', () => {
  for (const m of sql.matchAll(/(\w+)\s+(UUID|INT)\s+(?:NOT NULL\s+)?(?:PRIMARY KEY\s+)?REFERENCES users\(id\)/g)) {
    assert.equal(m[2], 'INT', `${m[1]} references users(id) as ${m[2]}`);
  }
  assert.ok(/REFERENCES users\(id\)/.test(sql));
});

test('all twelve tables, idempotent, transactional', () => {
  for (const t of ['channels','channel_members','messages','files','mentions','reactions','calls','call_participants','communication_restrictions','user_preferences','audit_log','push_subscriptions']) {
    assert.ok(new RegExp(`CREATE TABLE IF NOT EXISTS chat\\.${t}\\b`).test(sql), t);
  }
  const body = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim();
  assert.ok(body.startsWith('BEGIN;') && body.endsWith('COMMIT;'), 'first statement BEGIN, last COMMIT');
});

test('one DM per pair: dm_key unique', () => {
  assert.ok(/dm_key\s+TEXT/.test(sql));
  assert.ok(/UNIQUE INDEX IF NOT EXISTS idx_channels_dm_key ON chat\.channels\(dm_key\)/.test(sql));
});
