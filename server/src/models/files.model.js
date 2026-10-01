const mapFile = (r) =>
  r && {
    id: r.id,
    channelId: r.channel_id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    filePath: r.file_path,
    thumbnailPath: r.thumbnail_path || null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    messageId: r.message_id || null,
  };

export async function insertFile(
  db,
  { messageId, channelId, userId, filename, mimeType, sizeBytes, filePath, thumbnailPath },
) {
  const {
    rows: [r],
  } = await db.query(
    `INSERT INTO chat.files (message_id, channel_id, user_id, filename, mime_type, size_bytes, file_path, thumbnail_path) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [messageId, channelId, userId, filename, mimeType, sizeBytes, filePath, thumbnailPath],
  );
  return mapFile(r);
}

/** A file is only reachable while its message is live: deleting the message withdraws the file. */
export async function getFile(db, fileId) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT f.* FROM chat.files f JOIN chat.messages m ON m.id = f.message_id WHERE f.id = $1 AND m.deleted_at IS NULL`,
    [fileId],
  );
  return mapFile(r) || null;
}

export async function listChannelFiles(db, channelId, { before = null, limit = 30 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const params = [channelId, lim];
  let where = `f.channel_id = $1 AND m.deleted_at IS NULL`;
  const i = typeof before === 'string' ? before.indexOf('|') : -1;
  if (i > 0) {
    params.push(before.slice(0, i), before.slice(i + 1));
    where += ` AND (f.created_at, f.id) < ($3::timestamptz, $4)`;
  }
  const { rows } = await db.query(
    `SELECT f.*, f.created_at::text AS created_at_raw, u.full_name AS user_name FROM chat.files f JOIN chat.messages m ON m.id = f.message_id JOIN public.users u ON u.id = f.user_id
      WHERE ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT $2`,
    params,
  );
  const files = rows.map((r) => ({ ...mapFile(r), userName: r.user_name }));
  const last = rows[rows.length - 1];
  return { files, nextCursor: rows.length === lim && last ? `${last.created_at_raw}|${last.id}` : null };
}
