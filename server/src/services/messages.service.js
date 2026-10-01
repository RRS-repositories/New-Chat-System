// Posting a message: who may post, what gets stored, and who is told.
import { httpError } from '../middleware/errors.js';
import { listMembers } from '../models/channels.model.js';
import { createMessage } from '../models/messages.model.js';
import { insertMentions } from '../models/mentions.model.js';
import { dmPostBlocked, DM_BLOCKED_MESSAGE } from '../models/restrictions.model.js';
import { parseMentions } from '../utils/mentions.js';
import { assertMember } from './channels.service.js';

/** Member of the channel, and not blocked from posting into this DM (a `dm`/`all` restriction also covers a DM opened earlier). */
export async function assertCanPost(db, { channelId, userId }) {
  await assertMember(db, channelId, userId);
  if (await dmPostBlocked(db, { channelId, userId })) throw httpError(403, 'restricted', DM_BLOCKED_MESSAGE);
}

/** Tells everyone in the channel now, and (by push) the people with no live connection. Never blocks or fails the send. */
export function announceMessage(
  { emit, notifier },
  { message, channelId, sender, mentionedUserIds = [], mentionAll = false },
) {
  emit.toChannel(channelId, 'new_message', { message, channel_id: channelId });
  void notifier?.onMessage({
    message,
    channelId,
    senderId: sender.id,
    senderName: sender.fullName,
    mentionedUserIds,
    mentionAll,
  });
}

/** Stores a text message with its mentions and announces it. `content` is already cleaned. */
export async function sendMessage(
  { db, emit, notifier },
  { channelId, sender, content, replyToId = null, threadId = null },
) {
  const message = await createMessage(db, { channelId, userId: sender.id, content, replyToId, threadId });
  const { userIds, all } = parseMentions(content, await listMembers(db, channelId));
  if (userIds.length || all)
    await insertMentions(db, { messageId: message.id, channelId, authorId: sender.id, userIds, all });
  announceMessage({ emit, notifier }, { message, channelId, sender, mentionedUserIds: userIds, mentionAll: !!all });
  return message;
}
