// Web Push subscriptions and the member/preference rows the notifier decides on.
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

const parseKeys = (k) => (typeof k === 'string' ? JSON.parse(k) : k);

/**
 * Upsert by endpoint: a browser re-subscribing under another login moves the endpoint to
 * the caller. Then keep only the caller's newest MAX_SUBSCRIPTIONS_PER_USER.
 */
export async function saveSubscription(db, { userId, endpoint, keys, userAgent = '' }) {
  await db.query(
    `INSERT INTO chat.push_subscriptions (user_id, endpoint, keys, user_agent) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys,
       user_agent = EXCLUDED.user_agent, created_at = now()`,
    [userId, endpoint, JSON.stringify(keys), userAgent]);
  await db.query(
    `DELETE FROM chat.push_subscriptions WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM chat.push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2)`,
    [userId, MAX_SUBSCRIPTIONS_PER_USER]);
}

/** Only the caller's own. Returns whether a row was removed. */
export async function removeSubscription(db, { userId, endpoint }) {
  const { rowCount } = await db.query(`DELETE FROM chat.push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint]);
  return rowCount > 0;
}

/** A dead subscription (push service answered 404/410). */
export async function deleteSubscriptionByEndpoint(db, endpoint) {
  await db.query(`DELETE FROM chat.push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function subscriptionsForUsers(db, userIds) {
  if (!userIds.length) return [];
  const { rows } = await db.query(`SELECT user_id, endpoint, keys FROM chat.push_subscriptions WHERE user_id = ANY($1::int[])`, [userIds]);
  return rows.map((r) => ({ userId: r.user_id, endpoint: r.endpoint, keys: parseKeys(r.keys) }));
}

const mapMember = (r) => ({ userId: r.user_id, notifyPref: r.notify_pref, desktopNotif: r.desktop_notif });

/**
 * One query: the channel and its active, approved members other than the sender, with the
 * channel-level notify_pref and the user's desktop_notif (default 'mentions').
 * `channel` is null when the channel does not exist.
 */
export async function messageCandidates(db, { channelId, senderId }) {
  const { rows } = await db.query(
    `SELECT c.id, c.type, c.display_name, x.user_id, x.notify_pref, x.desktop_notif
       FROM chat.channels c
       LEFT JOIN (
         SELECT m.channel_id, m.user_id, m.notify_pref, COALESCE(p.desktop_notif, 'mentions') AS desktop_notif
           FROM chat.channel_members m
           JOIN users u ON u.id = m.user_id AND u.is_active IS NOT FALSE AND u.is_approved
           LEFT JOIN chat.user_preferences p ON p.user_id = m.user_id
          WHERE m.channel_id = $1 AND m.user_id <> $2
       ) x ON x.channel_id = c.id
      WHERE c.id = $1 AND c.archived_at IS NULL`, [channelId, senderId]);
  if (!rows.length) return { channel: null, members: [] };
  const [c] = rows;
  return {
    channel: { id: c.id, type: c.type, displayName: c.display_name },
    members: rows.filter((r) => r.user_id != null).map(mapMember),
  };
}

/** The listed users who are active, approved members of the channel, with both preferences. */
export async function callCandidates(db, { channelId, userIds }) {
  if (!userIds.length) return [];
  const { rows } = await db.query(
    `SELECT m.user_id, m.notify_pref, COALESCE(p.desktop_notif, 'mentions') AS desktop_notif
       FROM chat.channel_members m
       JOIN chat.channels c ON c.id = m.channel_id AND c.archived_at IS NULL
       JOIN users u ON u.id = m.user_id AND u.is_active IS NOT FALSE AND u.is_approved
       LEFT JOIN chat.user_preferences p ON p.user_id = m.user_id
      WHERE m.channel_id = $1 AND m.user_id = ANY($2::int[])`, [channelId, userIds]);
  return rows.map(mapMember);
}
