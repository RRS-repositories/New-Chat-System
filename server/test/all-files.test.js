// ============================================================================
// test/all-files.test.js — every document in one place
// ============================================================================
// Run: node --test test/all-files.test.js
//
// The owner asked for one screen showing every document sent (13 Oct 2026).
// Per-channel listing already existed; this one has no channel to check first,
// so membership has to be enforced inside the query. These tests are about that
// above all else: without it, one endpoint would hand every file in the firm to
// anybody signed in. No database — a stand-in records the SQL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAllFilesForUser } from '../src/models/files.model.js';

function makeDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

const row = (over = {}) => ({
  id: 'f1',
  message_id: 'm1',
  channel_id: 'c1',
  user_id: 7,
  file_name: 'pack.pdf',
  file_path: 'a/b',
  mime_type: 'application/pdf',
  size_bytes: 10,
  created_at: new Date('2026-10-13T09:00:00Z'),
  created_at_raw: '2026-10-13 09:00:00+00',
  user_name: 'Someone',
  channel_name: 'ADMIN',
  channel_type: 'private',
  ...over,
});

// --- the thing that matters most -----------------------------------------

test('only files from channels the asker is a member of are returned', async () => {
  const db = makeDb();
  await listAllFilesForUser(db, 42);
  const { sql, params } = db.calls[0];
  assert.match(sql, /EXISTS \(SELECT 1 FROM chat\.channel_members cm/,
    'membership must be checked in the query');
  assert.match(sql, /cm\.channel_id = f\.channel_id AND cm\.user_id = \$1/);
  assert.equal(params[0], 42, 'the asker must be the first parameter');
});

test('a deleted message takes its file out of the list', async () => {
  const db = makeDb();
  await listAllFilesForUser(db, 42);
  assert.match(db.calls[0].sql, /m\.deleted_at IS NULL/);
});

// --- paging ---------------------------------------------------------------

test('newest first, and the page size is capped', async () => {
  const db = makeDb();
  await listAllFilesForUser(db, 42, { limit: 5000 });
  assert.match(db.calls[0].sql, /ORDER BY f\.created_at DESC, f\.id DESC/);
  assert.equal(db.calls[0].params[1], 100, 'a silly limit must be capped');
});

test('a silly or missing limit cannot ask for everything', async () => {
  // Deliberately the same clamp as listChannelFiles: unparseable or zero falls back
  // to 30, a negative is pinned to 1. Diverging from the per-channel listing would be
  // a worse outcome than the slightly odd -5 -> 1, and nothing sends a negative limit.
  for (const [given, expected] of [[undefined, 30], [0, 30], [-5, 1], ['abc', 30], [10, 10]]) {
    const db = makeDb();
    await listAllFilesForUser(db, 42, { limit: given });
    assert.equal(db.calls[0].params[1], expected, String(given));
  }
});

test('the cursor pages backwards through time without skipping a tie', async () => {
  const db = makeDb();
  await listAllFilesForUser(db, 42, { before: '2026-10-13 09:00:00+00|f9' });
  const { sql, params } = db.calls[0];
  // Comparing the pair, not just the timestamp: two files uploaded in the same
  // moment would otherwise hide each other.
  assert.match(sql, /\(f\.created_at, f\.id\) < \(\$3::timestamptz, \$4\)/);
  assert.equal(params[2], '2026-10-13 09:00:00+00');
  assert.equal(params[3], 'f9');
});

test('a cursor with no separator is ignored rather than trusted', async () => {
  const db = makeDb();
  await listAllFilesForUser(db, 42, { before: 'rubbish' });
  assert.ok(!/\(f\.created_at, f\.id\) </.test(db.calls[0].sql));
  assert.equal(db.calls[0].params.length, 2);
});

test('a next cursor is only offered when the page was full', async () => {
  const full = Array.from({ length: 30 }, (_, i) => row({ id: `f${i}` }));
  const db = makeDb(full);
  const page = await listAllFilesForUser(db, 42, { limit: 30 });
  assert.ok(page.nextCursor, 'a full page should offer more');

  const partial = makeDb([row()]);
  const last = await listAllFilesForUser(partial, 42, { limit: 30 });
  assert.equal(last.nextCursor, null, 'a short page is the end');
});

// --- searching by name ----------------------------------------------------

test('a name search is a parameter, never spliced into the SQL', async () => {
  const db = makeDb();
  await listAllFilesForUser(db, 42, { q: "'; DROP TABLE chat.files; --" });
  const { sql, params } = db.calls[0];
  assert.ok(!sql.includes('DROP TABLE'), 'the search text must not reach the SQL');
  assert.match(sql, /f\.file_name ILIKE \$\d+/);
  assert.ok(params.some((p) => String(p).includes('DROP TABLE')), 'it belongs in the parameters');
});

test('an empty search is no search at all', async () => {
  for (const q of ['', '   ', null, undefined]) {
    const db = makeDb();
    await listAllFilesForUser(db, 42, { q });
    assert.ok(!/ILIKE/.test(db.calls[0].sql), JSON.stringify(q));
  }
});

// --- what comes back ------------------------------------------------------

test('each file says who sent it and which channel it came from', async () => {
  const db = makeDb([row()]);
  const { files } = await listAllFilesForUser(db, 42);
  assert.equal(files[0].userName, 'Someone');
  assert.equal(files[0].channelName, 'ADMIN');
});

test('a direct message is not named after its channel', async () => {
  // DM channels have no display name, and naming one after its members would put
  // somebody's name on a list that may be read by others.
  const db = makeDb([row({ channel_type: 'dm', channel_name: '' })]);
  const { files } = await listAllFilesForUser(db, 42);
  assert.equal(files[0].channelName, 'Direct message');
});
