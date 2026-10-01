const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @all / @channel → everyone; @Full Name or @FirstName → a member (the client
 * matches the same way). A first name shared by two members is ambiguous and
 * matches nobody on its own. Longest names first so "@Ann Agent" is not read
 * as "@Ann".
 */
export function parseMentions(content, members) {
  const text = String(content || '');
  if (/(^|[^\w@])@(all|channel)\b/i.test(text)) return { userIds: [], all: true };
  const firstCounts = new Map();
  for (const m of members) { const f = (m.fullName || '').trim().split(/\s+/)[0]?.toLowerCase(); if (f) firstCounts.set(f, (firstCounts.get(f) || 0) + 1); }
  const candidates = [];
  for (const m of members) {
    const full = (m.fullName || '').trim(); if (!full) continue;
    candidates.push({ id: m.id, name: full });
    const first = full.split(/\s+/)[0];
    if (first !== full && firstCounts.get(first.toLowerCase()) === 1) candidates.push({ id: m.id, name: first });
  }
  candidates.sort((a, b) => b.name.length - a.name.length);
  const ids = [];
  let rest = text;
  for (const c of candidates) {
    const re = new RegExp(`(^|[^\\w@])@${esc(c.name)}(?![\\w])`, 'i');
    if (re.test(rest)) { ids.push(c.id); rest = rest.replace(re, '$1 '); }
  }
  return { userIds: [...new Set(ids)], all: false };
}

/** One statement. Never mentions the author. Returns the number of rows written. */
export async function insertMentions(db, { messageId, channelId, authorId, userIds, all }) {
  if (all) {
    const { rowCount } = await db.query(
      `INSERT INTO chat.mentions (message_id, channel_id, user_id, type)
       SELECT $1, $2, m.user_id, 'all' FROM chat.channel_members m WHERE m.channel_id = $2 AND m.user_id <> $3
       ON CONFLICT DO NOTHING`, [messageId, channelId, authorId]);
    return rowCount || 0;
  }
  const ids = [...new Set(userIds.filter((id) => id !== authorId))];
  if (!ids.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO chat.mentions (message_id, channel_id, user_id, type)
     SELECT $1, $2, u, 'user' FROM unnest($4::int[]) AS u WHERE u <> $3 AND EXISTS (SELECT 1 FROM chat.channel_members m WHERE m.channel_id = $2 AND m.user_id = u)`,
    [messageId, channelId, authorId, ids]);
  return rowCount || 0;
}

export async function markMentionsRead(db, channelId, userId) {
  await db.query(`UPDATE chat.mentions SET read = true WHERE channel_id = $1 AND user_id = $2 AND read = false`, [channelId, userId]);
}
