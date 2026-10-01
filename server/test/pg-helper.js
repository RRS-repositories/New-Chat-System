import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * Real Postgres in-process (PGlite). Users: 1 Meg Manager (Management), 2 Ann Agent (cs_agent),
 * 3 Bob Sales (Sales), 4 Gone User (inactive), 5 Cy Sales (Sales). CRM permission tables exist
 * with the 'chat.beta' key defined and no grants. users.role is the user_role enum, as in the CRM. Both chat migrations applied (#general seeded
 * with users 1, 2, 3, 5).
 */
export async function createTestDb() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TYPE user_role AS ENUM ('Management','IT','Payments','Admin','Sales','cs_agent');
    CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT, full_name TEXT, role user_role, is_approved BOOLEAN DEFAULT TRUE, is_active BOOLEAN DEFAULT TRUE, sessions_valid_from TIMESTAMPTZ);
    INSERT INTO users (email, full_name, role) VALUES ('m@x', 'Meg Manager', 'Management'), ('a@x', 'Ann Agent', 'cs_agent'), ('b@x', 'Bob Sales', 'Sales');
    INSERT INTO users (email, full_name, role, is_active) VALUES ('gone@x', 'Gone User', 'Sales', FALSE);
    INSERT INTO users (email, full_name, role) VALUES ('c@x', 'Cy Sales', 'Sales');
    CREATE TABLE account_locks (user_id INT, unlocked_at TIMESTAMPTZ);
    CREATE TABLE permissions (key TEXT PRIMARY KEY, category TEXT, label TEXT, is_sensitive BOOLEAN DEFAULT FALSE);
    CREATE TABLE roles (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE role_permissions (role_id INT, permission_key TEXT, PRIMARY KEY (role_id, permission_key));
    CREATE TABLE user_permissions (user_id INT, permission_key TEXT, PRIMARY KEY (user_id, permission_key));
    INSERT INTO permissions (key, category, label) VALUES ('chat.beta', 'chat', 'Team chat (beta)');
    INSERT INTO roles (name) VALUES ('Management'), ('IT'), ('Sales'), ('cs_agent');
  `);
  for (const f of ['chat_001_schema.sql', 'chat_002_rich.sql', 'chat_003_notify_calls.sql']) await pg.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  const db = { async query(sql, params = []) { const r = await pg.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };
  return { pg, db, close: () => pg.close() };
}
