/**
 * Where an automatic message from the CRM lands.
 *
 * The CRM names a channel the way a person would say it ("ADMIN", "Payments Dept"),
 * or names a person by email for a direct message. Nothing here knows a channel id:
 * ids change when channels are rebuilt, names are what the CRM's ~150 call sites can
 * sensibly carry. Matching ignores case and spacing so "PAYMENTS DEPT",
 * "Payments Dept" and "payments-dept" all find the same channel.
 */
import { addMembers, openDm } from '../models/channels.model.js';

const fail = (code, message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
};

/** "PAYMENTS DEPT", "payments_dept" and "Payments  Dept" all reduce to the same thing. */
const squash = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');

/** The channel a name refers to. Archived channels and direct messages are never a target. */
export async function resolveChannelByName(db, name) {
  const wanted = squash(name);
  if (!wanted) throw fail('no_target', 'Give a channel or an email');
  const { rows } = await db.query(
    `SELECT id, display_name, name FROM chat.channels
      WHERE archived_at IS NULL AND type IN ('public','private')`,
  );
  const hit =
    rows.find((r) => squash(r.display_name) === wanted) || rows.find((r) => squash(r.name) === wanted);
  if (!hit)
    throw fail('no_such_channel', `No channel called "${name}". Automatic messages are never posted to a channel that does not exist.`, 404);
  return hit;
}

/** The direct-message channel between the bot and the person with this email. */
export async function resolveDmByEmail(db, botUserId, email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) throw fail('no_target', 'Give a channel or an email');
  const {
    rows: [person],
  } = await db.query(`SELECT id, full_name FROM users WHERE lower(email) = $1 AND COALESCE(is_active, true) LIMIT 1`, [
    address,
  ]);
  if (!person) throw fail('no_such_person', `Nobody active here has the email ${address}`, 404);
  if (person.id === botUserId) throw fail('bad_target', 'The bot cannot message itself');
  const channel = await openDm(db, botUserId, person.id);
  return { id: channel.id, display_name: person.full_name, name: channel.name };
}

/**
 * The bot has to be in a channel for the channel to behave normally — unread counts,
 * the sidebar, who is listed. Joining is idempotent.
 */
export async function ensureBotInChannel(db, channelId, botUserId) {
  await addMembers(db, channelId, [botUserId], botUserId);
}

/**
 * A card becomes text. Mattermost drew coloured attachments; this chat has no such
 * thing, and inventing one would mean a screen change for 13 call sites. Bold title,
 * the body, then the fields as plain lines — which is what the cards said anyway.
 */
export function renderCard(card, fallbackText = '') {
  if (!card || typeof card !== 'object') return fallbackText;
  const lines = [];
  if (card.title) lines.push(`**${String(card.title).trim()}**`);
  const body = card.text || fallbackText;
  if (body) lines.push(String(body).trim());
  for (const field of Array.isArray(card.fields) ? card.fields : []) {
    const label = String(field?.label ?? field?.title ?? '').trim();
    const value = String(field?.value ?? '').trim();
    if (label && value) lines.push(`• **${label}:** ${value}`);
    else if (value) lines.push(`• ${value}`);
  }
  return lines.join('\n');
}
