/**
 * Copies Mattermost into the chat: channels and one-to-one conversations, their messages (with
 * threads, pins, edits, files and reactions), keeping the original dates.
 *
 * The rules, chosen by the owner on 6 Oct 2026:
 *  - only people who have signed in to Mattermost AND have a CRM account with the same email;
 *    messages by anyone else are left out (and so are conversations with them);
 *  - no messages from the CRM's bots and automations;
 *  - files over the chat's limit, or of a type the chat does not take, are left out;
 *  - group conversations are not copied yet.
 *
 * Runs again safely: chat.import_map remembers what was already copied. In a dry run nothing is
 * written (one transaction, rolled back at the end) and no file is copied.
 *
 * `mm` is a function that runs a query against the Mattermost database; `readFile(path)` returns
 * the bytes of a Mattermost file by its stored path (or null when it is missing).
 */
import { saveUpload, makeThumbnail, ALLOWED_MIME, MAX_FILE_BYTES } from '../../src/services/files/storage.js';
import { openDm, slugify } from '../../src/models/channels.model.js';
import { MAX_MESSAGE_LENGTH } from '../../src/utils/sanitize.js';
import { emojiOf } from './emoji.js';

const BATCH = 500;
/** Mattermost's two default channels: everyone's channel lands in the chat's General; the empty one is skipped. */
const GENERAL_NAMES = new Set(['town-square']);
const SKIP_NAMES = new Set(['off-topic']);

const ms = (n) => new Date(Number(n));
const isBotPost = (post) => {
  const props = typeof post.props === 'string' ? post.props : JSON.stringify(post.props || {});
  return /from_webhook|from_bot/.test(props);
};
/** "text/csv; charset=utf-8" → "text/csv" */
export const normaliseMime = (mime) =>
  String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

/**
 * Mattermost writes mentions as @username; the chat matches @Full Name (or @First). Known people
 * are rewritten; anything else (email addresses, unknown names) is left as it is. Over-long text
 * is cut at the chat's limit with a note.
 */
export function convertContent(message, usernames) {
  let text = String(message || '').replace(/\r\n/g, '\n');
  if (usernames.size) {
    text = text.replace(/(^|[^\w@.-])@([a-z0-9._-]+)/gi, (whole, before, name) => {
      const full = usernames.get(name.toLowerCase());
      return full ? `${before}@${full}` : whole;
    });
  }
  text = text.replace(/(^|[^\w@])@(all|channel|here)\b/gi, '$1@all');
  if (text.length > MAX_MESSAGE_LENGTH)
    text = `${text.slice(0, MAX_MESSAGE_LENGTH - 40).trimEnd()}\n\n[cut: the original was longer]`;
  return text;
}

