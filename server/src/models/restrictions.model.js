import { toId } from '../utils/ids.js';

// Communication restrictions: a row (user_id = A, target_user_id = B, restriction) stops A
// contacting B. 'all' covers dm, call and channel. Channel restrictions are enforced both ways
// for private/group_dm membership, and so are dm restrictions (actor and joiner; any joiner pair
// in a group_dm) so a private channel cannot stand in for a DM; public channels are never
// restricted; 'call' is stored only.


const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
export const RESTRICTION_TYPES = ['all', 'dm', 'call', 'channel'];
/** The one refusal text for opening a DM or posting into one. */
export const DM_BLOCKED_MESSAGE = 'You cannot message this person';

const SELECT_SQL = `
  SELECT r.id, r.user_id, r.target_user_id, r.restriction, r.reason, r.restricted_by, r.created_at,
         u.full_name AS user_name, t.full_name AS target_name, b.full_name AS restricted_by_name
    FROM chat.communication_restrictions r
    LEFT JOIN public.users u ON u.id = r.user_id
    LEFT JOIN public.users t ON t.id = r.target_user_id
    LEFT JOIN public.users b ON b.id = r.restricted_by`;

const mapRestriction = (r) => ({
  id: r.id, userId: r.user_id, targetUserId: r.target_user_id, restriction: r.restriction, reason: r.reason || '',
  restrictedBy: r.restricted_by, createdAt: r.created_at,
  userName: r.user_name ?? null, targetName: r.target_name ?? null, restrictedByName: r.restricted_by_name ?? null,
});


/** Newest first. With `userId`: rows where that user is either side. */
export async function listRestrictions(db, { userId = null } = {}) {
  const id = userId == null ? null : toId(userId);
  if (userId != null && id === null) throw fail('bad_user', 'userId must be a user id');
  const { rows } = id === null
    ? await db.query(`${SELECT_SQL} ORDER BY r.created_at DESC, r.id`)
    : await db.query(`${SELECT_SQL} WHERE r.user_id = $1 OR r.target_user_id = $1 ORDER BY r.created_at DESC, r.id`, [id]);
  return rows.map(mapRestriction);
}

// A pg Pool hands each query to any free client, so BEGIN/COMMIT must run on one pinned
// client; PGlite and the test stubs have no connect() and are a single connection already.
export async function inTransaction(db, fn) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  let broken; // a client whose ROLLBACK failed must be discarded (release(err)), not pooled
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { broken = rollbackErr; }
    throw e;
  } finally {
    if (client !== db) client.release?.(broken);
  }
}

const UPSERT_SQL = `
  INSERT INTO chat.communication_restrictions (user_id, target_user_id, restriction, reason, restricted_by)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (user_id, target_user_id, restriction)
  DO UPDATE SET reason = EXCLUDED.reason, restricted_by = EXCLUDED.restricted_by
  RETURNING *`;

/** Adds (or re-reasons) A→B, and B→A too with `bothWays`, atomically. Returns the rows with names. */
export async function addRestriction(db, { userId, targetUserId, restriction, reason = '', restrictedBy, bothWays = false }) {
  const a = toId(userId), b = toId(targetUserId);
  if (!RESTRICTION_TYPES.includes(restriction)) throw fail('bad_restriction', 'restriction must be all, dm, call or channel');
  if (a === null || b === null) throw fail('bad_user', 'userId and targetUserId are required');
  if (a === b) throw fail('self_restriction', 'A person cannot be restricted from themselves');
  const why = String(reason ?? '').trim();
  const { rows: found } = await db.query(`SELECT id FROM public.users WHERE id = ANY($1::int[])`, [[a, b]]);
  if (found.length < 2) throw fail('unknown_user', 'User not found', 404);

  const pairs = bothWays ? [[a, b], [b, a]] : [[a, b]];
  const ids = await inTransaction(db, async (q) => {
    const out = [];
    for (const [from, to] of pairs) {
      const { rows: [row] } = await q.query(UPSERT_SQL, [from, to, restriction, why, restrictedBy]);
      await q.query(
        `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'restriction.add', 'restriction', $2, $3)`,
        [restrictedBy, String(row.id), JSON.stringify({ userId: from, targetUserId: to, restriction, reason: why, bothWays: !!bothWays })]);
      out.push(row.id);
    }
    return out;
  });
  const { rows } = await db.query(`${SELECT_SQL} WHERE r.id = ANY($1::uuid[]) ORDER BY r.user_id = $2 DESC`, [ids, a]);
  return rows.map(mapRestriction);
}

