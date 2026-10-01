const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
export const EMOJI_MAX = 8;
const okEmoji = (e) => typeof e === 'string' && e.length >= 1 && e.length <= EMOJI_MAX && !/[<>&"'\s]/.test(e);

export async function addReaction(db, { messageId, userId, emoji }) {
  if (!okEmoji(emoji)) throw fail('bad_emoji', 'That is not an emoji');
  const { rows } = await db.query(`INSERT INTO chat.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1 AS ok`, [messageId, userId, emoji]);
  return rows.length > 0;
}
export async function removeReaction(db, { messageId, userId, emoji }) {
  if (!okEmoji(emoji)) throw fail('bad_emoji', 'That is not an emoji');
  const { rows } = await db.query(`DELETE FROM chat.reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING 1 AS ok`, [messageId, userId, emoji]);
  return rows.length > 0;
}
