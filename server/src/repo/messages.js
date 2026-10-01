// created_at_raw: the timestamp as Postgres prints it (microseconds intact) —
// the paging cursor is built from it. reply_* is the quoted message (Discord
// style); reply_count counts thread replies; reactions is aggregated JSON;
// files is aggregated JSON (chat.files rows for this message).
const SELECT = `SELECT x.id, x.channel_id, x.user_id, u.full_name AS user_name, x.content, x.type, x.created_at, x.created_at::text AS created_at_raw,
                       x.edited_at, x.reply_to_id, x.thread_id, x.pinned,
                       rp.user_id AS reply_user_id, ru.full_name AS reply_user_name, CASE WHEN rp.deleted_at IS NULL THEN rp.content ELSE '(deleted)' END AS reply_content,
                       (SELECT count(*) FROM chat.messages t WHERE t.thread_id = x.id AND t.deleted_at IS NULL) AS reply_count,
                       COALESCE((SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.n, 'user_ids', r.ids) ORDER BY r.first)
                                   FROM (SELECT emoji, count(*) AS n, array_agg(user_id ORDER BY created_at) AS ids, min(created_at) AS first
                                           FROM chat.reactions WHERE message_id = x.id GROUP BY emoji) r), '[]'::json) AS reactions,
                       COALESCE((SELECT json_agg(json_build_object('id', f.id, 'filename', f.filename, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes, 'has_thumb', f.thumbnail_path IS NOT NULL) ORDER BY f.created_at)
                                   FROM chat.files f WHERE f.message_id = x.id), '[]'::json) AS files
                  FROM chat.messages x
                  JOIN public.users u ON u.id = x.user_id
                  LEFT JOIN chat.messages rp ON rp.id = x.reply_to_id
                  LEFT JOIN public.users ru ON ru.id = rp.user_id`;

const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : (v || []));

const map = (r) => r && ({
  id: r.id, channelId: r.channel_id, userId: r.user_id, userName: r.user_name || '', content: r.content, type: r.type,
  createdAt: new Date(r.created_at).toISOString(), editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
  replyToId: r.reply_to_id || null, threadId: r.thread_id || null, pinned: !!r.pinned,
  replyTo: r.reply_to_id ? { id: r.reply_to_id, userId: r.reply_user_id ?? null, userName: r.reply_user_name || '', content: r.reply_content || '' } : null,
  replyCount: Number(r.reply_count || 0),
  reactions: parseJson(r.reactions).map((x) => ({ emoji: x.emoji, count: Number(x.count), userIds: (x.user_ids || []).map(Number) })),
  files: parseJson(r.files).map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mime_type, sizeBytes: Number(f.size_bytes), hasThumb: !!f.has_thumb })),
});

export function parseCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  const i = cursor.indexOf('|');
  if (i < 1) return null;
  const raw = cursor.slice(0, i); const id = cursor.slice(i + 1);
  const at = new Date(raw.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (isNaN(at.getTime()) || !id) return null;
  return { at, raw, id };
}

export async function listMessages(db, channelId, { before = null, limit = 50 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const cur = parseCursor(before);
  const params = [channelId, lim];
  let where = `x.channel_id = $1 AND x.deleted_at IS NULL AND x.thread_id IS NULL`;
  if (cur) { params.push(cur.raw, cur.id); where += ` AND (x.created_at, x.id) < ($3::timestamptz, $4)`; }
  const { rows } = await db.query(`${SELECT} WHERE ${where} ORDER BY x.created_at DESC, x.id DESC LIMIT $2`, params);
  const messages = rows.map(map).reverse();
  const oldest = rows[rows.length - 1];
  const nextCursor = rows.length === lim ? `${oldest.created_at_raw || messages[0].createdAt}|${oldest.id}` : null;
  return { messages, nextCursor };
}

export async function getMessage(db, messageId) {
  const { rows: [r] } = await db.query(`${SELECT} WHERE x.id = $1 AND x.deleted_at IS NULL`, [messageId]);
  return map(r) || null;
}

export async function createMessage(db, { channelId, userId, content, type = 'message', replyToId = null, threadId = null }) {
  // A reply/thread target must be a live message in the same channel; a thread
  // never nests — replying inside a thread files the message under the root.
  let rootId = threadId;
  for (const targetId of [replyToId, threadId].filter(Boolean)) {
    const { rows: [t] } = await db.query(`SELECT id, channel_id, thread_id FROM chat.messages WHERE id = $1 AND deleted_at IS NULL`, [targetId]);
    if (!t || t.channel_id !== channelId) throw fail('bad_reply', 'That message is not in this channel');
    if (targetId === threadId && t.thread_id) rootId = t.thread_id;
  }
  const { rows: [ins] } = await db.query(
    `INSERT INTO chat.messages (channel_id, user_id, content, type, reply_to_id, thread_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [channelId, userId, content, type, replyToId, rootId]);
  return getMessage(db, ins.id);
}

export async function listThread(db, rootId) {
  const root = await getMessage(db, rootId);
  if (!root) return null;
  const { rows } = await db.query(`${SELECT} WHERE x.thread_id = $1 AND x.deleted_at IS NULL ORDER BY x.created_at ASC, x.id ASC`, [rootId]);
  return { root, replies: rows.map(map) };
}

// A window around one message, for "jump to result": `radius` before and after.
export async function listAround(db, channelId, messageId, { radius = 25 } = {}) {
  // The comparison uses the raw Postgres timestamp (microseconds) — the ISO
  // value is cut to milliseconds and would let the target itself back into the
  // "after" query. x.id <> target belt-and-braces.
  const { rows: [raw] } = await db.query(`${SELECT} WHERE x.id = $1 AND x.deleted_at IS NULL`, [messageId]);
  const target = map(raw);
  if (!target || target.channelId !== channelId) return null;
  const at = raw.created_at_raw || target.createdAt;
  const { rows: before } = await db.query(
    `${SELECT} WHERE x.channel_id = $1 AND x.deleted_at IS NULL AND x.thread_id IS NULL AND x.id <> $3 AND (x.created_at, x.id) < ($2::timestamptz, $3) ORDER BY x.created_at DESC, x.id DESC LIMIT $4`,
    [channelId, at, target.id, radius]);
  const { rows: after } = await db.query(
    `${SELECT} WHERE x.channel_id = $1 AND x.deleted_at IS NULL AND x.thread_id IS NULL AND x.id <> $3 AND (x.created_at, x.id) > ($2::timestamptz, $3) ORDER BY x.created_at ASC, x.id ASC LIMIT $4`,
    [channelId, at, target.id, radius]);
  const messages = [...before.slice().reverse().map(map), target, ...after.map(map)];
  const oldest = before[before.length - 1];
  const nextCursor = before.length === radius && oldest ? `${oldest.created_at_raw}|${oldest.id}` : null;
  return { messages, nextCursor, target: messageId };
}

export async function editMessage(db, { messageId, userId, content }) {
  const { rows } = await db.query(
    `UPDATE chat.messages SET content = $3, edited_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`, [messageId, userId, content]);
  if (!rows.length) return null;
  return getMessage(db, messageId);
}

export async function deleteMessage(db, { messageId, userId, isChannelAdmin = false }) {
  const res = isChannelAdmin
    ? await db.query(`UPDATE chat.messages SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [messageId])
    : await db.query(`UPDATE chat.messages SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [messageId, userId]);
  return (res.rowCount || 0) > 0;
}
