import type { Message } from '../types/index.ts';

/**
 * Which message the NEW line goes above: the oldest of the last `unread` messages written by other
 * people. When more are unread than are on the page, it is the first message on the page.
 * Returns null when nothing is unread or the page holds no message from anyone else.
 */
export function firstNewMessageId(items: Message[], selfId: number, unread: number): string | null {
  if (unread <= 0) return null;
  let left = unread;
  let firstNew: string | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i]!;
    if (m.userId === selfId || m.type === 'system') continue;
    firstNew = m.id;
    left -= 1;
    if (left === 0) break;
  }
  return firstNew;
}
