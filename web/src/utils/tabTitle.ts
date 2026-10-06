import type { Channel } from '../types/index.ts';

export type TabBadge = { count: number };

/**
 * What the browser tab should say: "(n) Chat", where every channel with unread messages counts as
 * one (however many messages it holds) and every unread direct message counts as one; the plain
 * title when all is read. The open channel is already counted as read by the time this runs.
 */
export function tabBadge(channels: Channel[]): TabBadge {
  let count = 0;
  for (const c of channels) {
    const unread = Math.max(c.unreadCount || 0, c.mentionCount || 0);
    if (!unread) continue;
    count += c.type === 'dm' ? unread : 1;
  }
  return { count };
}

export function tabTitle(badge: TabBadge, appTitle: string): string {
  return badge.count ? `(${badge.count}) ${appTitle}` : appTitle;
}
