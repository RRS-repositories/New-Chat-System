import type { Restriction, RestrictionInput, RestrictionType, UserOption } from '../types/index.ts';

/** Allowed types, in form order; `all` is the default. */
export const RESTRICTION_TYPES = ['all', 'dm', 'call', 'channel'] as const satisfies readonly RestrictionType[];

const LABELS: Record<RestrictionType, string> = { all: 'Everything', dm: 'Direct messages', call: 'Calls', channel: 'Private channels' };
const VERBS: Record<RestrictionType, string> = { all: 'cannot contact', dm: 'cannot message', call: 'cannot call', channel: 'cannot share private channels with' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const typeLabel = (t: RestrictionType): string => LABELS[t] ?? t;
const isType = (t: unknown): t is RestrictionType => (RESTRICTION_TYPES as readonly unknown[]).includes(t);
const nameOr = (name: string | null, id: number) => name || `User #${id}`;

/** "12 Sep 2026" in Europe/London; '' when the date cannot be parsed. */
function formatDate(iso: string): string {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d)) p[part.type] = part.value;
  return `${+p.day!} ${MONTHS[+p.month! - 1]} ${p.year}`;
}

export type RestrictionRow = { id: string; user: string; blockedFrom: string; target: string; type: string; setBy: string; date: string; reason: string };

/** Display strings for one table row: User | Blocked from | Target | Type | Set by | Date. */
export function restrictionRow(r: Restriction): RestrictionRow {
  return {
    id: r.id, user: nameOr(r.userName, r.userId), blockedFrom: VERBS[r.restriction] ?? 'is blocked from', target: nameOr(r.targetName, r.targetUserId),
    type: typeLabel(r.restriction), setBy: nameOr(r.restrictedByName, r.restrictedBy), date: formatDate(r.createdAt), reason: r.reason || '',
  };
}

export type RestrictionForm = { userId: number | null; targetUserId: number | null; restriction: string };

/** First problem with the add form, or null when it can be submitted. */
export function validateRestrictionForm(f: RestrictionForm): string | null {
  if (f.userId == null) return 'Choose a user';
  if (f.targetUserId == null) return 'Choose a target';
  if (f.userId === f.targetUserId) return 'User and target must be different people';
  if (!isType(f.restriction)) return 'Choose a restriction type';
  return null;
}

/** Request body for POST /api/chat/admin/restrictions (call after validateRestrictionForm). */
export function toRestrictionInput(f: { userId: number; targetUserId: number; restriction: RestrictionType; reason: string; bothWays: boolean }): RestrictionInput {
  const reason = f.reason.trim();
  return { userId: f.userId, targetUserId: f.targetUserId, restriction: f.restriction, ...(reason ? { reason } : {}), bothWays: f.bothWays };
}

/**
 * The pickers' list: GET /api/chat/users never includes the caller (and hides
 * people the caller is restricted from), so the caller is added back here.
 */
export function withSelfSorted(users: UserOption[], self: UserOption): UserOption[] {
  const all = users.some((u) => u.id === self.id) ? users : [...users, self];
  return all.map(({ id, fullName, role }) => ({ id, fullName, role })).sort((a, b) => a.fullName.localeCompare(b.fullName, 'en-GB', { sensitivity: 'base' }));
}

export const isManagement = (u: { role: string }) => u.role === 'Management';