export async function runImport({
  db,
  mm,
  readFile,
  uploadsDir,
  actorId,
  commit = false,
  channels = true,
  dms = true,
  files = true,
  log = console.log,
}) {
  const counts = {
    people: 0,
    peopleWithoutAccount: 0,
    channelsCopied: 0,
    channelsReused: 0,
    channelsSkipped: 0,
    dmsCopied: 0,
    dmsSkipped: 0,
    messages: 0,
    messagesAlreadyHere: 0,
    messagesLeftOut: 0,
    threadReplies: 0,
    files: 0,
    filesLeftOut: 0,
    reactions: 0,
    reactionsLeftOut: 0,
  };

  // ---- people: Mattermost people who signed in, matched to CRM accounts by email
  const mmUsers = await mm(
    `SELECT u.id, u.username, lower(u.email) AS email, trim(u.firstname || ' ' || u.lastname) AS name
       FROM users u
      WHERE u.deleteat = 0
        AND NOT EXISTS (SELECT 1 FROM bots b WHERE b.userid = u.id)
        AND (u.lastlogin > 0 OR EXISTS (SELECT 1 FROM status s WHERE s.userid = u.id AND s.lastactivityat > 0))`,
  );
  const crmUsers = await db.query(
    `SELECT id, lower(email) AS email, full_name FROM public.users WHERE email IS NOT NULL`,
  );
  const crmByEmail = new Map(crmUsers.rows.map((r) => [r.email, r]));
  const userMap = new Map(); // mm user id -> crm user id
  const usernames = new Map(); // mm username -> crm full name (for mentions)
  for (const u of mmUsers) {
    const crm = crmByEmail.get(u.email);
    if (!crm) {
      counts.peopleWithoutAccount++;
      continue;
    }
    userMap.set(u.id, crm.id);
    usernames.set(String(u.username).toLowerCase(), crm.full_name || u.name);
    counts.people++;
  }
  const mapped = (mmUserId) => userMap.get(mmUserId) ?? null;
  log(
    `people: ${counts.people} matched to a CRM account; ${counts.peopleWithoutAccount} signed in to Mattermost but have no CRM account`,
  );

  const map = await db.query(`SELECT kind, source_id, target_id FROM chat.import_map`);
  const done = new Map(map.rows.map((r) => [`${r.kind}:${r.source_id}`, r.target_id]));
  const remember = async (kind, sourceId, targetId) => {
    done.set(`${kind}:${sourceId}`, targetId);
    await db.query(
      `INSERT INTO chat.import_map (kind, source_id, target_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [kind, sourceId, targetId],
    );
  };

  await db.query('BEGIN');
  try {
    const targets = []; // { mmChannelId, chatChannelId, label }

    // ---- channels
    if (channels) {
      const rows = await mm(
        `SELECT c.id, c.name, c.displayname, c.type, c.purpose, c.creatorid, c.createat
           FROM channels c WHERE c.deleteat = 0 AND c.type IN ('O', 'P') ORDER BY c.createat`,
      );
      for (const c of rows) {
        if (SKIP_NAMES.has(c.name)) {
          counts.channelsSkipped++;
          continue;
        }
        const members = await mm(`SELECT userid, schemeadmin FROM channelmembers WHERE channelid = $1`, [c.id]);
        const memberIds = [...new Set(members.map((m) => mapped(m.userid)).filter(Boolean))];
        const existing = done.get(`channel:${c.id}`);
        let chatChannelId = existing || null;
        if (!chatChannelId) {
          const slug = GENERAL_NAMES.has(c.name) ? 'general' : slugify(c.name || c.displayname);
          const found = await db.query(`SELECT id, type FROM chat.channels WHERE name = $1 AND archived_at IS NULL`, [
            slug,
          ]);
          if (found.rows[0]) {
            chatChannelId = found.rows[0].id;
            counts.channelsReused++;
          } else {
            const postCount = await mm(
              `SELECT count(*)::int AS n FROM posts WHERE channelid = $1 AND deleteat = 0 AND type = ''`,
              [c.id],
            );
            if (!memberIds.length && !postCount[0]?.n) {
              counts.channelsSkipped++;
              continue;
            }
            const createdBy = mapped(c.creatorid) ?? memberIds[0] ?? actorId;
            const inserted = await db.query(
              `INSERT INTO chat.channels (name, display_name, type, purpose, created_by, created_at)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
              [
                slug,
                c.displayname || c.name,
                c.type === 'O' ? 'public' : 'private',
                String(c.purpose || '').slice(0, 250),
                createdBy,
                ms(c.createat),
              ],
            );
            chatChannelId = inserted.rows[0].id;
            counts.channelsCopied++;
          }
          await remember('channel', c.id, chatChannelId);
        }
        // Members: Mattermost's people join the chat channel (already-members are left as they are).
        const admins = new Set(members.filter((m) => m.schemeadmin && mapped(m.userid)).map((m) => mapped(m.userid)));
        if (memberIds.length)
          await db.query(
            `INSERT INTO chat.channel_members (channel_id, user_id, role)
             SELECT $1, u, CASE WHEN u = ANY($3::int[]) THEN 'admin' ELSE 'member' END FROM unnest($2::int[]) AS u
             ON CONFLICT DO NOTHING`,
            [chatChannelId, memberIds, [...admins]],
          );
        targets.push({ mmChannelId: c.id, chatChannelId, label: `#${c.displayname || c.name}` });
      }
    }

    // ---- one-to-one conversations: both people must be matched
    if (dms) {
      const rows = await mm(`SELECT c.id, c.name FROM channels c WHERE c.deleteat = 0 AND c.type = 'D'`);
      for (const c of rows) {
        const [a, b] = String(c.name).split('__').map(mapped);
        if (!a || !b || a === b) {
          counts.dmsSkipped++;
          continue;
        }
        const existing = done.get(`channel:${c.id}`);
        let chatChannelId = existing || null;
        if (!chatChannelId) {
          chatChannelId = (await openDm(db, a, b)).id;
          await remember('channel', c.id, chatChannelId);
          counts.dmsCopied++;
        }
        targets.push({ mmChannelId: c.id, chatChannelId, label: `DM ${a}↔${b}` });
      }
    }

    // ---- messages, files and reactions, conversation by conversation
    for (const target of targets) {
      const posts = await mm(
        `SELECT id, userid, rootid, message, props, createat, editat, ispinned, fileids
           FROM posts WHERE channelid = $1 AND deleteat = 0 AND type = '' ORDER BY createat, id`,
        [target.mmChannelId],
      );
      const toInsert = [];
      for (const p of posts) {
        if (done.has(`message:${p.id}`)) {
          counts.messagesAlreadyHere++;
          continue;
        }
        const userId = mapped(p.userid);
        if (!userId || isBotPost(p)) {
          counts.messagesLeftOut++;
          continue;
        }
        toInsert.push({ ...p, userId });
      }
      // Roots first, then replies (oldest first within each), so a thread's root has its id before its replies need it.
      const passes = [toInsert.filter((p) => !p.rootid), toInsert.filter((p) => p.rootid)];
      for (const list of passes)
        for (let i = 0; i < list.length; i += BATCH) {
          const batch = list.slice(i, i + BATCH);
          const values = [];
          const params = [];
          for (const p of batch) {
            const rootId = p.rootid ? (done.get(`message:${p.rootid}`) ?? null) : null;
            if (rootId) counts.threadReplies++;
            const fileIds = parseIds(p.fileids);
            const n = params.length;
            params.push(
              target.chatChannelId,
              p.userId,
              rootId,
              convertContent(p.message, usernames),
              fileIds.length ? 'file' : 'message',
              !!p.ispinned,
              p.ispinned ? p.userId : null,
              p.ispinned ? ms(p.createat) : null,
              p.editat > 0 ? ms(p.editat) : null,
              ms(p.createat),
            );
            values.push(
              `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}, $${n + 9}, $${n + 10})`,
            );
          }
          const inserted = await db.query(
            `INSERT INTO chat.messages (channel_id, user_id, thread_id, content, type, pinned, pinned_by, pinned_at, edited_at, created_at)
           VALUES ${values.join(', ')} RETURNING id`,
            params,
          );
          for (let k = 0; k < batch.length; k++) {
            const p = batch[k];
            const messageId = inserted.rows[k].id;
            await remember('message', p.id, messageId);
            counts.messages++;
            // Files on this post.
            if (files && parseIds(p.fileids).length) {
              const infos = await mm(
                `SELECT id, name, mimetype, size, path FROM fileinfo WHERE postid = $1 AND deleteat = 0 ORDER BY createat`,
                [p.id],
              );
              let kept = 0;
              for (const f of infos) {
                const mime = normaliseMime(f.mimetype);
                if (!ALLOWED_MIME.has(mime) || Number(f.size) > MAX_FILE_BYTES || done.has(`file:${f.id}`)) {
                  counts.filesLeftOut++;
                  continue;
                }
                const buffer = commit ? await readFile(f.path) : Buffer.alloc(0);
                if (commit && !buffer) {
                  counts.filesLeftOut++;
                  continue;
                }
                let relPath = `(dry run) ${f.path}`;
                let thumb = null;
                if (commit) {
                  ({ relPath } = await saveUpload({
                    uploadsDir,
                    channelId: target.chatChannelId,
                    filename: f.name,
                    buffer,
                  }));
                  thumb = await makeThumbnail({ uploadsDir, relPath, mime });
                }
                const file = await db.query(
                  `INSERT INTO chat.files (message_id, channel_id, user_id, filename, mime_type, size_bytes, file_path, thumbnail_path, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                  [
                    messageId,
                    target.chatChannelId,
                    p.userId,
                    f.name,
                    mime,
                    Number(f.size),
                    relPath,
                    thumb,
                    ms(p.createat),
                  ],
                );
                await remember('file', f.id, file.rows[0].id);
                counts.files++;
                kept++;
              }
              // A "file" message whose files were all left out is an ordinary message (an empty one says so).
              if (!kept)
                await db.query(
                  `UPDATE chat.messages SET type = 'message', content = CASE WHEN content = '' THEN '[a file that could not be copied]' ELSE content END WHERE id = $1`,
                  [messageId],
                );
            }
          }
          // Reactions on this batch.
          const reactions = await mm(
            `SELECT postid, userid, emojiname, createat FROM reactions WHERE deleteat = 0 AND postid = ANY($1::text[])`,
            [batch.map((p) => p.id)],
          );
          for (const r of reactions) {
            const userId = mapped(r.userid);
            const emoji = emojiOf(r.emojiname);
            const messageId = done.get(`message:${r.postid}`);
            if (!userId || !emoji || !messageId) {
              counts.reactionsLeftOut++;
              continue;
            }
            await db.query(
              `INSERT INTO chat.reactions (message_id, user_id, emoji, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [messageId, userId, emoji, ms(r.createat)],
            );
            counts.reactions++;
          }
        }
      // Nobody is shown thousands of "unread" old messages: the copied conversation starts as read.
      await db.query(
        `UPDATE chat.channel_members SET last_read_at = GREATEST(last_read_at, now()) WHERE channel_id = $1`,
        [target.chatChannelId],
      );
      log(`${target.label}: ${toInsert.length} messages`);
    }

    if (commit) await db.query('COMMIT');
    else await db.query('ROLLBACK');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
  return counts;
}

function parseIds(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
