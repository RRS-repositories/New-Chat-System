/**
 * Breakout groups: the host splits a live call into named groups (for training, say).
 *
 * The server keeps who is in which group and tells everyone in the call. The sound is separated
 * by each person's own browser: it stops sending their voice to anyone outside their group.
 * Anyone not put in a group stays with the host in the main room; the host is always there.
 *
 * The host sends the whole arrangement each time it changes (at most 8 people, so it is small),
 * then opens the groups, and later brings everyone back. While groups are open, screen sharing
 * and the whiteboard are paused (the call service asks `isActive`).
 *
 * Kept in memory per live call and forgotten when the call ends.
 */
export const MAX_GROUPS = 6;
const NAME_MAX = 40;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The groups as the host sent them, made safe: at most six, each with an id and a name, holding
 * only people who are in the call, nobody twice, never the host. Null when it is not a list of groups.
 */
export function cleanGroups(groups, { inCall, hostId }) {
  if (!Array.isArray(groups) || groups.length > MAX_GROUPS) return null;
  const taken = new Set();
  const ids = new Set();
  const out = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') return null;
    const { id, name, member_ids: members } = group;
    if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) return null;
    if (typeof name !== 'string' || !Array.isArray(members)) return null;
    const label = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!label) return null;
    ids.add(id);
    const memberIds = [];
    for (const value of members) {
      const userId = Number(value);
      if (!Number.isInteger(userId) || userId === hostId || !inCall.has(userId) || taken.has(userId)) continue;
      taken.add(userId);
      memberIds.push(userId);
    }
    out.push({ id, name: label, member_ids: memberIds });
  }
  return out;
}

export function createCallBreakouts({ devices, toCall }) {
  const states = new Map(); // callId -> { active, groups: [{ id, name, member_ids }] }
  const EMPTY = { active: false, groups: [] };
  const of = (callId) => states.get(callId) || EMPTY;
  const anyoneOut = (groups) => groups.some((g) => g.member_ids.length > 0);

  function tell(callId) {
    const { active, groups } = of(callId);
    toCall(callId, 'call_bo_state', { call_id: callId, active, groups });
  }
  /** Stores the arrangement. Open groups close by themselves when the last person leaves them. */
  function store(callId, { active, groups }) {
    const next = { active: active && anyoneOut(groups), groups };
    if (!next.active && next.groups.length === 0) states.delete(callId);
    else states.set(callId, next);
    tell(callId);
    return next;
  }
  const fromHost = (callId, userId, socketId, hostId) =>
    typeof socketId === 'string' && hostId === userId && devices.get(callId)?.get(userId) === socketId;

  return {
    /** For a person joining the call: someone who was only disconnected lands back in their group. */
    snapshot: (callId) => ({ breakout: of(callId) }),
    isActive: (callId) => of(callId).active,

    /** The host's arrangement of groups (planning it, or moving people while the groups are open). */
    set({ callId, userId, socketId, hostId, groups }) {
      if (!fromHost(callId, userId, socketId, hostId)) return false;
      const clean = cleanGroups(groups, { inCall: devices.get(callId), hostId });
      if (!clean) return false;
      store(callId, { active: of(callId).active, groups: clean });
      return true;
    },

    /** Opens the groups. Needs at least one person in a group. */
    start({ callId, userId, socketId, hostId }) {
      if (!fromHost(callId, userId, socketId, hostId)) return false;
      const current = of(callId);
      if (current.active || !anyoneOut(current.groups)) return false;
      store(callId, { active: true, groups: current.groups });
      return true;
    },

    /** Brings everyone back to one room. The groups are kept, so they can be opened again. */
    end({ callId, userId, socketId, hostId }) {
      if (!fromHost(callId, userId, socketId, hostId)) return false;
      const current = of(callId);
      if (!current.active) return false;
      store(callId, { active: false, groups: current.groups });
      return true;
    },

    /** Someone left the call: they leave their group too. */
    onLeft(callId, userId) {
      const current = states.get(callId);
      if (!current || !current.groups.some((g) => g.member_ids.includes(userId))) return;
      store(callId, {
        active: current.active,
        groups: current.groups.map((g) => ({ ...g, member_ids: g.member_ids.filter((id) => id !== userId) })),
      });
    },

    /** The host changed: the new host belongs in the main room, where the people without a group are. */
    onHostChanged(callId, hostId) {
      this.onLeft(callId, hostId);
    },

    /** The call is over. */
    forget(callId) {
      states.delete(callId);
    },
  };
}
