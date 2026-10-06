import { AVATAR_COLUMNS, avatarUrl } from './avatars.model.js';
import { markMentionsRead } from './mentions.model.js';

const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const TYPES = new Set(['public', 'private', 'group_dm']);

export const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
export const dmKey = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;

const mapChannel = (r) =>
  r && {
    id: r.id,
    name: r.name,
    displayName: r.display_name,
    type: r.type,
    purpose: r.purpose || '',
    header: r.header || '',
    unreadCount: Number(r.unread_count || 0),
    mentionCount: Number(r.mention_count || 0),
    lastMessageAt: r.last_message_at || null,
    dmUserId: r.dm_user_id ?? null,
    dmUserName: r.dm_user_name ?? null,
    memberCount: Number(r.member_count || 0),
    // The caller's own notification level for this channel; only the per-user list query knows it.
    notifyPref: r.notify_pref || 'default',
    favourite: !!r.favourite,
  };

const CHANNEL_LIST_SQL = `
  SELECT c.id, c.name, c.display_name, c.type, c.purpose, c.header,
         (SELECT count(*) FROM chat.messages x WHERE x.channel_id = c.id AND x.deleted_at IS NULL AND x.thread_id IS NULL
            AND x.created_at > m.last_read_at AND x.user_id <> m.user_id) AS unread_count,
         (SELECT count(*) FROM chat.mentions mn JOIN chat.messages mx ON mx.id = mn.message_id AND mx.deleted_at IS NULL
            WHERE mn.channel_id = c.id AND mn.user_id = m.user_id AND mn.read = false) AS mention_count,
         (SELECT max(created_at) FROM chat.messages x WHERE x.channel_id = c.id AND x.deleted_at IS NULL) AS last_message_at,
         (SELECT count(*) FROM chat.channel_members mm WHERE mm.channel_id = c.id) AS member_count,
         du.id AS dm_user_id, du.full_name AS dm_user_name, m.notify_pref, m.favourite
    FROM chat.channel_members m
    JOIN chat.channels c ON c.id = m.channel_id AND c.archived_at IS NULL
    LEFT JOIN LATERAL (
      SELECT u.id, u.full_name FROM chat.channel_members o JOIN public.users u ON u.id = o.user_id
       WHERE c.type = 'dm' AND o.channel_id = c.id AND o.user_id <> m.user_id LIMIT 1) du ON true
   WHERE m.user_id = $1
   ORDER BY c.type = 'dm', last_message_at DESC NULLS LAST, c.display_name`;

export async function listChannelsForUser(db, userId) {
  const { rows } = await db.query(CHANNEL_LIST_SQL, [userId]);
  return rows.map(mapChannel);
}

