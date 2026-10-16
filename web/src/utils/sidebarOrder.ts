import type { Channel } from '../types/index.ts';

/**
 * The sidebar the way this person arranged it, kept in the browser: the order of rows in each
 * section (drag a row to move it), and whether Direct messages shows only recent ones.
 */
export type Section = 'favourites' | 'rooms' | 'dms';
export type Order = Record<Section, string[]>;
const ORDER_KEY = 'chat.order';
const RECENT_KEY = 'chat.dmsRecent';
/** A direct message counts as recent for this long after its last message. */
export const RECENT_DAYS = 14;

export function loadOrder(): Order {
  const empty: Order = { favourites: [], rooms: [], dms: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) || '{}');
    for (const k of Object.keys(empty) as Section[])
      if (Array.isArray(raw?.[k])) empty[k] = raw[k].filter((x: unknown) => typeof x === 'string');
  } catch {
    /* nothing kept */
  }
  return empty;
}

export function saveOrder(order: Order): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode */
  }
}

/** The list in the kept order: rows that were arranged first, in that order; the rest after, as they came. */
export function applyOrder<T extends { id: string }>(list: T[], ids: string[]): T[] {
  if (!ids.length) return list;
  const rank = new Map(ids.map((id, i) => [id, i]));
  const known = list.filter((c) => rank.has(c.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = list.filter((c) => !rank.has(c.id));
  return [...known, ...rest];
}

/**
 * The ids after dragging `dragged` onto `target` within the list `ids` (the section as shown):
 * above the target when moving up, below it when moving down.
 */
export function moveId(ids: string[], dragged: string, target: string): string[] {
  if (dragged === target || !ids.includes(dragged) || !ids.includes(target)) return ids;
  const from = ids.indexOf(dragged);
  const without = ids.filter((id) => id !== dragged);
  const at = without.indexOf(target);
  const insertAt = from < ids.indexOf(target) ? at + 1 : at;
  return [...without.slice(0, insertAt), dragged, ...without.slice(insertAt)];
}

/**
 * Direct messages newest first: the person who last wrote (or was written to) is at the top, so
 * whoever just messaged is easy to find. Conversations with no message yet go last, except the
 * one open now (just started), which leads.
 */
export function byLatest<T extends { id: string; lastMessageAt: string | null; dmUserName?: string | null }>(
  list: T[],
  currentId: string | null = null,
): T[] {
  const at = (c: T) => (c.lastMessageAt ? new Date(c.lastMessageAt).getTime() || 0 : 0);
  return [...list].sort((a, b) => {
    if (a.id === currentId && !a.lastMessageAt) return -1;
    if (b.id === currentId && !b.lastMessageAt) return 1;
    const d = at(b) - at(a);
    if (d) return d;
    return (a.dmUserName || '').localeCompare(b.dmUserName || '');
  });
}

export function loadDmsRecent(): boolean {
  try {
    return localStorage.getItem(RECENT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveDmsRecent(on: boolean): void {
  try {
    localStorage.setItem(RECENT_KEY, String(on));
  } catch {
    /* private mode */
  }
}

/** The direct messages worth showing when "Recent" is on: unread, open, favourite, or active in the last two weeks. */
export function recentDms(dms: Channel[], currentId: string | null, now = Date.now()): Channel[] {
  const cutoff = now - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return dms.filter(
    (c) =>
      c.id === currentId ||
      c.unreadCount > 0 ||
      c.mentionCount > 0 ||
      !!c.favourite ||
      (!!c.lastMessageAt && new Date(c.lastMessageAt).getTime() >= cutoff),
  );
}
