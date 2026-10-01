/**
 * Host controls for a live call. The host is the person who started it (`call.initiatedBy`),
 * and only while they are in the call themselves.
 *
 *  - Mute someone: that person's call device is told to mute. Nobody can unmute another person.
 *  - Remove someone: they leave the call and cannot simply join back.
 *  - A removed person asks to come back; the host lets them in or refuses.
 *    A person who was only disconnected was never removed, so they join back freely.
 *
 * Kept in memory per live call (single chat-server process, like the call devices) and forgotten
 * when the call ends. Every method here runs under the call's lock, taken by this module.
 */
import { httpError } from '../../middleware/errors.js';
import { isUuid } from '../../models/calls.model.js';

export const REMOVED_MESSAGE = 'The host removed you from this call. Ask to join again.';
const LIVE = new Set(['ringing', 'active']);

export function createHostControls({
  devices,
  withLock,
  mustFindCall,
  mustBeMember,
  leaveLocked,
  toSocket,
  toUser,
  now,
  askAgainMs,
}) {
  const removed = new Map(); // callId -> Set(userId): removed by the host, must ask to come back
  const requests = new Map(); // callId -> Map(userId -> userName): waiting for the host's answer
  const refused = new Map(); // callId -> Map(userId -> when the host said no)

  const hostDevice = (call) => devices.get(call.id)?.get(call.initiatedBy);
  const mustBeCallId = (callId) => {
    if (!isUuid(callId)) throw httpError(404, 'not_found', 'Call not found');
  };

  // The checks every host action shares: the call is live, the caller started it and is in it now.
  async function asHost(callId, user) {
    const call = await mustFindCall(callId);
    await mustBeMember(call.channelId, user.id);
    if (!LIVE.has(call.status)) throw httpError(409, 'call_ended', 'This call has ended');
    if (call.initiatedBy !== user.id)
      throw httpError(403, 'not_host', 'Only the person who started the call can do that');
    if (!devices.get(callId)?.has(user.id)) throw httpError(403, 'not_in_call', 'You are not in this call');
    return call;
  }

  function otherPersonInCall(callId, hostId, targetUserId) {
    const target = Number(targetUserId);
    if (!Number.isInteger(target) || target <= 0 || target === hostId)
      throw httpError(400, 'bad_target', 'Choose another person in the call');
    const device = devices.get(callId)?.get(target);
    if (device === undefined) throw httpError(404, 'not_in_call', 'That person is not in the call');
    return { target, device };
  }

  const answer = (call, userId, extra) =>
    toUser(userId, 'call_join_answer', { call_id: call.id, channel_id: call.channelId, ...extra });

  return {
    /** True when the host removed this person from this call and has not let them back in. */
    isRemoved: (callId, userId) => !!removed.get(callId)?.has(userId),

    /** The waiting requests, for the host only (so they reappear after the host reconnects). */
    joinRequestsFor(call, userId) {
      if (userId !== call.initiatedBy) return [];
      return [...(requests.get(call.id) || [])].map(([id, userName]) => ({ userId: id, userName }));
    },

    /** The host left a call that goes on: nobody can answer, so everyone waiting is told no. */
    onHostLeft(call) {
      for (const userId of requests.get(call.id)?.keys() || [])
        answer(call, userId, { accepted: false, reason: 'host_left' });
      requests.delete(call.id);
    },

    /** The call is over. */
    forget(callId) {
      removed.delete(callId);
      requests.delete(callId);
      refused.delete(callId);
    },

    async mute({ callId, user, targetUserId }) {
      mustBeCallId(callId);
      return withLock(callId, async () => {
        const call = await asHost(callId, user);
        const { device } = otherPersonInCall(callId, user.id, targetUserId);
        toSocket(device, 'call_muted_by_host', {
          call_id: callId,
          channel_id: call.channelId,
          by_user_id: user.id,
          by_user_name: call.initiatedByName || '',
        });
      });
    },

    async remove({ callId, user, targetUserId }) {
      mustBeCallId(callId);
      return withLock(callId, async () => {
        const call = await asHost(callId, user);
        const { target } = otherPersonInCall(callId, user.id, targetUserId);
        if (!removed.has(callId)) removed.set(callId, new Set());
        removed.get(callId).add(target);
        toUser(target, 'call_removed', {
          call_id: callId,
          channel_id: call.channelId,
          by_user_name: call.initiatedByName || '',
        });
        await leaveLocked(callId, target); // in a one-to-one call this ends it (and forgets everything here)
      });
    },

    /** A removed person asks the host to let them back in. Asking again while waiting changes nothing. */
    async ask({ callId, user }) {
      mustBeCallId(callId);
      return withLock(callId, async () => {
        const call = await mustFindCall(callId);
        await mustBeMember(call.channelId, user.id);
        if (!LIVE.has(call.status)) throw httpError(409, 'call_ended', 'This call has ended');
        if (!removed.get(callId)?.has(user.id)) throw httpError(400, 'not_removed', 'You can join this call directly');
        const host = hostDevice(call);
        if (host === undefined)
          throw httpError(403, 'host_gone', 'The host has left the call, so nobody can let you back in');
        const saidNoAt = refused.get(callId)?.get(user.id);
        if (saidNoAt !== undefined && now() - saidNoAt < askAgainMs)
          throw httpError(429, 'too_soon', 'The host said no. You can ask again in a minute.');
        if (!requests.has(callId)) requests.set(callId, new Map());
        const userName = user.fullName || '';
        requests.get(callId).set(user.id, userName);
        toSocket(host, 'call_join_request', {
          call_id: callId,
          channel_id: call.channelId,
          user_id: user.id,
          user_name: userName,
        });
      });
    },

    /** The person stops waiting. */
    async cancel({ callId, userId }) {
      if (!isUuid(callId)) return;
      await withLock(callId, async () => {
        if (!requests.get(callId)?.delete(userId)) return;
        const call = await mustFindCall(callId).catch(() => null);
        const host = call ? hostDevice(call) : undefined;
        if (host !== undefined) toSocket(host, 'call_join_request_cancelled', { call_id: callId, user_id: userId });
      });
    },

    /** The host lets a waiting person back in, or refuses. Letting in only lifts the removal: they then join as usual. */
    async answer({ callId, user, targetUserId, accept }) {
      mustBeCallId(callId);
      return withLock(callId, async () => {
        const call = await asHost(callId, user);
        if (typeof accept !== 'boolean') throw httpError(400, 'bad_answer', 'Say whether to let the person in');
        const target = Number(targetUserId);
        if (!requests.get(callId)?.delete(target))
          throw httpError(404, 'no_request', 'That request is no longer waiting');
        if (accept) {
          removed.get(callId)?.delete(target);
          refused.get(callId)?.delete(target);
          answer(call, target, { accepted: true });
        } else {
          if (!refused.has(callId)) refused.set(callId, new Map());
          refused.get(callId).set(target, now());
          answer(call, target, { accepted: false, reason: 'refused' });
        }
      });
    },
  };
}
