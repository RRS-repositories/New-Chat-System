/** One statement. Never mentions the author. Returns the number of rows written. */
export async function insertMentions(db, { messageId, channelId, authorId, userIds, all }) {
  if (all) {
    const { rowCount } = await db.query(
      `INSERT INTO chat.mentions (message_id, channel_id, user_id, type)
       SELECT $1, $2, m.user_id, 'all' FROM chat.channel_members m WHERE m.channel_id = $2 AND m.user_id <> $3
       ON CONFLICT DO NOTHING`,
      [messageId, channelId, authorId],
    );
    return rowCount || 0;
  }
  const ids = [...new Set(userIds.filter((id) => id !== authorId))];
  if (!ids.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO chat.mentions (message_id, channel_id, user_id, type)
     SELECT $1, $2, u, 'user' FROM unnest($4::int[]) AS u WHERE u <> $3 AND EXISTS (SELECT 1 FROM chat.channel_members m WHERE m.channel_id = $2 AND m.user_id = u)`,
    [messageId, channelId, authorId, ids],
  );
  return rowCount || 0;
}

export async function markMentionsRead(db, channelId, userId) {
  await db.query(`UPDATE chat.mentions SET read = true WHERE channel_id = $1 AND user_id = $2 AND read = false`, [
    channelId,
    userId,
  ]);
}
