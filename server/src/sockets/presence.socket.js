import { touchLastSeen } from '../models/presence.model.js';

/**
 * Presence events for one connection: user_online / user_away / user_offline (to everyone on
 * the namespace), and the last_seen_at write when the user's last socket is gone for good.
 * Nothing here may throw into the socket layer: failures are logged.
 */
export function attachPresence({ nsp, socket, user, presence, db }) {
  const uid = user.id;
  const safe = (label, fn) => { try { fn(); } catch (e) { console.error(`[chat] presence ${label} failed`, e?.message || e); } };
  const isAway = () => presence.isAway?.(uid) ?? false;
  // last_seen_at is written when the user comes online and when they go offline, so someone
  // connected since before a restart (or never disconnected) is not seen as long gone.
  const recordLastSeen = (userId) => Promise.resolve()
    .then(() => touchLastSeen(db, userId))
    .catch((e) => console.error('[chat] last_seen_at write failed', e?.message || e));

  safe('connect', () => {
    const wasAway = isAway();
    const { first } = presence.connect(uid, socket.id);
    if (first) { nsp.emit('user_online', { user_id: uid }); recordLastSeen(uid); }
    // A new tab is active, so a user who was away is not any more.
    else if (wasAway && !isAway()) nsp.emit('user_away', { user_id: uid, away: false });
  });

  socket.on('set_away', (payload) => safe('set_away', () => {
    const away = payload?.away;
    if (typeof away !== 'boolean') return;
    const r = presence.setAway(uid, socket.id, away);
    if (r.changed) nsp.emit('user_away', { user_id: uid, away: r.away });
  }));

  socket.on('disconnect', () => safe('disconnect', () => {
    const wasAway = isAway();
    presence.disconnect(uid, socket.id, (userId) => {
      nsp.emit('user_offline', { user_id: userId });
      recordLastSeen(userId);
    });
    // Closing the only active tab leaves the others (all away) → the user is now away.
    if (presence.isConnected(uid) && isAway() !== wasAway) nsp.emit('user_away', { user_id: uid, away: isAway() });
  }));
}
