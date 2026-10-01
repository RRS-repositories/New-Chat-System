import { getMessage } from './messages.js';
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
export const PIN_LIMIT = 50;

export async function pinMessage(db, { messageId, userId }) {
  const { rows: [m] } = await db.query(`SELECT id, channel_id, pinned FROM chat.messages WHERE id = $1 AND deleted_at IS NULL`, [messageId]);
  if (!m) throw fail('not_found', 'Message not found', 404);
  if (!m.pinned) {
    const { rows: [{ n }] } = await db.query(`SELECT count(*) AS n FROM chat.messages WHERE channel_id = $1 AND pinned = true AND deleted_at IS NULL`, [m.channel_id]);
    if (Number(n) >= PIN_LIMIT) throw fail('pin_limit', `A channel can hold ${PIN_LIMIT} pinned messages`, 409);
    await db.query(`UPDATE chat.messages SET pinned = true, pinned_by = $2, pinned_at = now() WHERE id = $1`, [messageId, userId]);
    await db.query(`INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'message.pin', 'message', $2, $3)`, [userId, messageId, JSON.stringify({ channelId: m.channel_id })]);
  }
  return getMessage(db, messageId);
}

export async function unpinMessage(db, { messageId }) {
  await db.query(`UPDATE chat.messages SET pinned = false, pinned_by = NULL, pinned_at = NULL WHERE id = $1`, [messageId]);
  return getMessage(db, messageId);
}

export async function listPins(db, channelId) {
  const { rows } = await db.query(`SELECT id FROM chat.messages WHERE channel_id = $1 AND pinned = true AND deleted_at IS NULL ORDER BY pinned_at DESC, id DESC`, [channelId]);
  const out = [];
  for (const r of rows) { const m = await getMessage(db, r.id); if (m) out.push(m); }
  return out;
}
