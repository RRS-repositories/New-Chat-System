// Call rows (chat.calls, chat.call_participants). Timestamps are passed in by the call
// service (its injectable clock) so durations are exact and testable. One live
// (ringing/active) call per channel is enforced by the unique index idx_calls_one_live.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const iso = (v) => (v ? new Date(v).toISOString() : null);

const CALL_SQL = `
  SELECT c.id, c.channel_id, c.initiated_by, u.full_name AS initiated_by_name, c.type, c.status,
         c.started_at, c.ended_at, c.duration_secs, c.created_at
    FROM chat.calls c JOIN public.users u ON u.id = c.initiated_by`;

const mapCall = (r) =>
  r && {
    id: r.id,
    channelId: r.channel_id,
    initiatedBy: Number(r.initiated_by),
    initiatedByName: r.initiated_by_name || '',
    type: r.type,
    status: r.status,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    durationSecs: r.duration_secs == null ? null : Number(r.duration_secs),
    createdAt: iso(r.created_at),
  };

const LIVE = `('ringing','active')`;

/** Inserts a ringing voice call with the starter as its first participant (one statement). */
export async function createCall(db, { channelId, initiatedBy, at = new Date() }) {
  let id;
  try {
    const {
      rows: [row],
    } = await db.query(
      `WITH c AS (INSERT INTO chat.calls (channel_id, initiated_by, type, status, created_at) VALUES ($1, $2, 'voice', 'ringing', $3) RETURNING id),
            p AS (INSERT INTO chat.call_participants (call_id, user_id, joined_at) SELECT id, $2, $3 FROM c)
       SELECT id FROM c`,
      [channelId, initiatedBy, at],
    );
    id = row.id;
  } catch (e) {
    if (e.code !== '23505') throw e;
    const live = await getLiveCall(db, channelId);
    throw Object.assign(new Error('A call is already in progress in this channel'), {
      status: 409,
      code: 'call_in_progress',
      callId: live?.id ?? null,
    });
  }
  return getCall(db, id);
}

export async function getCall(db, callId) {
  if (!isUuid(callId)) return null;
  const {
    rows: [r],
  } = await db.query(`${CALL_SQL} WHERE c.id = $1`, [callId]);
  return mapCall(r) || null;
}

export async function getLiveCall(db, channelId) {
  if (!isUuid(channelId)) return null;
  const {
    rows: [r],
  } = await db.query(`${CALL_SQL} WHERE c.channel_id = $1 AND c.status IN ${LIVE} LIMIT 1`, [channelId]);
  return mapCall(r) || null;
}

/** Newest first. */
export async function listCalls(db, channelId, { limit = 30 } = {}) {
  if (!isUuid(channelId)) return [];
  const { rows } = await db.query(`${CALL_SQL} WHERE c.channel_id = $1 ORDER BY c.created_at DESC, c.id LIMIT $2`, [
    channelId,
    limit,
  ]);
  return rows.map(mapCall);
}

/** Current participants (left_at IS NULL), in join order. */
export async function listParticipants(db, callId) {
  const { rows } = await db.query(
    `SELECT p.user_id, u.full_name, p.is_sharing_screen FROM chat.call_participants p JOIN public.users u ON u.id = p.user_id
      WHERE p.call_id = $1 AND p.left_at IS NULL ORDER BY p.joined_at, p.user_id`,
    [callId],
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    userName: r.full_name || '',
    isSharingScreen: !!r.is_sharing_screen,
  }));
}

/** Everyone who was ever in the call, in join order (for the summary message). */
export async function participantNames(db, callId) {
  const { rows } = await db.query(
    `SELECT u.full_name FROM chat.call_participants p JOIN public.users u ON u.id = p.user_id
      WHERE p.call_id = $1 ORDER BY p.joined_at, p.user_id`,
    [callId],
  );
  return rows.map((r) => r.full_name || '');
}

