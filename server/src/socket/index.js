import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { socketAuth, loadSessionUser } from '../auth.js';
import { isMember, markRead } from '../repo/channels.js';
import { attachPresence } from './presence.js';
import { attachCallSignalling } from './calls.js';

const TYPING_THROTTLE_MS = 3000;
const SESSION_RECHECK_MS = 60_000;
export const channelRoom = (id) => `channel:${id}`;
export const userRoom = (id) => `user:${id}`;

// `presence` is the registry from presence/registry.js; `getCalls` returns the call
// service (created after the sockets, because it needs `emit`) or null.
export function attachSocket(io, { db, secret, aud, redisUrl, sessionRecheckMs = SESSION_RECHECK_MS, requireBeta = false, presence = null, getCalls = () => null }) {
  let pub = null, sub = null;
  if (redisUrl) {
    pub = new Redis(redisUrl); sub = pub.duplicate();
    for (const c of [pub, sub]) c.on('error', (e) => console.error('[chat] redis', e.message));
    io.adapter(createAdapter(pub, sub));
  }
  const nsp = io.of('/chat');
  nsp.use(socketAuth({ db, secret, aud, requireBeta }));

  const lastTyping = new Map(); // `${userId}:${channelId}` -> ms

  nsp.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(userRoom(user.id));

    // Handlers first, so a mark_read sent right after 'connect' is not lost
    // while the channel list is still loading.
    socket.on('join_channel', async ({ channel_id } = {}, ack) => {
      const ok = channel_id && (await isMember(db, channel_id, user.id).catch(() => false));
      if (ok) socket.join(channelRoom(channel_id));
      if (typeof ack === 'function') ack({ ok: !!ok });
    });

    socket.on('typing', ({ channel_id } = {}) => {
      if (!channel_id || !socket.rooms.has(channelRoom(channel_id))) return;
      const key = `${user.id}:${channel_id}`; const now = Date.now();
      if (now - (lastTyping.get(key) || 0) < TYPING_THROTTLE_MS) return;
      lastTyping.set(key, now);
      socket.to(channelRoom(channel_id)).emit('typing', { channel_id, user_id: user.id, user_name: user.fullName });
    });

    socket.on('mark_read', async ({ channel_id } = {}, ack) => {
      try {
        if (!channel_id || !(await isMember(db, channel_id, user.id))) throw new Error('not_member');
        await markRead(db, channel_id, user.id);
        // The user's OTHER sockets (phone + desktop) clear their badge too.
        socket.to(userRoom(user.id)).emit('unread_update', { channel_id, unread_count: 0, mention_count: 0 });
        if (typeof ack === 'function') ack({ ok: true });
      } catch (e) { if (typeof ack === 'function') ack({ ok: false, error: e.message }); }
    });

    // A live socket is re-checked against the same rules as the handshake, so
    // a password reset, deactivation or account lock ends it within a minute
    // instead of at the token's 7-day expiry. Same for the chat.beta flag: if
    // it's revoked live (or the beta gate is turned on) the socket is dropped
    // within a minute too, not just refused on the next reconnect.
    const recheck = setInterval(async () => {
      try {
        const still = await loadSessionUser(db, { userId: user.id, iat: socket.data.iat ?? null });
        if (!still) { socket.emit('session_ended', { reason: 'token_invalid' }); socket.disconnect(true); return; }
        if (requireBeta && !still.chatEnabled) { socket.emit('session_ended', { reason: 'chat_not_enabled' }); socket.disconnect(true); }
      } catch (e) { console.error('[chat] session recheck failed', e.message); }
    }, sessionRecheckMs);
    socket.on('disconnect', () => clearInterval(recheck));

    // Presence (online/away/offline) and call signalling for this connection.
    if (presence) attachPresence({ nsp, socket, user, presence, db });
    attachCallSignalling({ nsp, socket, user, calls: getCalls() });

    (async () => {
      let channelIds = [];
      try {
        const { rows } = await db.query(`SELECT channel_id FROM chat.channel_members WHERE user_id = $1`, [user.id]);
        channelIds = rows.map((r) => r.channel_id);
      } catch (e) { console.error('[chat] channel list failed', e.message); }
      for (const id of channelIds) socket.join(channelRoom(id));
      socket.emit('ready', { user, channel_ids: channelIds });
    })();
  });

  return {
    emit: {
      toChannel: (channelId, event, payload) => nsp.to(channelRoom(channelId)).emit(event, payload),
      toUser: (userId, event, payload) => nsp.to(userRoom(userId)).emit(event, payload),
      toSocket: (socketId, event, payload) => nsp.to(socketId).emit(event, payload),
      toAll: (event, payload) => nsp.emit(event, payload),
      // The user id behind a live socket id on this process, or null (calls are bound to one socket).
      userOfSocket: (socketId) => nsp.sockets.get(socketId)?.data?.user?.id ?? null,
      // Rooms mirror membership: every socket of a user joins/leaves the channel
      // room when membership changes (works across the Redis adapter).
      joinRoom: (userId, channelId) => nsp.in(userRoom(userId)).socketsJoin(channelRoom(channelId)),
      leaveRoom: (userId, channelId) => nsp.in(userRoom(userId)).socketsLeave(channelRoom(channelId)),
    },
    async close() { if (pub) { await pub.quit().catch(() => {}); await sub.quit().catch(() => {}); } },
  };
}
