// The connection pool: every connection must look in the chat schema first, set when the
// connection opens (not by a query fired afterwards, which races with the first real query).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../src/models/db.js';

const config = { dbHost: 'db.invalid', dbPort: 5432, dbName: 'x', dbUser: 'x', dbPassword: 'x', dbSsl: false };

test('search_path is a connection start-up option, with no query on connect', async () => {
  const pool = createPool(config);
  try {
    assert.equal(pool.options.options, '-c search_path=chat,public');
    assert.equal(pool.listenerCount('connect'), 0, 'nothing runs a query when a connection opens');
    assert.equal(pool.options.max, 10);
  } finally {
    await pool.end();
  }
});