/** Deletes one row (never its reverse). Returns whether it existed. */
export async function removeRestriction(db, { id, actorId }) {
  const { rows: [row] } = await db.query(
    `DELETE FROM chat.communication_restrictions WHERE id = $1 RETURNING *`, [id]);
  if (!row) return false;
  await db.query(
    `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'restriction.remove', 'restriction', $2, $3)`,
    [actorId, String(row.id), JSON.stringify({ userId: row.user_id, targetUserId: row.target_user_id, restriction: row.restriction, reason: row.reason || '' })]);
  return true;
}

/** True when fromUserId may not contact toUserId by `kind` (dm | call | channel). */
export async function isBlocked(db, { fromUserId, toUserId, kind }) {
  const { rows } = await db.query(
    `SELECT 1 AS blocked FROM chat.communication_restrictions
      WHERE user_id = $1 AND target_user_id = $2 AND restriction IN ($3, 'all') LIMIT 1`, [fromUserId, toUserId, kind]);
  return rows.length > 0;
}

/**
 * Posting into a channel: when it is a DM, true if the sender may not message the other member
 * (dm/all). Any other channel type is never restricted here (and costs no restriction query).
 */
export async function dmPostBlocked(db, { channelId, userId }) {
  const { rows: [dm] } = await db.query(
    `SELECT o.user_id AS dm_other_id
       FROM chat.channels c JOIN chat.channel_members o ON o.channel_id = c.id AND o.user_id <> $2
      WHERE c.id = $1 AND c.type = 'dm' LIMIT 1`, [channelId, userId]);
  if (!dm) return false;
  return isBlocked(db, { fromUserId: userId, toUserId: Number(dm.dm_other_id), kind: 'dm' });
}

/**
 * Unordered pairs [low, high] among userIds with a row of `kind` (one kind or an array of kinds)
 * or 'all', in either direction, each once.
 */
export async function blockedPairs(db, { userIds, kind = 'channel' }) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length < 2) return [];
  const kinds = [...new Set([...(Array.isArray(kind) ? kind : [kind]), 'all'])];
  const { rows } = await db.query(
    `SELECT DISTINCT LEAST(user_id, target_user_id) AS a, GREATEST(user_id, target_user_id) AS b
       FROM chat.communication_restrictions
      WHERE user_id = ANY($1::int[]) AND target_user_id = ANY($1::int[]) AND restriction = ANY($2::text[])
      ORDER BY a, b`, [ids, kinds]);
  return rows.map((r) => [Number(r.a), Number(r.b)]);
}

/** Ids the user may not open a DM with (their own dm/all rows). */
export async function hiddenFromPicker(db, { forUserId }) {
  const { rows } = await db.query(
    `SELECT DISTINCT target_user_id FROM chat.communication_restrictions
      WHERE user_id = $1 AND restriction IN ('dm', 'all') ORDER BY target_user_id`, [forUserId]);
  return rows.map((r) => Number(r.target_user_id));
}

// ── Building blocks for the admin panel's bulk changes (rules live in services/access.service.js) ──

/** Every stored row between one person and a set of others, in both directions. */
export async function listPairRows(q, { userId, otherUserIds }) {
  const { rows } = await q.query(
    `SELECT user_id, target_user_id, restriction, reason FROM chat.communication_restrictions
      WHERE (user_id = $1 AND target_user_id = ANY($2::int[])) OR (target_user_id = $1 AND user_id = ANY($2::int[]))`,
    [userId, otherUserIds],
  );
  return rows;
}

/** Replaces everything stored for one direction (from → to) with the given rows. */
export async function replacePairRows(q, { fromUserId, toUserId, restrictions, reason, restrictedBy }) {
  await q.query(`DELETE FROM chat.communication_restrictions WHERE user_id = $1 AND target_user_id = $2`, [fromUserId, toUserId]);
  for (const restriction of restrictions) {
    await q.query(
      `INSERT INTO chat.communication_restrictions (user_id, target_user_id, restriction, reason, restricted_by) VALUES ($1, $2, $3, $4, $5)`,
      [fromUserId, toUserId, restriction, reason, restrictedBy],
    );
  }
}

export async function logAccessChange(q, { actorId, userId, detail }) {
  await q.query(
    `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'restriction.set_access', 'user', $2, $3)`,
    [actorId, String(userId), JSON.stringify(detail)],
  );
}
