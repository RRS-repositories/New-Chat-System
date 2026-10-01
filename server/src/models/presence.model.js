/** Records that a person was connected just now (written when they come online and when they go offline). */
export async function touchLastSeen(db, userId) {
  await db.query(
    `INSERT INTO chat.user_presence (user_id, last_seen_at) VALUES ($1, now())
  ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
    [userId],
  );
}
