// Profile photos. Kept on the person's chat.user_preferences row: where the file is (under the
// uploads folder) and when it last changed. Chat-only: the CRM's users table is never touched.

/** The address a browser fetches the photo from. The time makes a new photo a new address, so it is never stale. */
export const avatarUrl = (userId, updatedAt) =>
  updatedAt ? `/api/chat/users/${userId}/avatar?v=${new Date(updatedAt).getTime()}` : null;

/** SQL for "this person's photo address, or NULL" given a user-id expression, for use inside other queries. */
export const AVATAR_COLUMNS = (userIdSql) =>
  `(SELECT ap.avatar_updated_at FROM chat.user_preferences ap WHERE ap.user_id = ${userIdSql} AND ap.avatar_path IS NOT NULL) AS avatar_updated_at`;

export async function getAvatar(db, userId) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT avatar_path, avatar_updated_at FROM chat.user_preferences WHERE user_id = $1 AND avatar_path IS NOT NULL`,
    [userId],
  );
  return r ? { path: r.avatar_path, updatedAt: r.avatar_updated_at } : null;
}

/** Saves the new photo's path and returns the old one (to delete its file), or null. */
export async function setAvatar(db, userId, relPath, at = new Date()) {
  const old = await getAvatar(db, userId);
  await db.query(
    `INSERT INTO chat.user_preferences (user_id, avatar_path, avatar_updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET avatar_path = EXCLUDED.avatar_path, avatar_updated_at = EXCLUDED.avatar_updated_at, updated_at = now()`,
    [userId, relPath, at],
  );
  return old?.path ?? null;
}

/** Removes the photo and returns its path (to delete the file), or null when there was none. */
export async function clearAvatar(db, userId) {
  const old = await getAvatar(db, userId);
  if (!old) return null;
  await db.query(
    `UPDATE chat.user_preferences SET avatar_path = NULL, avatar_updated_at = NULL, updated_at = now() WHERE user_id = $1`,
    [userId],
  );
  return old.path;
}

/** { [userId]: photo address } for everyone who has a photo and can still sign in. */
export async function listAvatars(db) {
  const { rows } = await db.query(
    `SELECT p.user_id, p.avatar_updated_at
       FROM chat.user_preferences p JOIN public.users u ON u.id = p.user_id AND u.is_active IS NOT FALSE AND u.is_approved
      WHERE p.avatar_path IS NOT NULL ORDER BY p.user_id`,
  );
  const out = {};
  for (const r of rows) out[r.user_id] = avatarUrl(r.user_id, r.avatar_updated_at);
  return out;
}