export async function getChannel(db, channelId) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT c.*, (SELECT count(*) FROM chat.channel_members mm WHERE mm.channel_id = c.id) AS member_count
       FROM chat.channels c WHERE c.id = $1 AND c.archived_at IS NULL`,
    [channelId],
  );
  return mapChannel(r) || null;
}

export async function isMember(db, channelId, userId) {
  // An archived channel has no members as far as the chat is concerned: nothing in it can be read or posted.
  const { rows } = await db.query(
    `SELECT 1 AS ok FROM chat.channel_members WHERE channel_id = $1 AND user_id = $2
        AND EXISTS (SELECT 1 FROM chat.channels c WHERE c.id = $1 AND c.archived_at IS NULL)`,
    [channelId, userId],
  );
  return rows.length > 0;
}

export const NAME_MAX = 80;
export const PURPOSE_MAX = 250;

/** Changes a channel's shown name and/or purpose (its internal name stays). Returns the channel, or null if it is gone. */
export async function updateChannel(db, channelId, { displayName, purpose, actorId }) {
  const changes = {};
  if (displayName !== undefined) {
    const name = String(displayName ?? '').trim();
    if (!name || name.length > NAME_MAX) throw fail('bad_name', `A channel name needs 1 to ${NAME_MAX} characters`);
    changes.display_name = name;
  }
  if (purpose !== undefined) {
    const text = String(purpose ?? '').trim();
    if (text.length > PURPOSE_MAX) throw fail('bad_purpose', `A purpose can be up to ${PURPOSE_MAX} characters`);
    changes.purpose = text;
  }
  const columns = Object.keys(changes);
  if (!columns.length) throw fail('nothing_to_change', 'Give a new name or purpose');
  const sets = columns.map((column, i) => `${column} = $${i + 2}`).join(', ');
  const { rowCount } = await db.query(
    `UPDATE chat.channels SET ${sets}, updated_at = now() WHERE id = $1 AND archived_at IS NULL`,
    [channelId, ...columns.map((column) => changes[column])],
  );
  if (!rowCount) return null;
  await db.query(
    `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'channel.rename', 'channel', $2, $3)`,
    [actorId, channelId, JSON.stringify(changes)],
  );
  return getChannel(db, channelId);
}

/** Hides a channel from everyone. Its messages stay in the database. False when it was already archived. */
export async function archiveChannel(db, channelId, { actorId, reason = 'archived' }) {
  const { rowCount } = await db.query(
    `UPDATE chat.channels SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL`,
    [channelId],
  );
  if (!rowCount) return false;
  await db.query(
    `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'channel.archive', 'channel', $2, $3)`,
    [actorId, channelId, JSON.stringify({ reason })],
  );
  return true;
}

export async function countMembers(db, channelId) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM chat.channel_members WHERE channel_id = $1`, [
    channelId,
  ]);
  return rows[0].n;
}

