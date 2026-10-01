import { getChannel } from './channels.js';

const fail = (code, message, status) => Object.assign(new Error(message), { code, status });

/** Public, non-archived channels with membership count and whether the caller has joined. Ordered by displayName. */
export async function listPublicChannels(db, { userId }) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.display_name, c.purpose,
            (SELECT count(*) FROM chat.channel_members mm WHERE mm.channel_id = c.id) AS member_count,
            EXISTS (SELECT 1 FROM chat.channel_members m WHERE m.channel_id = c.id AND m.user_id = $1) AS joined
       FROM chat.channels c
      WHERE c.type = 'public' AND c.archived_at IS NULL
      ORDER BY c.display_name`, [userId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, displayName: r.display_name, purpose: r.purpose || '',
    memberCount: Number(r.member_count || 0), joined: !!r.joined,
  }));
}

/** Joins the caller to a PUBLIC channel only; idempotent. Only actually inserting a membership
 * row is audit-logged — a retry/double-click on an existing membership is a silent no-op, same
 * as addMembers in repo/channels.js. Returns { channel, joined } where joined is true only when
 * this call was the one that inserted the row. */
export async function joinPublicChannel(db, { channelId, userId }) {
  const { rows: [row] } = await db.query(`SELECT type, archived_at FROM chat.channels WHERE id = $1`, [channelId]);
  if (!row || row.archived_at) throw fail('not_found', 'Channel not found', 404);
  if (row.type !== 'public') throw fail('not_public', 'This channel is not public', 403);
  const { rows: inserted } = await db.query(
    `INSERT INTO chat.channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING RETURNING user_id`,
    [channelId, userId]);
  const joined = inserted.length > 0;
  if (joined) {
    await db.query(
      `INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'member.join', 'channel', $2, $3)`,
      [userId, channelId, JSON.stringify({})]);
  }
  return { channel: await getChannel(db, channelId), joined };
}
