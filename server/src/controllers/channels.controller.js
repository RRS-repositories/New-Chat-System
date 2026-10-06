import { httpError, wrap } from '../middleware/errors.js';
import {
  addMembers,
  archiveChannel,
  countMembers,
  createChannel,
  ensureDefaultMembership,
  getChannel,
  listChannelsForUser,
  listMembers,
  markRead,
  markUnread,
  openDm,
  removeMember,
  setFavourite,
  updateChannel,
} from '../models/channels.model.js';
import { getLiveCall } from '../models/calls.model.js';
import { isBlocked, DM_BLOCKED_MESSAGE } from '../models/restrictions.model.js';
import { assertMember, assertCanShareChannel, canModerate } from '../services/channels.service.js';
import { toIds } from '../utils/ids.js';

export function createChannelController({ db, emit }) {
  const joinRooms = (userIds, channelId) => {
    for (const userId of userIds) emit.joinRoom?.(userId, channelId);
  };
  const channelOr404 = async (channelId) => {
    const channel = await getChannel(db, channelId);
    if (!channel) throw httpError(404, 'not_found', 'Channel not found');
    return channel;
  };

  // General is the one channel everyone is always in, and a direct message is fixed between two people.
  const mustBeOrdinary = (channel) => {
    if (channel.type === 'dm') throw httpError(403, 'dm_fixed', 'A direct message is between two people');
    if (channel.name === 'general' && channel.type === 'public')
      throw httpError(403, 'default_channel', 'Everyone stays in General');
  };

  return {
    list: wrap(async (req, res) => {
      await ensureDefaultMembership(db, req.user.id);
      res.json({ success: true, channels: await listChannelsForUser(db, req.user.id) });
    }),

    openDm: wrap(async (req, res) => {
      const other = parseInt(req.body?.userId, 10);
      if (!Number.isFinite(other) || other <= 0) throw httpError(400, 'bad_user', 'userId required');
      // Checked before opening: an existing DM with a now-restricted person is refused too.
      if (await isBlocked(db, { fromUserId: req.user.id, toUserId: other, kind: 'dm' }))
        throw httpError(403, 'restricted', DM_BLOCKED_MESSAGE);
      const channel = await openDm(db, req.user.id, other);
      joinRooms([req.user.id, other], channel.id);
      emit.toUser(other, 'channel_updated', { channel });
      res.json({ success: true, channel });
    }),

    create: wrap(async (req, res) => {
      const { displayName, type, purpose, memberIds } = req.body || {};
      const members = Array.isArray(memberIds) ? memberIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
      if (type !== 'public')
        await assertCanShareChannel(db, { type, actorId: req.user.id, existingIds: [], joiningIds: toIds(members) });
      const channel = await createChannel(db, {
        displayName,
        type,
        purpose,
        createdBy: req.user.id,
        memberIds: members,
      });
      joinRooms([req.user.id, ...members], channel.id);
      for (const userId of members) emit.toUser(userId, 'member_added', { channel_id: channel.id, user_id: userId });
      res.status(201).json({ success: true, channel });
    }),

    get: wrap(async (req, res) => {
      await assertMember(db, req.params.id, req.user.id);
      const channel = await channelOr404(req.params.id);
      res.json({ success: true, channel, members: await listMembers(db, channel.id) });
    }),

    addMembers: wrap(async (req, res) => {
      const channelId = req.params.id;
      await assertMember(db, channelId, req.user.id);
      const channel = await channelOr404(channelId);
      if (channel.type === 'dm') throw httpError(403, 'dm_fixed', 'A direct message is between two people');
      const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
      if (channel.type !== 'public') {
        const currentIds = (await listMembers(db, channel.id)).map((m) => m.id);
        const joiningIds = toIds(userIds).filter((id) => !currentIds.includes(id));
        await assertCanShareChannel(db, {
          type: channel.type,
          actorId: req.user.id,
          existingIds: currentIds,
          joiningIds,
        });
      }
      const inserted = await addMembers(db, channelId, userIds, req.user.id);
      joinRooms(inserted, channelId);
      for (const userId of inserted) emit.toUser(userId, 'member_added', { channel_id: channelId, user_id: userId });
      if (inserted.length) emit.toChannel(channelId, 'member_added', { channel_id: channelId, user_ids: inserted });
      res.json({ success: true, added: inserted.length });
    }),

    /** The shown name and the purpose. Channel owner or admin, or Management. */
    update: wrap(async (req, res) => {
      const channelId = req.params.id;
      await assertMember(db, channelId, req.user.id);
      const current = await channelOr404(channelId);
      if (current.type === 'dm') throw httpError(403, 'dm_fixed', 'A direct message is between two people');
      if (!(await canModerate(db, channelId, req.user)))
        throw httpError(403, 'forbidden', 'Only channel admins can change the channel');
      const channel = await updateChannel(db, channelId, {
        displayName: req.body?.displayName,
        purpose: req.body?.purpose,
        actorId: req.user.id,
      });
      if (!channel) throw httpError(404, 'not_found', 'Channel not found');
      emit.toChannel(channelId, 'channel_updated', { channel });
      res.json({ success: true, channel });
    }),

    /** Hides the channel for everyone; its messages are kept. Channel owner or admin, or Management. */
    archive: wrap(async (req, res) => {
      const channelId = req.params.id;
      await assertMember(db, channelId, req.user.id);
      mustBeOrdinary(await channelOr404(channelId));
      if (!(await canModerate(db, channelId, req.user)))
        throw httpError(403, 'forbidden', 'Only channel admins can archive the channel');
      if (await getLiveCall(db, channelId))
        throw httpError(409, 'call_in_progress', 'A call is going on in this channel. End it first.');
      await archiveChannel(db, channelId, { actorId: req.user.id });
      emit.toChannel(channelId, 'channel_archived', { channel_id: channelId });
      res.json({ success: true });
    }),

    /** Anyone may leave; removing someone else needs a channel admin or Management. */
    removeMember: wrap(async (req, res) => {
      const channelId = req.params.id;
      await assertMember(db, channelId, req.user.id);
      const target = parseInt(req.params.userId, 10);
      const channel = await channelOr404(channelId);
      mustBeOrdinary(channel);
      if (target !== req.user.id && !(await canModerate(db, channelId, req.user))) {
        throw httpError(403, 'forbidden', 'Only channel admins can remove members');
      }
      await removeMember(db, channelId, target);
      emit.leaveRoom?.(target, channelId);
      emit.toChannel(channelId, 'member_removed', { channel_id: channelId, user_id: target });
      emit.toUser(target, 'member_removed', { channel_id: channelId, user_id: target });
      // Nobody is left to read or reopen a private channel: archive it instead of leaving an orphan.
      if (channel.type !== 'public' && (await countMembers(db, channelId)) === 0)
        await archiveChannel(db, channelId, { actorId: req.user.id, reason: 'last member left' });
      res.json({ success: true });
    }),

    /** The caller's own star on the conversation (shown in their Favourites section). */
    setFavourite: wrap(async (req, res) => {
      const favourite = await setFavourite(db, req.params.id, req.user.id, req.body?.on === true);
      if (favourite === null) throw httpError(403, 'not_member', 'You are not in this channel');
      res.json({ success: true, favourite });
    }),

    /** Mark as unread: the newest message from someone else is unread again, on every device. */
    markUnread: wrap(async (req, res) => {
      const unread = await markUnread(db, req.params.id, req.user.id);
      if (unread === null) throw httpError(403, 'not_member', 'You are not in this channel');
      emit.toUser(req.user.id, 'unread_update', { channel_id: req.params.id, unread_count: unread, mention_count: 0 });
      res.json({ success: true, unreadCount: unread });
    }),

    markRead: wrap(async (req, res) => {
      await assertMember(db, req.params.id, req.user.id);
      await markRead(db, req.params.id, req.user.id);
      emit.toUser(req.user.id, 'unread_update', { channel_id: req.params.id, unread_count: 0, mention_count: 0 });
      res.json({ success: true });
    }),
  };
}
