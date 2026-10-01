import { Router } from 'express';
import { httpError, wrap } from '../http-errors.js';
import { isMember, listMembers } from '../repo/channels.js';
import { listMessages, createMessage, editMessage, deleteMessage, getMessage, listThread, listAround } from '../repo/messages.js';
import { cleanMessageContent } from '../sanitize.js';
import { parseMentions, insertMentions } from '../repo/mentions.js';
import { pinMessage, unpinMessage, listPins } from '../repo/pins.js';
import { addReaction, removeReaction } from '../repo/reactions.js';
import { dmPostBlocked, DM_BLOCKED_MESSAGE } from '../repo/restrictions.js';

export function createMessageRoutes({ db, emit, limiter, notifier = null }) {
  const r = Router();
  const mustBeMember = async (channelId, userId) => {
    if (!(await isMember(db, channelId, userId))) throw httpError(403, 'not_member', 'You are not in this channel');
  };
  // Channel owner/admin, or CRM Management: may pin, unpin and delete others' messages.
  const canModerate = async (channelId, user) => {
    if (user.role === 'Management') return true;
    const me = (await listMembers(db, channelId)).find((m) => m.id === user.id);
    return ['owner', 'admin'].includes(me?.channelRole);
  };

  r.get('/channels/:id/messages', wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    if (req.query.around) {
      const out = await listAround(db, req.params.id, String(req.query.around));
      if (!out) throw httpError(404, 'not_found', 'Message not found');
      return res.json({ success: true, ...out });
    }
    const out = await listMessages(db, req.params.id, { before: req.query.before || null, limit: req.query.limit || 50 });
    res.json({ success: true, ...out });
  }));

  r.get('/messages/:id/thread', wrap(async (req, res) => {
    const t = await listThread(db, req.params.id);
    if (!t) throw httpError(404, 'not_found', 'Message not found');
    await mustBeMember(t.root.channelId, req.user.id);
    res.json({ success: true, ...t });
  }));

  // Validate first so a refused message (empty, not a member) does not use up
  // the sender's one-per-second slot; only a message that will be stored counts.
  const validateSend = wrap(async (req, res, next) => {
    await mustBeMember(req.params.id, req.user.id);
    // A dm/all restriction also stops posting into a DM opened before the restriction existed.
    if (await dmPostBlocked(db, { channelId: req.params.id, userId: req.user.id })) throw httpError(403, 'restricted', DM_BLOCKED_MESSAGE);
    req.cleanContent = cleanMessageContent(req.body?.content);
    next();
  });
  r.post('/channels/:id/messages', validateSend, limiter, wrap(async (req, res) => {
    const content = req.cleanContent;
    const message = await createMessage(db, { channelId: req.params.id, userId: req.user.id, content, replyToId: req.body?.replyToId || null, threadId: req.body?.threadId || null });
    const { userIds, all } = parseMentions(content, await listMembers(db, req.params.id));
    if (userIds.length || all) await insertMentions(db, { messageId: message.id, channelId: req.params.id, authorId: req.user.id, userIds, all });
    emit.toChannel(req.params.id, 'new_message', { message, channel_id: req.params.id });
    // People with no live socket hear about it by push. Never blocks or fails the send.
    void notifier?.onMessage({ message, channelId: req.params.id, senderId: req.user.id, senderName: req.user.fullName, mentionedUserIds: userIds, mentionAll: !!all });
    res.status(201).json({ success: true, message });
  }));

  r.patch('/messages/:id', wrap(async (req, res) => {
    const content = cleanMessageContent(req.body?.content);
    const existing = await getMessage(db, req.params.id);
    if (!existing) throw httpError(404, 'not_found', 'Message not found');
    await mustBeMember(existing.channelId, req.user.id);
    const message = await editMessage(db, { messageId: req.params.id, userId: req.user.id, content });
    if (!message) throw httpError(403, 'not_author', 'You can only edit your own messages');
    emit.toChannel(message.channelId, 'message_edited', { message_id: message.id, channel_id: message.channelId, content: message.content, edited_at: message.editedAt });
    res.json({ success: true, message });
  }));

  r.delete('/messages/:id', wrap(async (req, res) => {
    const existing = await getMessage(db, req.params.id);
    if (!existing) throw httpError(404, 'not_found', 'Message not found');
    await mustBeMember(existing.channelId, req.user.id);
    const isChannelAdmin = await canModerate(existing.channelId, req.user);
    const ok = await deleteMessage(db, { messageId: existing.id, userId: req.user.id, isChannelAdmin });
    if (!ok) throw httpError(403, 'not_author', 'You can only delete your own messages');
    await db.query(`INSERT INTO chat.audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, 'message.delete', 'message', $2, $3)`,
      [req.user.id, existing.id, JSON.stringify({ channelId: existing.channelId, byAdmin: existing.userId !== req.user.id })]);
    emit.toChannel(existing.channelId, 'message_deleted', { message_id: existing.id, channel_id: existing.channelId });
    res.json({ success: true });
  }));

  r.get('/channels/:id/pins', wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    res.json({ success: true, pins: await listPins(db, req.params.id) });
  }));

  r.post('/messages/:id/pin', wrap(async (req, res) => {
    const existing = await getMessage(db, req.params.id);
    if (!existing) throw httpError(404, 'not_found', 'Message not found');
    await mustBeMember(existing.channelId, req.user.id);
    if (!(await canModerate(existing.channelId, req.user))) throw httpError(403, 'forbidden', 'Only channel admins can pin');
    const message = await pinMessage(db, { messageId: existing.id, userId: req.user.id });
    emit.toChannel(existing.channelId, 'message_pinned', { message_id: existing.id, channel_id: existing.channelId, pinned_by: req.user.id });
    res.json({ success: true, message });
  }));

  r.delete('/messages/:id/pin', wrap(async (req, res) => {
    const existing = await getMessage(db, req.params.id);
    if (!existing) throw httpError(404, 'not_found', 'Message not found');
    await mustBeMember(existing.channelId, req.user.id);
    if (!(await canModerate(existing.channelId, req.user))) throw httpError(403, 'forbidden', 'Only channel admins can unpin');
    const message = await unpinMessage(db, { messageId: existing.id });
    emit.toChannel(existing.channelId, 'message_unpinned', { message_id: existing.id, channel_id: existing.channelId });
    res.json({ success: true, message });
  }));

  r.post('/messages/:id/reactions', wrap(async (req, res) => {
    const existing = await getMessage(db, req.params.id);
    if (!existing) throw httpError(404, 'not_found', 'Message not found');
    await mustBeMember(existing.channelId, req.user.id);
    const emoji = String(req.body?.emoji || '');
    const added = await addReaction(db, { messageId: existing.id, userId: req.user.id, emoji });
    if (added) emit.toChannel(existing.channelId, 'reaction_added', { message_id: existing.id, channel_id: existing.channelId, emoji, user_id: req.user.id });
    res.json({ success: true, added });
  }));

  r.delete('/messages/:id/reactions/:emoji', wrap(async (req, res) => {
    const existing = await getMessage(db, req.params.id);
    if (!existing) throw httpError(404, 'not_found', 'Message not found');
    await mustBeMember(existing.channelId, req.user.id);
    const emoji = String(req.params.emoji || ''); // Express has already decoded the path segment
    const removed = await removeReaction(db, { messageId: existing.id, userId: req.user.id, emoji });
    if (removed) emit.toChannel(existing.channelId, 'reaction_removed', { message_id: existing.id, channel_id: existing.channelId, emoji, user_id: req.user.id });
    res.json({ success: true, removed });
  }));

  return r;
}
