// Real Postgres (PGlite) coverage for the chat.beta gate: role bypass (Management/IT),
// a direct user_permissions grant, and a role_permissions grant applying to every user
// with that role. The regex-stubbed unit tests in auth.test.js cannot vouch for the SQL
// itself, only for how loadSessionUser/requireAuth/socketAuth react to its result.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSessionUser } from '../src/models/users.model.js';
import { createTestDb } from './pg-helper.js';

const { db, close } = await createTestDb();
after(() => close());

test('user 3 (Sales, no permission row) is not chat-enabled', async () => {
  const u = await loadSessionUser(db, { userId: 3, iat: null });
  assert.equal(u.chatEnabled, false);
});

test('granting chat.beta via user_permissions enables that one user', async () => {
  await db.query(`INSERT INTO user_permissions (user_id, permission_key) VALUES (3, 'chat.beta')`);
  const u3 = await loadSessionUser(db, { userId: 3, iat: null });
  assert.equal(u3.chatEnabled, true);
  // Cy Sales (user 5) has the same role but no grant of their own yet.
  const u5 = await loadSessionUser(db, { userId: 5, iat: null });
  assert.equal(u5.chatEnabled, false);
});

test('granting chat.beta via role_permissions for Sales enables every Sales user', async () => {
  const {
    rows: [role],
  } = await db.query(`SELECT id FROM roles WHERE name = 'Sales'`);
  await db.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'chat.beta')`, [role.id]);
  const u5 = await loadSessionUser(db, { userId: 5, iat: null });
  assert.equal(u5.chatEnabled, true);
});

test('Management (user 1) is chat-enabled regardless of any permission row', async () => {
  const u = await loadSessionUser(db, { userId: 1, iat: null });
  assert.equal(u.chatEnabled, true);
});

test('cs_agent (user 2, no grant) is not chat-enabled', async () => {
  const u = await loadSessionUser(db, { userId: 2, iat: null });
  assert.equal(u.chatEnabled, false);
});

// The CRM's loadUserPermissions: any user_permissions row makes that set the whole permission
// set (role defaults stop applying); role_permissions count only for users with no rows.
// (Sales has the role grant from the test above.)
test('role grant applies to a user with no personal permission rows', async () => {
  const {
    rows: [u],
  } = await db.query(`INSERT INTO users (email, full_name, role) VALUES ('d@x', 'Di Sales', 'Sales') RETURNING id`);
  const got = await loadSessionUser(db, { userId: u.id, iat: null });
  assert.equal(got.chatEnabled, true);
});

test('role grant does NOT apply to a user with some other personal permission row', async () => {
  const {
    rows: [u],
  } = await db.query(`INSERT INTO users (email, full_name, role) VALUES ('e@x', 'Ed Sales', 'Sales') RETURNING id`);
  await db.query(`INSERT INTO user_permissions (user_id, permission_key) VALUES ($1, 'reports.view')`, [u.id]);
  const got = await loadSessionUser(db, { userId: u.id, iat: null });
  assert.equal(got.chatEnabled, false);
});

test('personal chat.beta applies regardless of role rows', async () => {
  // cs_agent has no role grant; this user also holds an unrelated personal row.
  const {
    rows: [u],
  } = await db.query(`INSERT INTO users (email, full_name, role) VALUES ('f@x', 'Fi Agent', 'cs_agent') RETURNING id`);
  await db.query(
    `INSERT INTO user_permissions (user_id, permission_key) VALUES ($1, 'reports.view'), ($1, 'chat.beta')`,
    [u.id],
  );
  const got = await loadSessionUser(db, { userId: u.id, iat: null });
  assert.equal(got.chatEnabled, true);
  // Bob (Sales, whose role has the grant) keeps his personal chat.beta as well.
  assert.equal((await loadSessionUser(db, { userId: 3, iat: null })).chatEnabled, true);
});
