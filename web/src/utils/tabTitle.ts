import type { Channel } from '../types/index.ts';

export type TabBadge = { count: number; dot: boolean };

/**
 * What the browser tab should say, the way people knew it from Mattermost: a number for the things
 * that call for you (mentions, and unread direct messages), a dot when other channels have unread
 * messages, nothing when all is read. The open channel is already counted as read by the time this runs.
 */
export function tabBadge(channels: Channel[]): TabBadge {
  let count = 0;
  let dot = false;
  for (const c of channels) {
    const mentions = c.mentionCount || 0;
    const unread = c.unreadCount || 0;
    if (c.type === 'dm') count += Math.max(mentions, unread);
    else {
      count += mentions;
      if (unread > mentions) dot = true;
    }
  }
  return { count, dot };
}

export function tabTitle(badge: TabBadge, appTitle: string): string {
  if (badge.count) return `(${badge.count}) ${appTitle}`;
  return badge.dot ? `• ${appTitle}` : appTitle;
}
