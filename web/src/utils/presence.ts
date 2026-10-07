import type { UserStatus } from '../types/index.ts';

/** Who is connected, as kept in the reducer (records rather than Sets so state stays plain and comparable). */
export type Presence = {
  online: Record<number, true>;
  away: Record<number, true>;
  statuses: Record<number, UserStatus>;
};
export type PresenceState = 'online' | 'away' | 'offline';

export const AWAY_AFTER_MS = 5 * 60 * 1000;

export function presenceOf(p: Presence, userId: number | null | undefined): PresenceState {
  if (userId == null || !p.online[userId]) return 'offline';
  return p.away[userId] ? 'away' : 'online';
}

/** Away after 5 minutes without pointer/keyboard input in the chat, or 5 minutes of the chat not being looked at. */
export function computeAway({
  now,
  lastInputAt,
  notLookingSince,
}: {
  now: number;
  lastInputAt: number;
  notLookingSince: number | null;
}): boolean {
  if (now - lastInputAt >= AWAY_AFTER_MS) return true;
  return notLookingSince !== null && now - notLookingSince >= AWAY_AFTER_MS;
}

/**
 * After input or on the chat being looked at again: should we send `set_away { away: false }`?
 * Only when we had said "away" and, with this fresh activity, we no longer are.
 */
export function backFromAway(s: {
  sentAway: boolean;
  now: number;
  lastInputAt: number;
  notLookingSince: number | null;
}): boolean {
  return s.sentAway && !computeAway(s);
}

/**
 * Keeps the live presence events straight with the snapshot fetched on (re)connect. The snapshot is
 * fetched over HTTP, so an online/offline/away event can arrive while it is still on its way; when
 * the older snapshot then lands it would overwrite that event (a person shown Offline in one tab
 * and Online in another, after a restart made everyone reconnect at once). So: every event is
 * applied at once, and the events that arrived during a fetch are applied again after the snapshot.
 */
export function createSnapshotReplay<A>(apply: (action: A) => void) {
  let fetching = 0;
  const during: A[] = [];
  return {
    /** A live event: apply it now, and remember it if a snapshot is still on its way. */
    event(action: A) {
      apply(action);
      if (fetching) during.push(action);
    },
    /** The snapshot fetch starts. */
    begin() {
      fetching += 1;
    },
    /** The snapshot fetch ends (with the snapshot's action, or nothing when it failed). */
    end(snapshot?: A) {
      fetching = Math.max(0, fetching - 1);
      if (snapshot !== undefined) apply(snapshot);
      if (!fetching) {
        const replay = during.splice(0);
        if (snapshot !== undefined) for (const a of replay) apply(a);
      }
    },
  };
}
