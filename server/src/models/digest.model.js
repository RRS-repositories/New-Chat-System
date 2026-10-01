// Queries for the daily digest email of unread mentions.

// Unread mentions per person and channel — the same definition as the sidebar's mention count
// (unread, message not deleted, channel not archived) — for approved, active people with an
// email address who are still in the channel, have not muted it, have been away more than
// 12 hours and have not had a digest in the last 20.
const UNREAD_MENTIONS_SQL = `
  SELECT u.id AS user_id, u.email, c.type, c.display_name, count(*)::int AS n
    FROM users u
    JOIN chat.mentions mn ON mn.user_id = u.id AND mn.read = false
    JOIN chat.messages mx ON mx.id = mn.message_id AND mx.deleted_at IS NULL
    JOIN chat.channels c ON c.id = mn.channel_id AND c.archived_at IS NULL
    JOIN chat.channel_members cm ON cm.channel_id = c.id AND cm.user_id = u.id AND cm.notify_pref <> 'nothing'
    LEFT JOIN chat.user_presence p ON p.user_id = u.id
    LEFT JOIN chat.user_preferences up ON up.user_id = u.id
   WHERE u.is_approved = TRUE AND u.is_active IS NOT FALSE
     AND COALESCE(u.email, '') <> ''
     AND (p.last_seen_at IS NULL OR p.last_seen_at < $1::timestamptz - interval '12 hours')
     AND (up.last_digest_at IS NULL OR up.last_digest_at < $1::timestamptz - interval '20 hours')
   GROUP BY u.id, u.email, c.id, c.type, c.display_name
   ORDER BY u.id, n DESC, c.display_name`;

/** One row per person and channel with unread mentions, as of `at`. */
export async function listUnreadMentionsForDigest(db, at) {
  return (await db.query(UNREAD_MENTIONS_SQL, [at])).rows;
}

/** Remembers that this person's digest went out at `at`, so they are not mailed again too soon. */
export async function markDigestSent(db, userId, at) {
  await db.query(
    `INSERT INTO chat.user_preferences (user_id, last_digest_at) VALUES ($1, $2::timestamptz)
             ON CONFLICT (user_id) DO UPDATE SET last_digest_at = EXCLUDED.last_digest_at`,
    [userId, at],
  );
}
