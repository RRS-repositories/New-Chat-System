import { excerpt, likePattern, searchTerms } from '../utils/searchText.js';

export const SEARCH_PAGE = 20;

/**
 * Messages in the caller's channels that match the query, newest first. A message matches when
 *  - every word typed appears somewhere in its text or in its sender's name (part of a word counts,
 *    so "inv" finds "invoice" and "ann" finds everything Ann wrote), or
 *  - the full-text index matches (so "invoices" still finds "invoice").
 *
 * Built to stay fast on a large table (see migrations/chat_004_search_speed.sql): each word is its
 * own `content ILIKE` so the trigram index can be used, the senders a word names are looked up first
 * and matched by id, and newest-first lets the database stop as soon as it has a page.
 */
export async function searchMessages(db, { userId, q, channelId = null, page = 1 }) {
  const query = String(q || '').trim();
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const terms = searchTerms(query);
  if (!terms.length) return { hits: [], page: 1, hasMore: false };

  const patterns = terms.map(likePattern);
  const { rows: people } = await db.query(
    `SELECT id, full_name FROM public.users WHERE full_name ILIKE ANY ($1::text[])`,
    [patterns],
  );

  const params = [userId, query, SEARCH_PAGE + 1, (p - 1) * SEARCH_PAGE];
  const add = (value) => `$${params.push(value)}`;
  const everyWord = terms.map((term, i) => {
    const inText = `x.content ILIKE ${add(patterns[i])}`;
    const lower = term.toLowerCase();
    const senders = people.filter((u) => (u.full_name || '').toLowerCase().includes(lower)).map((u) => u.id);
    return senders.length ? `(${inText} OR x.user_id = ANY (${add(senders)}::int[]))` : inText;
  });
  const scope = channelId ? ` AND x.channel_id = ${add(channelId)}` : '';

  const { rows } = await db.query(
    `SELECT x.id, x.channel_id, x.user_id, c.display_name, c.type, c.name, u.full_name AS user_name, x.created_at, x.content,
            ts_headline('english', x.content, plainto_tsquery('english', $2), 'StartSel=<b>, StopSel=</b>, MaxWords=24, MinWords=8') AS headline
       FROM chat.messages x
       JOIN chat.channel_members me ON me.channel_id = x.channel_id AND me.user_id = $1
       JOIN chat.channels c ON c.id = x.channel_id AND c.archived_at IS NULL
       JOIN public.users u ON u.id = x.user_id
      WHERE x.deleted_at IS NULL
        AND (x.content_search @@ plainto_tsquery('english', $2) OR (${everyWord.join(' AND ')}))${scope}
      ORDER BY x.created_at DESC, x.id DESC
      LIMIT $3 OFFSET $4`,
    params,
  );
  const hits = rows.slice(0, SEARCH_PAGE).map((r) => ({
    messageId: r.id,
    channelId: r.channel_id,
    channelName: r.type === 'dm' ? 'Direct message' : r.display_name || r.name,
    userId: r.user_id,
    userName: r.user_name,
    snippet: excerpt(r.content, terms) ?? r.headline,
    createdAt: new Date(r.created_at).toISOString(),
  }));
  return { hits, page: p, hasMore: rows.length > SEARCH_PAGE };
}
