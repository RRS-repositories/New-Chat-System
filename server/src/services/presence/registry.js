/**
 * Who is connected. In-process (one chat-server instance).
 * Interface: connect(userId, socketId) -> { first }, disconnect(userId, socketId, onOffline),
 * setAway(userId, socketId, away) -> { changed, away }, isConnected(userId), isAway(userId),
 * socketsOf(userId), snapshot() -> { online, away }, close().
 *
 * A user is kept in the registry from their first socket until `graceMs` after their last one
 * closed, so a page reload does not flicker offline/online. During that grace they have no live
 * socket (isConnected is false, so push goes to them) but still appear in the snapshot, because
 * nobody has been told `user_offline` yet. A user is away only when every live socket says so.
 * `timers` is injectable for tests; the default timers are unref()d so they never hold the process.
 */
export function createPresence({ graceMs = 5000, timers = null } = {}) {
  const setT = (fn, ms) => {
    const t = timers ? timers.setTimeout(fn, ms) : setTimeout(fn, ms);
    t?.unref?.();
    return t;
  };
  const clearT = (t) => (timers ? timers.clearTimeout(t) : clearTimeout(t));
  const grace = Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : 5000;

  // userId -> { sockets: Map<socketId, away:boolean>, away: boolean, timer }
  const users = new Map();
  const computeAway = (e) => (e.sockets.size ? [...e.sockets.values()].every(Boolean) : e.away);
  let closed = false;

  return {
    /** Shutdown: cancel every pending offline grace; no onOffline fires after this. */
    close() {
      closed = true;
      for (const e of users.values())
        if (e.timer) {
          clearT(e.timer);
          e.timer = null;
        }
    },

    connect(userId, socketId) {
      let e = users.get(userId);
      const first = !e;
      if (!e) {
        e = { sockets: new Map(), away: false, timer: null };
        users.set(userId, e);
      }
      if (e.timer) {
        clearT(e.timer);
        e.timer = null;
      }
      e.sockets.set(socketId, false);
      e.away = computeAway(e);
      return { first };
    },

    disconnect(userId, socketId, onOffline) {
      const e = users.get(userId);
      if (!e || !e.sockets.delete(socketId)) return;
      if (e.sockets.size) {
        e.away = computeAway(e);
        return;
      }
      if (closed) return;
      // Last socket: after the grace, if nothing came back, the user is offline.
      e.timer = setT(() => {
        if (closed || users.get(userId) !== e || e.sockets.size) return;
        users.delete(userId);
        try {
          onOffline?.(userId);
        } catch (err) {
          console.error('[chat] presence onOffline failed', err?.message || err);
        }
      }, grace);
    },

    setAway(userId, socketId, away) {
      const e = users.get(userId);
      if (!e || !e.sockets.has(socketId)) return { changed: false, away: e ? e.away : false };
      const before = e.away;
      e.sockets.set(socketId, !!away);
      e.away = computeAway(e);
      return { changed: before !== e.away, away: e.away };
    },

    isConnected: (userId) => (users.get(userId)?.sockets.size || 0) > 0,
    isAway: (userId) => users.get(userId)?.away ?? false,
    socketsOf: (userId) => [...(users.get(userId)?.sockets.keys() || [])],

    snapshot() {
      const online = [],
        away = [];
      for (const [id, e] of users) (e.away ? away : online).push(id);
      return { online: online.sort((a, b) => a - b), away: away.sort((a, b) => a - b) };
    },
  };
}