/** Joins (or re-joins, keeping the original join position). */
export async function addParticipant(db, { callId, userId, at = new Date() }) {
  await db.query(
    `INSERT INTO chat.call_participants (call_id, user_id, joined_at) VALUES ($1, $2, $3)
     ON CONFLICT (call_id, user_id) DO UPDATE SET left_at = NULL, is_sharing_screen = false`,
    [callId, userId, at],
  );
}

export async function removeParticipant(db, { callId, userId, at = new Date() }) {
  const {
    rows: [r],
  } = await db.query(
    `WITH old AS (SELECT is_sharing_screen FROM chat.call_participants WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL)
     UPDATE chat.call_participants SET left_at = $3, is_sharing_screen = false
      WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL
      RETURNING (SELECT is_sharing_screen FROM old) AS was_sharing`,
    [callId, userId, at],
  );
  return { wasParticipant: !!r, wasSharing: !!r?.was_sharing };
}

/** ringing → active; null when the call was not ringing. */
export async function activateCall(db, { callId, at = new Date() }) {
  const { rows } = await db.query(
    `UPDATE chat.calls SET status = 'active', started_at = $2 WHERE id = $1 AND status = 'ringing' RETURNING id`,
    [callId, at],
  );
  return rows.length ? getCall(db, callId) : null;
}

const DURATION = `CASE WHEN started_at IS NULL THEN 0 ELSE GREATEST(0, floor(EXTRACT(EPOCH FROM ($2::timestamptz - started_at))))::int END`;

/** Ends a live call with `status` and marks everyone left; null when it was already over. */
export async function finishCall(db, { callId, status, at = new Date() }) {
  const { rows } = await db.query(
    `UPDATE chat.calls SET status = $3, ended_at = $2, duration_secs = ${DURATION}
      WHERE id = $1 AND status IN ${LIVE} RETURNING id`,
    [callId, at, status],
  );
  if (!rows.length) return null;
  await db.query(
    `UPDATE chat.call_participants SET left_at = $2, is_sharing_screen = false WHERE call_id = $1 AND left_at IS NULL`,
    [callId, at],
  );
  return getCall(db, callId);
}

/** → 'changed' | 'unchanged' | 'not_in_call' | 'already_sharing' (someone else is sharing). */
export async function setScreenShare(db, { callId, userId, on }) {
  const { rows } = await db.query(
    `SELECT user_id, is_sharing_screen FROM chat.call_participants WHERE call_id = $1 AND left_at IS NULL`,
    [callId],
  );
  const me = rows.find((r) => Number(r.user_id) === Number(userId));
  if (!me) return 'not_in_call';
  if (!!me.is_sharing_screen === !!on) return 'unchanged';
  if (on) {
    // The NOT EXISTS keeps the one-sharer rule in the statement itself.
    const { rows: done } = await db.query(
      `UPDATE chat.call_participants SET is_sharing_screen = true
        WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM chat.call_participants o WHERE o.call_id = $1 AND o.user_id <> $2 AND o.left_at IS NULL AND o.is_sharing_screen)
        RETURNING user_id`,
      [callId, userId],
    );
    return done.length ? 'changed' : 'already_sharing';
  }
  await db.query(`UPDATE chat.call_participants SET is_sharing_screen = false WHERE call_id = $1 AND user_id = $2`, [
    callId,
    userId,
  ]);
  return 'changed';
}

/** Boot: every ringing/active call is over (its sockets are gone). Returns how many were ended. */
export async function sweepStaleCalls(db, { at = new Date() } = {}) {
  const { rows } = await db.query(
    `UPDATE chat.calls SET status = 'ended', ended_at = $1,
            duration_secs = CASE WHEN started_at IS NULL THEN 0 ELSE GREATEST(0, floor(EXTRACT(EPOCH FROM ($1::timestamptz - started_at))))::int END
      WHERE status IN ${LIVE} RETURNING id`,
    [at],
  );
  if (rows.length) {
    await db.query(
      `UPDATE chat.call_participants SET left_at = $2, is_sharing_screen = false WHERE call_id = ANY($1::uuid[]) AND left_at IS NULL`,
      [rows.map((r) => r.id), at],
    );
  }
  return rows.length;
}
