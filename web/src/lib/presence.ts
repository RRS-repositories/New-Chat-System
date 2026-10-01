import type { UserStatus } from '../api/types.ts';

/** Who is connected, as kept in the reducer (records rather than Sets so state stays plain and comparable). */
export type Presence = { online: Record<number, true>; away: Record<number, true>; statuses: Record<number, UserStatus> };
export type PresenceState = 'online' | 'away' | 'offline';

export const AWAY_AFTER_MS = 5 * 60 * 1000;

export function presenceOf(p: Presence, userId: number | null | undefined): PresenceState {
  if (userId == null || !p.online[userId]) return 'offline';
  return p.away[userId] ? 'away' : 'online';
}

/** Away after 5 minutes without pointer/keyboard input in the chat, or 5 minutes of the chat not being looked at. */
export function computeAway({ now, lastInputAt, notLookingSince }: { now: number; lastInputAt: number; notLookingSince: number | null }): boolean {
  if (now - lastInputAt >= AWAY_AFTER_MS) return true;
  return notLookingSince !== null && now - notLookingSince >= AWAY_AFTER_MS;
}

/**
 * After input or on the chat being looked at again: should we send `set_away { away: false }`?
 * Only when we had said "away" and, with this fresh activity, we no longer are.
 */
export function backFromAway(s: { sentAway: boolean; now: number; lastInputAt: number; notLookingSince: number | null }): boolean {
  return s.sentAway && !computeAway(s);
}
