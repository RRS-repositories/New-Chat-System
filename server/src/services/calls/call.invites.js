/**
 * Adding people to a live call, and joining a ringing call to a call already going on.
 *
 *  - Anyone in a call can ring another person into it. That person's screen rings for 30 seconds,
 *    the people in the call see a "Ringing…" tile, and a "Join my call" message is posted into the
 *    direct conversation between the two, so the invitation still works after a missed ring.
 *  - The invited person joins the call only. If they are not in the call's channel they never see
 *    its messages: they are simply let into this one call until it ends.
 *  - The person who rang, or the host, can stop the ring and take the invitation back.
 *  - Merge: someone already in a call is rung one-to-one by a caller. Instead of leaving their
 *    call they bring the caller into it: the one-to-one call ends and the caller joins theirs.
 *
 * Kept in memory per live call and forgotten when the call ends. Runs under the call's lock.
 */
import { httpError } from '../../middleware/errors.js';
import { isUuid, listParticipants } from '../../models/calls.model.js';
import { getChannel, isMember, openDm } from '../../models/channels.model.js';
import { createMessage } from '../../models/messages.model.js';
import { isBlocked } from '../../models/restrictions.model.js';
import { loadSessionUser } from '../../models/users.model.js';

export const INVITE_MESSAGE = 'Can you join my call?';
const LIVE = new Set(['ringing', 'active']);

