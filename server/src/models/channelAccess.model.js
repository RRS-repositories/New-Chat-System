// Per-channel access: a person blocked from a channel (by Management or IT) is removed from it and
// cannot join it or be added to it until allowed again. Everyone stays in General.
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

/** Every public and private channel, with whether this person is in it and whether they are blocked from it. */
export async function listChannelAccess(db, userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.display_name, c.type,
            EXISTS (SELECT 1 FROM chat.channel_members m WHERE m.channel_id = c.id AND m.user_id = $1) AS member,
            EXISTS (SELECT 1 FROM chat.channel_blocks b WHERE b.channel_id = c.id AND b.user_id = $1) AS blocked,
            (c.name = 'general' AND c.type = 'public') AS is_general
       FROM chat.channels c
      WHERE c.type IN ('public', 'private') AND c.archived_at IS NULL
      ORDER BY lower(c.display_name)`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    type: r.type,
    member: !!r.member,
    blocked: !!r.blocked,
    isGeneral: !!r.is_general,
  }));
}

export async function isChannelBlocked(db, { userId, channelId }) {
  const { rows } = await db.query(`SELECT 1 FROM chat.channel_blocks WHERE user_id = $1 AND channel_id = $2`, [
    userId,
    channelId,
  ]);
  return rows.length > 0;
}

/** Of these people, the ones blocked from the channel. */
export async function blockedUserIds(db, { channelId, userIds }) {
  if (!userIds.length) return [];
  const { rows } = await db.query(
    `SELECT user_id FROM chat.channel_blocks WHERE channel_id = $1 AND user_id = ANY($2::int[])`,
    [channelId, userIds],
  );
  return rows.map((r) => Number(r.user_id));
}

/**
 * Allows or blocks a person for one channel. Blocking removes them from the channel at once.
 * Returns whether they were a member just before (so the caller can tell them and the channel).
 */
export async function setChannelAccess(db, { userId, channelId, allowed, actorId }) {
  const {
    rows: [channel],
  } = await db.query(`SELECT id, name, type, display_name FROM chat.channels WHERE id = $1 AND archived_at IS NULL`, [
    channelId,
  ]);
  if (!channel) throw fail('not_found', 'Channel not found', 404);
  if (channel.type === 'dm' || channel.type === 'group_dm') throw fail('dm_fixed', 'Not a channel', 403);
  if (channel.name === 'general' && channel.type === 'public')
    throw fail('default_channel', 'Everyone stays in General', 403);
  if (allowed) {
    await db.query(`DELETE FROM chat.channel_blocks WHERE user_id = $1 AND channel_id = $2`, [userId, channelId]);
    await db.query(
      `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'channel.allow', 'channel', $2, $3)`,
      [actorId, channelId, JSON.stringify({ userId, channel: channel.display_name })],
    );
    return { removed: false };
  }
  await db.query(
    `INSERT INTO chat.channel_blocks (user_id, channel_id, blocked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [userId, channelId, actorId],
  );
  const { rowCount } = await db.query(`DELETE FROM chat.channel_members WHERE user_id = $1 AND channel_id = $2`, [
    userId,
    channelId,
  ]);
  await db.query(
    `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'channel.block', 'channel', $2, $3)`,
    [actorId, channelId, JSON.stringify({ userId, channel: channel.display_name, removed: (rowCount || 0) > 0 })],
  );
  return { removed: (rowCount || 0) > 0 };
}
