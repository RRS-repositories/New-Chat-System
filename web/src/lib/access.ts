import type { Restriction, RestrictionType } from '../api/types.ts';

/** The three things one person can be stopped from doing to another. */
export const ACCESS_KINDS = ['dm', 'call', 'channel'] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];
export const KIND_LABEL: Record<AccessKind, string> = { dm: 'Messages', call: 'Calls', channel: 'Private channels' };

export type Blocked = Record<AccessKind, boolean>;
export type PairAccess = { out: Blocked; in: Blocked };   // out: this person → other; in: other → this person
const none = (): Blocked => ({ dm: false, call: false, channel: false });

function mark(b: Blocked, r: RestrictionType) {
  if (r === 'all') { b.dm = true; b.call = true; b.channel = true; } else b[r] = true;
}

/** For one person: what they are blocked from doing to each other person, and what each other person is blocked from doing to them. */
export function accessMap(userId: number, restrictions: Restriction[]): Map<number, PairAccess> {
  const map = new Map<number, PairAccess>();
  const at = (id: number) => { let p = map.get(id); if (!p) { p = { out: none(), in: none() }; map.set(id, p); } return p; };
  for (const r of restrictions) {
    if (r.userId === userId && r.targetUserId !== userId) mark(at(r.targetUserId).out, r.restriction);
    else if (r.targetUserId === userId && r.userId !== userId) mark(at(r.userId).in, r.restriction);
  }
  return map;
}

export const anyBlocked = (b: Blocked) => b.dm || b.call || b.channel;
export const allBlocked = (b: Blocked) => b.dm && b.call && b.channel;

/** "Messages, Calls" — the kinds blocked, for the small "they cannot…" note. */
export const blockedList = (b: Blocked): string => ACCESS_KINDS.filter((k) => b[k]).map((k) => KIND_LABEL[k]).join(', ');

/** People matching the search box and the role filter (case-insensitive on name, email and role). */
export function filterPeople<T extends { fullName: string; role: string; email?: string }>(people: T[], query: string, role: string): T[] {
  const q = query.trim().toLowerCase();
  return people.filter((p) => (!role || p.role === role) && (!q || p.fullName.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || p.role.toLowerCase().includes(q)));
}
