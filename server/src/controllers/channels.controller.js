import { httpError, wrap } from '../middleware/errors.js';
import {
  listChannelsForUser,
  getChannel,
  createChannel,
  openDm,
  addMembers,
  removeMember,
  listMembers,
  markRead,
  ensureDefaultMembership,
} from '../models/channels.model.js';
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

  return {
    list: wrap(async (req, res) => {
      await ensureDefaultMembership(db, req.user.id);
      res.json({ success: true, channels: await listChannelsForUser(db, req.user.id) });
    }),

    openDm: wrap(async (req, res) => {
      const other = parseInt(req.body?.userId, 10);
      if (!Number.isFinite(other) || other <= 0) throw httpError(400, 'bad_user', 'userId required');
      // Checked before opening: an existing DM with a now-restricted person is refused too.
      if (await isBlocked(db, { fromUserId: req.user.id, toUserId: other, kind: 'dm' })) throw httpError(403, 'restricted', DM_BLOCKED_MESSAGE);
      const channel = await openDm(db, req.user.id, other);
      joinRooms([req.user.id, other], channel.id);
      emit.toUser(other, 'channel_updated', { channel });
      res.json({ success: true, channel });
    }),

    create: wrap(async (req, res) => {
      const { displayName, type, purpose, memberIds } = req.body || {};
      const members = Array.isArray(memberIds) ? memberIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
      if (type !== 'public') await assertCanShareChannel(db, { type, actorId: req.user.id, existingIds: [], joiningIds: toIds(members) });
      const channel = await createChannel(db, { displayName, type, purpose, createdBy: req.user.id, memberIds: members });
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
        await assertCanShareChannel(db, { type: channel.type, actorId: req.user.id, existingIds: currentIds, joiningIds });
      }
      const inserted = await addMembers(db, channelId, userIds, req.user.id);
      joinRooms(inserted, channelId);
      for (const userId of inserted) emit.toUser(userId, 'member_added', { channel_id: channelId, user_id: userId });
      if (inserted.length) emit.toChannel(channelId, 'member_added', { channel_id: channelId, user_ids: inserted });
      res.json({ success: true, added: inserted.length });
    }),

    /** Anyone may leave; removing someone else needs a channel admin or Management. */
    removeMember: wrap(async (req, res) => {
      const channelId = req.params.id;
      await assertMember(db, channelId, req.user.id);
      const target = parseInt(req.params.userId, 10);
      if (target !== req.user.id && !(await canModerate(db, channelId, req.user))) {
        throw httpError(403, 'forbidden', 'Only channel admins can remove members');
      }
      await removeMember(db, channelId, target);
      emit.leaveRoom?.(target, channelId);
      emit.toChannel(channelId, 'member_removed', { channel_id: channelId, user_id: target });
      emit.toUser(target, 'member_removed', { channel_id: channelId, user_id: target });
      res.json({ success: true });
    }),

    markRead: wrap(async (req, res) => {
      await assertMember(db, req.params.id, req.user.id);
      await markRead(db, req.params.id, req.user.id);
      emit.toUser(req.user.id, 'unread_update', { channel_id: req.params.id, unread_count: 0, mention_count: 0 });
      res.json({ success: true });
    }),
  };
}