export function createCallInvites({
  db,
  emit,
  config,
  devices,
  withLock,
  mustFindCall,
  mustBeMember,
  host,
  end,
  toUser,
  toCall,
  toSocket,
  notify,
  arm,
  disarm,
  ringMs,
  maxParticipants,
}) {
  // callId -> Map(userId -> { userName, invitedBy, handle }). `handle` is the ring's timer: null once the ring is over.
  const invited = new Map();
  const of = (callId) => invited.get(callId);
  const ringing = (callId) => [...(of(callId) || [])].filter(([, invite]) => invite.handle !== null);

  const mustBeCallId = (callId) => {
    if (!isUuid(callId)) throw httpError(404, 'not_found', 'Call not found');
  };
  const mustBeLive = (call) => {
    if (!LIVE.has(call.status)) throw httpError(409, 'call_ended', 'This call has ended');
  };
  const mustBeInCall = (callId, userId) => {
    if (!devices.get(callId)?.has(userId)) throw httpError(403, 'not_in_call', 'You are not in this call');
  };
  const toPerson = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  };
  /** The call has room for one more: people in it plus people being rung stay within the limit. */
  async function mustHaveRoom(callId) {
    const inCall = (await listParticipants(db, callId)).length;
    if (inCall + ringing(callId).length >= maxParticipants)
      throw httpError(403, 'call_full', `This call is full. A call holds up to ${maxParticipants} people.`);
  }
  const blockedEitherWay = async (a, b, kind) =>
    (await isBlocked(db, { fromUserId: a, toUserId: b, kind })) ||
    (await isBlocked(db, { fromUserId: b, toUserId: a, kind }));

  /** The ring stops (answered elsewhere, taken back, refused, or 30 seconds passed). The invitation itself may stay. */
  function stopRing(call, userId, reason) {
    const invite = of(call.id)?.get(userId);
    if (!invite || invite.handle === null) return false;
    disarm(invite.handle);
    invite.handle = null;
    if (reason) {
      const payload = { call_id: call.id, channel_id: call.channelId, user_id: userId, reason };
      toCall(call.id, 'call_invite_ended', payload);
      toUser(userId, 'call_invite_ended', payload);
    }
    return true;
  }

  /** The "Join my call" message in the direct conversation between the two. Never stops the invitation. */
  async function postJoinCard(call, inviter, targetId) {
    try {
      if (await blockedEitherWay(inviter.id, targetId, 'dm')) return;
      const dm = await openDm(db, inviter.id, targetId);
      for (const userId of [inviter.id, targetId]) emit.joinRoom?.(userId, dm.id);
      toUser(targetId, 'channel_updated', { channel: dm });
      toUser(inviter.id, 'channel_updated', { channel: dm });
      const message = await createMessage(db, {
        channelId: dm.id,
        userId: inviter.id,
        content: INVITE_MESSAGE,
        type: 'call',
        metadata: { kind: 'call_invite', call_id: call.id, channel_id: call.channelId },
      });
      emit.toChannel?.(dm.id, 'new_message', { message, channel_id: dm.id });
      notify('onMessage', {
        message,
        channelId: dm.id,
        senderId: inviter.id,
        senderName: inviter.fullName || '',
        mentionedUserIds: [],
        mentionAll: false,
      });
    } catch (e) {
      console.error('[chat] calls: join-my-call message failed', e?.message || e);
    }
  }

  return {
    /** Who is being rung right now, for people joining the call late. */
    snapshot: (callId) => ({
      invites: ringing(callId).map(([userId, invite]) => ({ userId, userName: invite.userName })),
    }),

    /** The person answered: the ring is over (everyone sees them join). */
    onJoined(callId, userId) {
      const invite = of(callId)?.get(userId);
      if (!invite || invite.handle === null) return;
      disarm(invite.handle);
      invite.handle = null;
    },

    /** The rung person said no. True when there was a ring to refuse. */
    decline(call, userId) {
      if (!stopRing(call, userId, 'declined')) return false;
      toUser(userId, 'call_dismissed', { call_id: call.id });
      return true;
    },

    forget(callId) {
      for (const invite of of(callId)?.values() || []) disarm(invite.handle);
      invited.delete(callId);
    },

    close() {
      for (const callId of [...invited.keys()]) this.forget(callId);
    },

    async invite({ callId, user, targetUserId }) {
      mustBeCallId(callId);
      const target = toPerson(targetUserId);
      if (target === null || target === user.id) throw httpError(400, 'bad_target', 'Choose another person to add');
      return withLock(callId, async () => {
        const call = await mustFindCall(callId);
        mustBeLive(call);
        mustBeInCall(callId, user.id);
        if (devices.get(callId).has(target))
          throw httpError(409, 'already_in_call', 'That person is already in the call');
        const existing = of(callId)?.get(target);
        if (existing && existing.handle !== null)
          throw httpError(409, 'already_ringing', 'That person is already being rung');
        if (host.isRemoved(callId, target))
          throw httpError(403, 'removed', 'The host removed that person from this call. They can ask to join again.');
        await mustHaveRoom(callId);
        const person = await loadSessionUser(db, { userId: target, iat: null });
        if (!person || (config.requireBeta && !person.chatEnabled))
          throw httpError(404, 'unknown_user', 'That person cannot be called');
        if (await blockedEitherWay(user.id, target, 'call'))
          throw httpError(403, 'restricted', 'You cannot call this person');

        const channel = await getChannel(db, call.channelId);
        if (!(await isMember(db, call.channelId, target))) host.allow(callId, target);
        const invite = {
          userName: person.fullName || '',
          invitedBy: user.id,
          handle: null,
        };
        invite.handle = arm(
          () =>
            withLock(callId, async () => {
              if (of(callId)?.get(target) !== invite || !stopRing(call, target, 'timeout')) return;
              notify('onMissedCall', {
                call,
                channel: {
                  id: call.channelId,
                  type: channel?.type || 'private',
                  displayName: channel?.displayName || '',
                },
                fromName: user.fullName || '',
                userIds: [target],
              });
            }),
          ringMs,
        );
        if (!invited.has(callId)) invited.set(callId, new Map());
        invited.get(callId).set(target, invite);

        const fromName = user.fullName || '';
        toUser(target, 'call_invited', {
          call_id: callId,
          channel_id: call.channelId,
          from_user_id: user.id,
          from_user_name: fromName,
        });
        toCall(callId, 'call_invite_pending', {
          call_id: callId,
          channel_id: call.channelId,
          user_id: target,
          user_name: invite.userName,
        });
        notify('onIncomingCall', {
          call,
          channel: { id: call.channelId, type: channel?.type || 'private', displayName: channel?.displayName || '' },
          fromName,
          userIds: [target],
        });
        await postJoinCard(call, user, target);
        return { userId: target, userName: invite.userName };
      });
    },

    /** The person who rang, or the host, takes the invitation back: the ring stops and the person can no longer join on it. */
    async cancel({ callId, user, targetUserId }) {
      mustBeCallId(callId);
      const target = toPerson(targetUserId);
      return withLock(callId, async () => {
        const call = await mustFindCall(callId);
        mustBeLive(call);
        mustBeInCall(callId, user.id);
        const invite = target === null ? null : of(callId)?.get(target);
        if (!invite) throw httpError(404, 'no_invite', 'That person was not invited to this call');
        if (invite.invitedBy !== user.id && host.hostIdOf(call) !== user.id)
          throw httpError(403, 'not_yours', 'Only the person who rang them, or the host, can stop it');
        if (stopRing(call, target, 'cancelled')) toUser(target, 'call_dismissed', { call_id: callId });
        of(callId).delete(target);
        if (!devices.get(callId)?.has(target)) host.disallow(callId, target);
      });
    },

    /**
     * `user` is in call `intoCallId` and is being rung one-to-one by the caller of `callId`. The
     * one-to-one call ends, and the caller is let into (and sent to) the call `user` is in.
     */
    async merge({ callId, user, intoCallId }) {
      mustBeCallId(callId);
      if (!isUuid(intoCallId) || intoCallId === callId)
        throw httpError(400, 'bad_call', 'Choose the call to bring the caller into');

      // 1. The ringing call really is a one-to-one call ringing this person.
      const ringingCall = await withLock(callId, async () => {
        const call = await mustFindCall(callId);
        await mustBeMember(call.channelId, user.id);
        const channel = await getChannel(db, call.channelId);
        if (call.status !== 'ringing' || call.initiatedBy === user.id || channel?.type !== 'dm')
          throw httpError(409, 'not_ringing', 'That call is no longer ringing');
        return call;
      });
      const callerId = ringingCall.initiatedBy;
      const callerDevice = devices.get(callId)?.get(callerId);

      // 2. The call this person is in has room, and the caller is let into it.
      const target = await withLock(intoCallId, async () => {
        const call = await mustFindCall(intoCallId);
        mustBeLive(call);
        mustBeInCall(intoCallId, user.id);
        if (devices.get(intoCallId).has(callerId))
          throw httpError(409, 'already_in_call', 'That person is already in the call');
        if (host.isRemoved(intoCallId, callerId))
          throw httpError(403, 'removed', 'The host removed that person from this call. They can ask to join again.');
        await mustHaveRoom(intoCallId);
        if (!(await isMember(db, call.channelId, callerId))) host.allow(intoCallId, callerId);
        if (!invited.has(intoCallId)) invited.set(intoCallId, new Map());
        invited
          .get(intoCallId)
          .set(callerId, { userName: ringingCall.initiatedByName || '', invitedBy: user.id, handle: null });
        return call;
      });

      // 3. The one-to-one call ends, and the caller's call device is sent to the other call.
      await withLock(callId, async () => {
        const call = await mustFindCall(callId);
        if (call.status === 'ringing') await end(callId, 'declined', { note: 'merged' });
      });
      const payload = { from_call_id: callId, join_call_id: intoCallId, channel_id: target.channelId };
      if (callerDevice !== undefined) toSocket(callerDevice, 'call_merge', payload);
      else toUser(callerId, 'call_merge', payload);
    },
  };
}
