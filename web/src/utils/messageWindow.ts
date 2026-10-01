import type { Message } from '../types/index.ts';

/**
 * How much of a channel is kept on the page. A channel can hold any number of messages; the page
 * holds a window of it and asks the server for older or newer pages as the person scrolls. This is
 * what keeps a very long channel as light as a short one.
 */

/** The most messages of one channel kept on the page (eight pages of 50). */
export const MAX_HELD = 400;
/** What a channel that is not open keeps: its newest page, so opening it again is instant. */
export const KEEP_WHEN_AWAY = 50;

/** Where a message sits in its channel, to page older or newer from it. The server sends the exact position. */
export const cursorOf = (m: Message): string => m.cursor ?? `${m.createdAt}|${m.id}`;

/** Older messages were added at the top: keep the oldest MAX_HELD. `dropped` says newer ones were let go. */
export function keepOldest(items: Message[]): { items: Message[]; dropped: boolean } {
  return items.length > MAX_HELD ? { items: items.slice(0, MAX_HELD), dropped: true } : { items, dropped: false };
}

/**
 * Keep the newest `keep` messages. Returns the cursor for paging older from the new top, or null
 * when nothing was dropped (the caller keeps the cursor it already has).
 */
export function keepNewest(items: Message[], keep = MAX_HELD): { items: Message[]; olderCursor: string | null } {
  if (items.length <= keep) return { items, olderCursor: null };
  const kept = items.slice(-keep);
  return { items: kept, olderCursor: cursorOf(kept[0]!) };
}