const cleanIds = (ids) => [...new Set((ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];

export async function createChannel(db, { name, displayName, type, purpose = '', createdBy, memberIds = [] }) {
  const display = String(displayName || '').trim();
  const slug = slugify(name || display);
  if (!display || !slug) throw fail('bad_name', 'Channel needs a name');
  if (!TYPES.has(type)) throw fail('bad_type', 'type must be public, private or group_dm');
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO chat.channels (name, display_name, type, purpose, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [slug, display, type, purpose, createdBy],
  );
  const ids = cleanIds([createdBy, ...memberIds]);
  await db.query(
    `INSERT INTO chat.channel_members (channel_id, user_id, role)
     SELECT $1, u, CASE WHEN u = $2 THEN 'owner' ELSE 'member' END FROM unnest($3::int[]) AS u
     ON CONFLICT DO NOTHING`,
    [row.id, createdBy, ids],
  );
  return mapChannel(row);
}

// The conflict target is the full (workspace_id, name) constraint: name = dm_key
// for a DM, and Postgres cannot use the partial dm_key index for ON CONFLICT.
// DO UPDATE (not DO NOTHING) so the loser of a race still gets the row back.
export async function openDm(db, userId, otherUserId) {
  if (userId === otherUserId) throw fail('self_dm', 'You cannot message yourself');
  const key = dmKey(userId, otherUserId);
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO chat.channels (name, display_name, type, dm_key, created_by)
     VALUES ($1, '', 'dm', $1, $2)
     ON CONFLICT (workspace_id, name) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [key, userId],
  );
  await db.query(
    `INSERT INTO chat.channel_members (channel_id, user_id, role) SELECT $1, u, 'member' FROM unnest($2::int[]) AS u ON CONFLICT DO NOTHING`,
    [row.id, [userId, otherUserId]],
  );
  const {
    rows: [other],
  } = await db.query(`SELECT id, full_name FROM public.users WHERE id = $1`, [otherUserId]);
  return { ...mapChannel(row), dmUserId: otherUserId, dmUserName: other?.full_name || null };
}

/** Adds members; returns the ids that were actually inserted (already-members are skipped). */
export async function addMembers(db, channelId, userIds, addedBy) {
  const ids = cleanIds(userIds);
  if (!ids.length) return [];
  const { rows } = await db.query(
    `INSERT INTO chat.channel_members (channel_id, user_id, role) SELECT $1, u, 'member' FROM unnest($2::int[]) AS u ON CONFLICT DO NOTHING RETURNING user_id`,
    [channelId, ids],
  );
  const inserted = rows.map((r) => r.user_id);
  if (inserted.length) {
    await db.query(
      `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'member.add', 'channel', $2, $3)`,
      [addedBy, channelId, JSON.stringify({ userIds: inserted })],
    );
  }
  return inserted;
}

/** Everyone belongs to #general: idempotent join, run on each channel list. */
export async function ensureDefaultMembership(db, userId) {
  await db.query(
    `INSERT INTO chat.channel_members (channel_id, user_id, role)
     SELECT c.id, $1, 'member' FROM chat.channels c WHERE c.name = 'general' AND c.type = 'public' AND c.archived_at IS NULL
     ON CONFLICT DO NOTHING`,
    [userId],
  );
}

export async function removeMember(db, channelId, userId) {
  const { rowCount } = await db.query(`DELETE FROM chat.channel_members WHERE channel_id = $1 AND user_id = $2`, [
    channelId,
    userId,
  ]);
  return (rowCount || 0) > 0;
}

export async function listMembers(db, channelId) {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.role, m.role AS channel_role, ${AVATAR_COLUMNS('u.id')}
       FROM chat.channel_members m JOIN public.users u ON u.id = m.user_id
      WHERE m.channel_id = $1 ORDER BY u.full_name`,
    [channelId],
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    role: r.role,
    channelRole: r.channel_role,
    avatarUrl: avatarUrl(r.id, r.avatar_updated_at),
  }));
}

/** The person's own star on a conversation. Null when they are not in it. */
export async function setFavourite(db, channelId, userId, on) {
  const {
    rows: [r],
  } = await db.query(
    `UPDATE chat.channel_members SET favourite = $3 WHERE channel_id = $1 AND user_id = $2 RETURNING favourite`,
    [channelId, userId, on === true],
  );
  return r ? !!r.favourite : null;
}

/**
 * Marks a conversation unread again: the newest message from someone else becomes unread. Returns
 * how many are unread afterwards (0 when nobody else has written), or null when the person is not in it.
 */
export async function markUnread(db, channelId, userId) {
  const {
    rows: [r],
  } = await db.query(
    `UPDATE chat.channel_members m
        SET last_read_at = COALESCE(
          (SELECT max(x.created_at) - interval '1 millisecond' FROM chat.messages x
            WHERE x.channel_id = $1 AND x.deleted_at IS NULL AND x.thread_id IS NULL AND x.user_id <> $2),
          m.last_read_at)
      WHERE m.channel_id = $1 AND m.user_id = $2
      RETURNING (SELECT count(*) FROM chat.messages x WHERE x.channel_id = $1 AND x.deleted_at IS NULL
                   AND x.thread_id IS NULL AND x.created_at > m.last_read_at AND x.user_id <> $2) AS unread_count`,
    [channelId, userId],
  );
  return r ? Number(r.unread_count || 0) : null;
}

export async function markRead(db, channelId, userId, at = new Date()) {
  await db.query(
    `UPDATE chat.channel_members SET last_read_at = GREATEST(last_read_at, $3) WHERE channel_id = $1 AND user_id = $2`,
    [channelId, userId, at],
  );
  await markMentionsRead(db, channelId, userId);
  return { unreadCount: 0, mentionCount: 0 };
}

/** The ids of every channel a person is in (their live connection joins one room per channel). */
export async function listChannelIdsForUser(db, userId) {
  const { rows } = await db.query(`SELECT channel_id FROM chat.channel_members WHERE user_id = $1`, [userId]);
  return rows.map((r) => r.channel_id);
}
