export const SEARCH_PAGE = 20;

export async function searchMessages(db, { userId, q, channelId = null, page = 1 }) {
  const query = String(q || '').trim();
  const p = Math.max(parseInt(page, 10) || 1, 1);
  if (!query) return { hits: [], page: 1, hasMore: false };
  const params = [userId, query, SEARCH_PAGE + 1, (p - 1) * SEARCH_PAGE];
  let scope = '';
  if (channelId) { params.push(channelId); scope = ` AND x.channel_id = $5`; }
  const { rows } = await db.query(
    `SELECT x.id, x.channel_id, c.display_name, c.type, c.name, u.full_name AS user_name, x.created_at,
            ts_headline('english', x.content, plainto_tsquery('english', $2), 'StartSel=<b>, StopSel=</b>, MaxWords=24, MinWords=8') AS snippet
       FROM chat.messages x
       JOIN chat.channel_members me ON me.channel_id = x.channel_id AND me.user_id = $1
       JOIN chat.channels c ON c.id = x.channel_id AND c.archived_at IS NULL
       JOIN public.users u ON u.id = x.user_id
      WHERE x.deleted_at IS NULL AND x.content_search @@ plainto_tsquery('english', $2)${scope}
      ORDER BY ts_rank(x.content_search, plainto_tsquery('english', $2)) DESC, x.created_at DESC
      LIMIT $3 OFFSET $4`, params);
  const hits = rows.slice(0, SEARCH_PAGE).map((r) => ({
    messageId: r.id, channelId: r.channel_id, channelName: r.type === 'dm' ? 'Direct message' : r.display_name || r.name,
    userName: r.user_name, snippet: r.snippet, createdAt: new Date(r.created_at).toISOString(),
  }));
  return { hits, page: p, hasMore: rows.length > SEARCH_PAGE };
}
