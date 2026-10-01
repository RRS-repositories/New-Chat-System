import { httpError, wrap } from '../middleware/errors.js';
import {
  listMessages,
  editMessage,
  deleteMessage,
  getMessage,
  listThread,
  listAround,
  logMessageDeletion,
} from '../models/messages.model.js';
import { pinMessage, unpinMessage, listPins } from '../models/pins.model.js';
import { addReaction, removeReaction } from '../models/reactions.model.js';
import { assertMember, canModerate } from '../services/channels.service.js';
import { assertCanPost, sendMessage } from '../services/messages.service.js';
import { cleanMessageContent } from '../utils/sanitize.js';

export function createMessageController({ db, emit, notifier = null }) {
  /** The message, after checking it exists and the caller is in its channel. */
  const messageForMember = async (messageId, userId) => {
    const message = await getMessage(db, messageId);
    if (!message) throw httpError(404, 'not_found', 'Message not found');
    await assertMember(db, message.channelId, userId);
    return message;
  };

  return {
    list: wrap(async (req, res) => {
      const channelId = req.params.id;
      await assertMember(db, channelId, req.user.id);
      if (req.query.around) {
        const window = await listAround(db, channelId, String(req.query.around));
        if (!window) throw httpError(404, 'not_found', 'Message not found');
        return res.json({ success: true, ...window });
      }
      const page = await listMessages(db, channelId, {
        before: req.query.before || null,
        limit: req.query.limit || 50,
      });
      res.json({ success: true, ...page });
    }),

    thread: wrap(async (req, res) => {
      const thread = await listThread(db, req.params.id);
      if (!thread) throw httpError(404, 'not_found', 'Message not found');
      await assertMember(db, thread.root.channelId, req.user.id);
      res.json({ success: true, ...thread });
    }),

    /**
     * Runs before the rate limiter, so a refused message (empty, not a member, blocked) does not
     * use up the sender's one-per-second slot. Only a message that will be stored counts.
     */
    validateSend: wrap(async (req, _res, next) => {
      await assertCanPost(db, { channelId: req.params.id, userId: req.user.id });
      req.cleanContent = cleanMessageContent(req.body?.content);
      next();
    }),

    send: wrap(async (req, res) => {
      const message = await sendMessage(
        { db, emit, notifier },
        {
          channelId: req.params.id,
          sender: req.user,
          content: req.cleanContent,
          replyToId: req.body?.replyToId || null,
          threadId: req.body?.threadId || null,
        },
      );
      res.status(201).json({ success: true, message });
    }),

    edit: wrap(async (req, res) => {
      const content = cleanMessageContent(req.body?.content);
      await messageForMember(req.params.id, req.user.id);
      const message = await editMessage(db, { messageId: req.params.id, userId: req.user.id, content });
      if (!message) throw httpError(403, 'not_author', 'You can only edit your own messages');
      emit.toChannel(message.channelId, 'message_edited', {
        message_id: message.id,
        channel_id: message.channelId,
        content: message.content,
        edited_at: message.editedAt,
      });
      res.json({ success: true, message });
    }),

    remove: wrap(async (req, res) => {
      const existing = await messageForMember(req.params.id, req.user.id);
      const isChannelAdmin = await canModerate(db, existing.channelId, req.user);
      const removed = await deleteMessage(db, { messageId: existing.id, userId: req.user.id, isChannelAdmin });
      if (!removed) throw httpError(403, 'not_author', 'You can only delete your own messages');
      await logMessageDeletion(db, {
        actorId: req.user.id,
        messageId: existing.id,
        channelId: existing.channelId,
        byAdmin: existing.userId !== req.user.id,
      });
      emit.toChannel(existing.channelId, 'message_deleted', {
        message_id: existing.id,
        channel_id: existing.channelId,
      });
      res.json({ success: true });
    }),

    listPins: wrap(async (req, res) => {
      await assertMember(db, req.params.id, req.user.id);
      res.json({ success: true, pins: await listPins(db, req.params.id) });
    }),

    pin: wrap(async (req, res) => {
      const existing = await messageForMember(req.params.id, req.user.id);
      if (!(await canModerate(db, existing.channelId, req.user)))
        throw httpError(403, 'forbidden', 'Only channel admins can pin');
      const message = await pinMessage(db, { messageId: existing.id, userId: req.user.id });
      emit.toChannel(existing.channelId, 'message_pinned', {
        message_id: existing.id,
        channel_id: existing.channelId,
        pinned_by: req.user.id,
      });
      res.json({ success: true, message });
    }),

    unpin: wrap(async (req, res) => {
      const existing = await messageForMember(req.params.id, req.user.id);
      if (!(await canModerate(db, existing.channelId, req.user)))
        throw httpError(403, 'forbidden', 'Only channel admins can unpin');
      const message = await unpinMessage(db, { messageId: existing.id });
      emit.toChannel(existing.channelId, 'message_unpinned', {
        message_id: existing.id,
        channel_id: existing.channelId,
      });
      res.json({ success: true, message });
    }),

    addReaction: wrap(async (req, res) => {
      const existing = await messageForMember(req.params.id, req.user.id);
      const emoji = String(req.body?.emoji || '');
      const added = await addReaction(db, { messageId: existing.id, userId: req.user.id, emoji });
      if (added)
        emit.toChannel(existing.channelId, 'reaction_added', {
          message_id: existing.id,
          channel_id: existing.channelId,
          emoji,
          user_id: req.user.id,
        });
      res.json({ success: true, added });
    }),

    removeReaction: wrap(async (req, res) => {
      const existing = await messageForMember(req.params.id, req.user.id);
      const emoji = String(req.params.emoji || ''); // Express has already decoded the path segment
      const removed = await removeReaction(db, { messageId: existing.id, userId: req.user.id, emoji });
      if (removed)
        emit.toChannel(existing.channelId, 'reaction_removed', {
          message_id: existing.id,
          channel_id: existing.channelId,
          emoji,
          user_id: req.user.id,
        });
      res.json({ success: true, removed });
    }),
  };
}
