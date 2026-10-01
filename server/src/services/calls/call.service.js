/**
 * Call state and lifecycle (ring timeout, join/leave, screen share, signalling routing).
 * createCallService({ db, emit, notifier, config, socketsOfUser, now, timers })
 *
 * The database holds the calls and their participants; this process additionally keeps,
 * per live call, which socket ("device") each participant joined on — signalling goes to
 * that socket only, and that socket disconnecting (plus a grace period) makes them leave.
 * Single chat-server instance, so this map and the per-call lock are in memory.
 */
import { httpError } from '../../middleware/errors.js';
import { buildIceServers } from './ice.js';
import { getChannel, isMember, listMembers } from '../../models/channels.model.js';
import { createMessage } from '../../models/messages.model.js';
import { isBlocked } from '../../models/restrictions.model.js';
import {
  isUuid, createCall, getCall, getLiveCall, listCalls, listParticipants, participantNames,
  addParticipant, removeParticipant, activateCall, finishCall, setScreenShare, sweepStaleCalls as sweepRows,
} from '../../models/calls.model.js';

export const RESTRICTED_CALL_MESSAGE = 'You cannot call this person';
const MAX_SIGNAL_BYTES = 64 * 1024;
const LIVE = new Set(['ringing', 'active']);
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);

export function createCallService({ db, emit = {}, notifier = null, config = {}, socketsOfUser = null, now = Date.now, timers = { setTimeout, clearTimeout } } = {}) {
  const ringMs = num(config.callRingMs, 30_000);
  const maxParticipants = num(config.callMaxParticipants, 8);
  const graceMs = num(config.callDisconnectGraceMs, 10_000);

  const devices = new Map();      // callId -> Map(userId -> socketId)
  const ringTimers = new Map();   // callId -> handle
  const graceTimers = new Map();  // `${callId}:${userId}` -> { handle, socketId }
  const locks = new Map();        // callId -> tail promise
  const pendingStarts = new Map(); // channelId -> starts in flight (their row may exist before `devices` knows it)
  let closed = false;

  const at = () => new Date(now());
  const log = (what, e) => console.error(`[chat] calls: ${what}`, e?.message || e);
  // A failed emit (one dead socket, an adapter hiccup) is logged and never disturbs the call itself.
  const send = (kind, target, event, payload) => {
    try { emit[kind]?.(target, event, payload); return true; } catch (e) { log(`${event} emit failed`, e); return false; }
  };
  const toChannel = (id, event, payload) => send('toChannel', id, event, payload);
  const toUser = (id, event, payload) => send('toUser', id, event, payload);
  const toSocket = (id, event, payload) => send('toSocket', id, event, payload);

  function arm(fn, ms) {
    const h = timers.setTimeout(() => (closed ? undefined : Promise.resolve().then(fn).catch((e) => log('timer failed', e))), ms);
    h?.unref?.();
    return h;
  }
  const disarm = (h) => { if (h) timers.clearTimeout(h); };

  // Serialises every change to one call (join cap, last leave, sharer) on this process.
  function withLock(callId, fn) {
    const prev = locks.get(callId) || Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(() => {}, () => {});
    locks.set(callId, tail);
    tail.then(() => { if (locks.get(callId) === tail) locks.delete(callId); });
    return run;
  }

  // Notifier hooks never block or break a call, and may be missing (older tests).
  function notify(method, args) {
    try {
      const fn = notifier?.[method];
      if (typeof fn !== 'function') return;
      Promise.resolve(fn.call(notifier, args)).catch((e) => log(`${method} failed`, e));
    } catch (e) { log(`${method} failed`, e); }
  }

  const ownsSocket = (userId, socketId) => {
    if (typeof socketId !== 'string' || !socketId) return false;
    if (typeof emit.userOfSocket === 'function') return emit.userOfSocket(socketId) === userId;
    return !!socketsOfUser?.(userId)?.includes(socketId);
  };
  const mustOwnSocket = (userId, socketId) => {
    if (!ownsSocket(userId, socketId)) throw httpError(400, 'bad_socket', 'That connection is not yours or is no longer open');
  };
  const mustBeMember = async (channelId, userId) => {
    if (!isUuid(channelId) || !(await isMember(db, channelId, userId))) throw httpError(403, 'not_member', 'You are not in this channel');
  };
  const mustFindCall = async (callId) => {
    const call = await getCall(db, callId);
    if (!call) throw httpError(404, 'not_found', 'Call not found');
    return call;
  };
  // A DM call is refused when a call/all restriction exists between the two, either way.
  async function dmRestricted(channel, userId) {
    if (channel?.type !== 'dm') return false;
    const other = (await listMembers(db, channel.id)).find((m) => m.id !== userId);
    if (!other) return false;
    return (await isBlocked(db, { fromUserId: userId, toUserId: other.id, kind: 'call' }))
      || (await isBlocked(db, { fromUserId: other.id, toUserId: userId, kind: 'call' }));
  }
  const channelInfo = (channel) => ({ id: channel.id, type: channel.type, displayName: channel.displayName || '' });
  const ice = (userId) => buildIceServers({ config, userId, now });

  const clearGrace = (callId, userId) => {
    const key = `${callId}:${userId}`;
    disarm(graceTimers.get(key)?.handle);
    graceTimers.delete(key);
  };
  function forget(callId) {
    disarm(ringTimers.get(callId)); ringTimers.delete(callId);
    for (const userId of devices.get(callId)?.keys() || []) clearGrace(callId, userId);
    devices.delete(callId);
  }

  async function postCallMessage(call, content) {
    try {
      const message = await createMessage(db, { channelId: call.channelId, userId: call.initiatedBy, content, type: 'call' });
      toChannel(call.channelId, 'new_message', { message, channel_id: call.channelId });
    } catch (e) { log('call message failed', e); }
  }

  const fmt = (secs) => `${Math.floor(secs / 60)}m ${secs % 60}s`;

  // Ends a live call (caller holds the lock). Returns the finished call or null if it was already over.
  async function end(callId, status, { pushMissed = false } = {}) {
    const names = status === 'ended' ? await participantNames(db, callId) : [];
    const call = await finishCall(db, { callId, status, at: at() });
    forget(callId);
    if (!call) return null;
    const duration = call.durationSecs || 0;
    if (status === 'missed') await postCallMessage(call, `Missed call from ${call.initiatedByName}`);
    else if (status === 'declined') await postCallMessage(call, 'Call declined');
    else await postCallMessage(call, `Voice call — ${fmt(duration)} — ${names.join(', ')}`);
    toChannel(call.channelId, 'call_ended', { call_id: call.id, channel_id: call.channelId, status, duration_secs: duration });
    if (pushMissed) {
      const channel = await getChannel(db, call.channelId);
      const members = await listMembers(db, call.channelId);
      if (channel) notify('onMissedCall', { call, channel: channelInfo(channel), fromName: call.initiatedByName, userIds: members.map((m) => m.id).filter((id) => id !== call.initiatedBy) });
    }
    return call;
  }

  // Leave (caller holds the lock). Idempotent.
  async function leaveLocked(callId, userId) {
    clearGrace(callId, userId);
    const call = await getCall(db, callId);
    if (!call || !LIVE.has(call.status)) return;
    const { wasParticipant, wasSharing } = await removeParticipant(db, { callId, userId, at: at() });
    devices.get(callId)?.delete(userId);
    if (!wasParticipant) return;
    toChannel(call.channelId, 'call_participant_left', { call_id: callId, channel_id: call.channelId, user_id: userId });
    if (wasSharing) toChannel(call.channelId, 'call_screen_share_stopped', { call_id: callId, channel_id: call.channelId, user_id: userId });
    if (call.status === 'ringing') { await end(callId, 'missed'); return; } // the starter hung up before anyone answered: no push
    const remaining = await listParticipants(db, callId);
    const channel = await getChannel(db, call.channelId);
    if (remaining.length === 0 || channel?.type === 'dm') await end(callId, 'ended');
  }

  // A live row this process cannot be carrying: unknown in memory (boot sweep failed or raced; a start
  // still in flight is not stale), or with nobody left in it (an end that failed on a DB blip).
  async function isStale(call, { ownStart = false } = {}) {
    if (!call || !LIVE.has(call.status)) return false;
    if (!devices.has(call.id) && (pendingStarts.get(call.channelId) || 0) <= (ownStart ? 1 : 0)) return true;
    return (await listParticipants(db, call.id)).length === 0;
  }
  // Ends a stale call like sweepStaleCalls (status ended, no system message); caller holds the lock.
  async function endStale(call) {
    const done = await finishCall(db, { callId: call.id, status: 'ended', at: at() });
    forget(call.id);
    if (done) {
      log('ended a stale call', done.id);
      toChannel(done.channelId, 'call_ended', { call_id: done.id, channel_id: done.channelId, status: 'ended', duration_secs: done.durationSecs || 0 });
    }
    return done;
  }
  // Under the call's lock: re-reads the call, repairs it if stale, returns the current row.
  const repair = (callId, opts) => withLock(callId, async () => {
    const call = await getCall(db, callId);
    if (await isStale(call, opts)) { await endStale(call); return { call: await getCall(db, callId), repaired: true }; }
    return { call, repaired: false };
  });

  // The person leaves after the grace unless the device changes (a re-join) in the meantime.
  function scheduleGrace(callId, userId, socketId) {
    if (closed) return;
    const key = `${callId}:${userId}`;
    disarm(graceTimers.get(key)?.handle);
    const handle = arm(() => withLock(callId, async () => {
      if (graceTimers.get(key)?.handle !== handle) return;
      graceTimers.delete(key);
      if (devices.get(callId)?.get(userId) !== socketId) return;
      await leaveLocked(callId, userId);
    }), graceMs);
    graceTimers.set(key, { handle, socketId });
  }

  function ringTimeout(callId) {
    return withLock(callId, async () => {
      ringTimers.delete(callId);
      const call = await getCall(db, callId);
      if (call?.status === 'ringing') await end(callId, 'missed', { pushMissed: true });
    });
  }

  return {
    iceServersFor: (userId) => ice(userId),

    async start({ channelId, user, socketId }) {
      mustOwnSocket(user.id, socketId);
      await mustBeMember(channelId, user.id);
      const channel = await getChannel(db, channelId);
      if (!channel) throw httpError(403, 'not_member', 'You are not in this channel');
      if (await dmRestricted(channel, user.id)) throw httpError(403, 'restricted', RESTRICTED_CALL_MESSAGE);
      let call;
      pendingStarts.set(channelId, (pendingStarts.get(channelId) || 0) + 1);
      try {
        try {
          call = await createCall(db, { channelId, initiatedBy: user.id, at: at() }); // 409 call_in_progress on the unique index
        } catch (e) {
          // A stale live row (unknown here, or empty) must not block the channel: end it and try once more.
          if (e.code !== 'call_in_progress' || !e.callId || !(await repair(e.callId, { ownStart: true })).repaired) throw e;
          call = await createCall(db, { channelId, initiatedBy: user.id, at: at() });
        }
        devices.set(call.id, (devices.get(call.id) || new Map()).set(user.id, socketId));
      } finally {
        const n = (pendingStarts.get(channelId) || 1) - 1;
        if (n > 0) pendingStarts.set(channelId, n); else pendingStarts.delete(channelId);
      }
      // The start socket may have closed while we were awaiting (its disconnect found no device):
      // treat it as a disconnect now so the starter cannot become a ghost participant.
      if (!ownsSocket(user.id, socketId)) scheduleGrace(call.id, user.id, socketId);
      ringTimers.set(call.id, arm(() => ringTimeout(call.id), ringMs));
      const fromName = call.initiatedByName || user.fullName || '';
      toChannel(channelId, 'call_started', {
        call_id: call.id, channel_id: channelId, channel_name: channel.displayName || fromName, channel_type: channel.type,
        initiated_by: user.id, initiated_by_name: fromName, type: call.type,
      });
      const members = await listMembers(db, channelId);
      notify('onIncomingCall', { call, channel: channelInfo(channel), fromName, userIds: members.map((m) => m.id).filter((id) => id !== user.id) });
      return { call, participants: await listParticipants(db, call.id), iceServers: ice(user.id) };
    },

    async join({ callId, user, socketId }) {
      if (!isUuid(callId)) throw httpError(404, 'not_found', 'Call not found');
      return withLock(callId, async () => {
        let call = await mustFindCall(callId);
        await mustBeMember(call.channelId, user.id);
        if (await isStale(call)) { await endStale(call); call = await getCall(db, callId); }
        if (!LIVE.has(call.status)) throw httpError(409, 'call_ended', 'This call has ended');
        const channel = await getChannel(db, call.channelId);
        if (await dmRestricted(channel, user.id)) throw httpError(403, 'restricted', RESTRICTED_CALL_MESSAGE);
        const current = await listParticipants(db, callId);
        const already = current.some((p) => p.userId === user.id);
        if (!already && current.length >= maxParticipants) throw httpError(403, 'call_full', 'This call is full');
        mustOwnSocket(user.id, socketId);

        // The device is recorded only once the person really is a participant.
        if (!already) await addParticipant(db, { callId, userId: user.id, at: at() });
        clearGrace(callId, user.id);
        if (!devices.has(callId)) devices.set(callId, new Map());
        devices.get(callId).set(user.id, socketId);
        // Same guard as start: a socket that closed while we awaited gets the normal grace leave.
        if (!ownsSocket(user.id, socketId)) scheduleGrace(callId, user.id, socketId);
        if (call.status === 'ringing' && (already ? current.length : current.length + 1) >= 2) {
          call = (await activateCall(db, { callId, at: at() })) || call;
          disarm(ringTimers.get(callId)); ringTimers.delete(callId);
        }
        // Also sent on a re-join from another tab: the others rebuild their peer to the new device,
        // and the user's other tabs stop ringing.
        toChannel(call.channelId, 'call_participant_joined', { call_id: callId, channel_id: call.channelId, user_id: user.id, user_name: user.fullName || '' });
        return { call: await getCall(db, callId), participants: await listParticipants(db, callId), iceServers: ice(user.id) };
      });
    },

    async leave({ callId, userId }) {
      if (!isUuid(callId)) return;
      await withLock(callId, () => leaveLocked(callId, userId));
    },

    async decline({ callId, user }) {
      if (!isUuid(callId)) throw httpError(404, 'not_found', 'Call not found');
      return withLock(callId, async () => {
        const call = await mustFindCall(callId);
        await mustBeMember(call.channelId, user.id);
        if (call.status === 'ringing' && call.initiatedBy !== user.id) {
          const channel = await getChannel(db, call.channelId);
          if (channel?.type === 'dm') { await end(callId, 'declined'); return; }
        }
        toUser(user.id, 'call_dismissed', { call_id: callId });
      });
    },

    /** Only the participant's call device (the socket they joined on) may toggle their share. */
    async screenShare({ callId, userId, on, socketId }) {
      if (!isUuid(callId)) throw httpError(403, 'not_in_call', 'You are not in this call');
      return withLock(callId, async () => {
        const call = await getCall(db, callId);
        if (!call || !LIVE.has(call.status)) throw httpError(403, 'not_in_call', 'You are not in this call');
        const device = devices.get(callId)?.get(userId);
        if (device === undefined) throw httpError(403, 'not_in_call', 'You are not in this call');
        if (typeof socketId !== 'string' || device !== socketId) throw httpError(400, 'bad_socket', 'Share your screen from the tab that is in the call');
        const result = await setScreenShare(db, { callId, userId, on: !!on });
        if (result === 'not_in_call') throw httpError(403, 'not_in_call', 'You are not in this call');
        if (result === 'already_sharing') throw httpError(409, 'already_sharing', 'Someone else is already sharing their screen');
        if (result === 'changed') {
          toChannel(call.channelId, on ? 'call_screen_share_started' : 'call_screen_share_stopped', { call_id: callId, channel_id: call.channelId, user_id: userId });
        }
      });
    },

    async get({ callId, userId }) {
      const found = await mustFindCall(callId);
      await mustBeMember(found.channelId, userId);
      const { call } = LIVE.has(found.status) ? await repair(callId) : { call: found };
      return { call, participants: await listParticipants(db, callId) };
    },

    async activeCall({ channelId, userId }) {
      await mustBeMember(channelId, userId);
      const live = await getLiveCall(db, channelId);
      const call = live ? (await repair(live.id)).call : null;
      if (!call || !LIVE.has(call.status)) return { call: null, participants: [] };
      return { call, participants: await listParticipants(db, call.id) };
    },

    async listCalls({ channelId, userId }) {
      await mustBeMember(channelId, userId);
      return listCalls(db, channelId, { limit: 30 });
    },

    /** Delivers a WebRTC signal to the target's call socket; returns false (dropped) otherwise. */
    relaySignal({ fromSocketId, fromUserId, callId, toUserId, signalData }) {
      const map = devices.get(callId);
      const to = Number(toUserId);
      if (!map || to === fromUserId || map.get(fromUserId) !== fromSocketId) return false;
      const target = map.get(to);
      if (!target) return false;
      let size;
      try { size = Buffer.byteLength(JSON.stringify(signalData ?? null) ?? ''); } catch { return false; }
      if (size > MAX_SIGNAL_BYTES) return false;
      return toSocket(target, 'webrtc_signal', { call_id: callId, from_user_id: fromUserId, signal_data: signalData });
    },

    /** A socket went away: if it carried someone's call, they leave after the grace unless they re-join. */
    onSocketDisconnect(socketId, userId) {
      if (closed) return;
      for (const [callId, map] of devices) {
        if (map.get(userId) === socketId) scheduleGrace(callId, userId, socketId);
      }
    },

    /** Boot: calls left ringing/active by a previous process are over (status ended, no message). */
    async sweepStaleCalls() {
      const n = await sweepRows(db, { at: at() });
      if (n) console.log(`[chat] ended ${n} stale call(s) from before the restart`);
      return n;
    },

    close() {
      closed = true;
      for (const h of ringTimers.values()) disarm(h);
      for (const g of graceTimers.values()) disarm(g.handle);
      ringTimers.clear(); graceTimers.clear(); devices.clear();
    },
  };
}
