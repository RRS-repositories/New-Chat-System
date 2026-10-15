import type { Channel } from '../types/index.ts';
import { nameScore } from './quickFind.ts';

/** The name a sidebar row is known by: the person for a direct message, the channel otherwise. */
export const rowName = (c: Channel): string => (c.type === 'dm' ? c.dmUserName || '' : c.displayName || '');

/** The rows that match what was typed in the sidebar's filter box, in their usual order. Blank: all. */
export function filterRows(channels: Channel[], typed: string): Channel[] {
  const q = typed.trim();
  if (!q) return channels;
  return channels.filter((c) => nameScore(rowName(c), q) > 0);
}

/** The row Enter opens: the best match (a name starting with what was typed beats one containing it). */
export function bestRow(channels: Channel[], typed: string): Channel | null {
  const q = typed.trim();
  if (!q) return null;
  let best: { c: Channel; score: number } | null = null;
  for (const c of channels) {
    const score = nameScore(rowName(c), q);
    if (score > 0 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

/** The rows in a section that have something unread (the open one is already being read). */
export function unreadRows(list: Channel[], currentId: string | null): Channel[] {
  return list.filter((c) => c.id !== currentId && (c.unreadCount > 0 || c.mentionCount > 0));
}
