import { Router } from 'express';
import { httpError, wrap } from '../http-errors.js';
import { listChannelsForUser, getChannel, isMember, createChannel, openDm, addMembers, removeMember, listMembers, markRead, ensureDefaultMembership } from '../repo/channels.js';
import { isBlocked, blockedPairs, DM_BLOCKED_MESSAGE } from '../repo/restrictions.js';

const toIds = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

export function createChannelRoutes({ db, emit }) {
  const r = Router();

  const mustBeMember = async (channelId, userId) => {
    if (!(await isMember(db, channelId, userId))) throw httpError(403, 'not_member', 'You are not in this channel');
  };
  const joinRooms = (userIds, channelId) => { for (const uid of userIds) emit.joinRoom?.(uid, channelId); };
  // Private/group_dm only (public channels are never restricted). A pair counts when at least one
  // side is joining, so a restriction added after two people already share a channel does not
  // freeze that channel's membership. Runs before any insert: a refused request adds nobody.
  //  - channel/all, either direction: any pair involving a joiner (private and group_dm).
  //  - dm/all, either direction: the actor and any joiner (otherwise a dm-only restriction is
  //    sidestepped with a two-person private channel); for a group_dm, which is a DM in all but
  //    name, any pair involving a joiner.
  const mustShareChannel = async ({ type, actorId, existingIds, joiningIds }) => {
    const joining = new Set(joiningIds.filter((id) => id !== actorId));
    if (!joining.size) return;
    const involvesJoiner = ([a, b]) => joining.has(a) || joining.has(b);
    const everyone = [...new Set([actorId, ...existingIds, ...joining])];
    const refuse = () => { throw httpError(403, 'restricted', 'Some of these people cannot share a private channel'); };
    if (type === 'group_dm') {
      if ((await blockedPairs(db, { userIds: everyone, kind: ['channel', 'dm'] })).some(involvesJoiner)) refuse();
      return;
    }
    if ((await blockedPairs(db, { userIds: everyone, kind: 'channel' })).some(involvesJoiner)) refuse();
    const actorPairs = await blockedPairs(db, { userIds: [actorId, ...joining], kind: 'dm' });
    if (actorPairs.some(([a, b]) => (a === actorId && joining.has(b)) || (b === actorId && joining.has(a)))) refuse();
  };

  r.get('/', wrap(async (req, res) => {
    await ensureDefaultMembership(db, req.user.id);
    res.json({ success: true, channels: await listChannelsForUser(db, req.user.id) });
  }));

  r.post('/dm', wrap(async (req, res) => {
    const other = parseInt(req.body?.userId, 10);
    if (!Number.isFinite(other) || other <= 0) throw httpError(400, 'bad_user', 'userId required');
    // Before openDm: an existing DM with a now-restricted person is refused too.
    if (await isBlocked(db, { fromUserId: req.user.id, toUserId: other, kind: 'dm' })) throw httpError(403, 'restricted', DM_BLOCKED_MESSAGE);
    const channel = await openDm(db, req.user.id, other);
    joinRooms([req.user.id, other], channel.id);
    emit.toUser(other, 'channel_updated', { channel });
    res.json({ success: true, channel });
  }));

  r.post('/', wrap(async (req, res) => {
    const { displayName, type, purpose, memberIds } = req.body || {};
    const members = Array.isArray(memberIds) ? memberIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    if (type !== 'public') await mustShareChannel({ type, actorId: req.user.id, existingIds: [], joiningIds: toIds(members) });
    const channel = await createChannel(db, { displayName, type, purpose, createdBy: req.user.id, memberIds: members });
    joinRooms([req.user.id, ...members], channel.id);
    for (const uid of members) emit.toUser(uid, 'member_added', { channel_id: channel.id, user_id: uid });
    res.status(201).json({ success: true, channel });
  }));

  r.get('/:id', wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    const channel = await getChannel(db, req.params.id);
    if (!channel) throw httpError(404, 'not_found', 'Channel not found');
    res.json({ success: true, channel, members: await listMembers(db, channel.id) });
  }));

  r.post('/:id/members', wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    const channel = await getChannel(db, req.params.id);
    if (!channel) throw httpError(404, 'not_found', 'Channel not found');
    if (channel.type === 'dm') throw httpError(403, 'dm_fixed', 'A direct message is between two people');
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    if (channel.type !== 'public') {
      const currentIds = (await listMembers(db, channel.id)).map((m) => m.id);
      await mustShareChannel({ type: channel.type, actorId: req.user.id, existingIds: currentIds, joiningIds: toIds(userIds).filter((id) => !currentIds.includes(id)) });
    }
    const inserted = await addMembers(db, req.params.id, userIds, req.user.id);
    joinRooms(inserted, req.params.id);
    for (const uid of inserted) emit.toUser(uid, 'member_added', { channel_id: req.params.id, user_id: uid });
    if (inserted.length) emit.toChannel(req.params.id, 'member_added', { channel_id: req.params.id, user_ids: inserted });
    res.json({ success: true, added: inserted.length });
  }));

  r.delete('/:id/members/:userId', wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    const target = parseInt(req.params.userId, 10);
    const members = await listMembers(db, req.params.id);
    const me = members.find((m) => m.id === req.user.id);
    const canRemove = target === req.user.id || ['owner', 'admin'].includes(me?.channelRole) || req.user.role === 'Management';
    if (!canRemove) throw httpError(403, 'forbidden', 'Only channel admins can remove members');
    await removeMember(db, req.params.id, target);
    emit.leaveRoom?.(target, req.params.id);
    emit.toChannel(req.params.id, 'member_removed', { channel_id: req.params.id, user_id: target });
    emit.toUser(target, 'member_removed', { channel_id: req.params.id, user_id: target });
    res.json({ success: true });
  }));

  r.post('/:id/read', wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    await markRead(db, req.params.id, req.user.id);
    emit.toUser(req.user.id, 'unread_update', { channel_id: req.params.id, unread_count: 0, mention_count: 0 });
    res.json({ success: true });
  }));

  return r;
}
