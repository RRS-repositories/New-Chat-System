import type { Channel, Message, NotifyLevel, Preferences } from '../types/index.ts';

/** Service worker → page: a notification was clicked; open this channel. */
export const SW_OPEN = 'chat-sw:open';
const SAFE_ID = /^[\w-]{1,64}$/;

type NotifyInput = {
  message: Pick<Message, 'userId' | 'type' | 'mentionsMe'>;
  channel: Pick<Channel, 'type'> & { notifyPref?: Channel['notifyPref'] } | undefined;
  prefs: Pick<Preferences, 'desktopNotif'>;
  me: number;
  /** That channel is open AND the chat is being looked at. */
  viewing: boolean;
};

/** Mirrors the server's push recipient rule, plus "not while you are looking at it". */
export function shouldNotify({ message, channel, prefs, me, viewing }: NotifyInput): boolean {
  if (message.userId === me) return false;
  if (message.type === 'system' || message.type === 'join' || message.type === 'leave' || message.type === 'call') return false;
  if (viewing) return false;
  const pref = channel?.notifyPref;
  const level: NotifyLevel = pref && pref !== 'default' ? pref : prefs.desktopNotif;
  if (level === 'all') return true;
  if (level === 'mentions') return !!message.mentionsMe || channel?.type === 'dm' || channel?.type === 'group_dm';
  return false;
}

/** Title/body as in the push payload: `#channel` (sender for a DM), `Sender: first 140 chars` or `Sender sent a file`. */
export function notificationContent(message: Pick<Message, 'userName' | 'content' | 'type'>, channel: Pick<Channel, 'type' | 'displayName'> | undefined): { title: string; body: string } {
  const sender = message.userName || 'Someone';
  const title = !channel || channel.type === 'dm' ? sender : `#${channel.displayName}`;
  const body = message.type === 'file' ? `${sender} sent a file` : `${sender}: ${String(message.content || '').slice(0, 140)}`;
  return { title, body };
}

export function isLookedAt({ hidden, focused }: { hidden: boolean; focused: boolean }): boolean {
  return !hidden && focused;
}

export function parseSwOpen(data: any): string | null {
  if (!data || data.type !== SW_OPEN || typeof data.channelId !== 'string' || !SAFE_ID.test(data.channelId)) return null;
  return data.channelId;
}

/** A desktop notification through the service worker registration, so clicks are handled in one place (sw.js). Silent on any failure. */
export async function showDesktopNotification(title: string, body: string, channelId: string): Promise<void> {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    // renotify: a second message in the same channel (same tag) alerts again. Not in TS's DOM types.
    await reg?.showNotification(title, { body, tag: channelId, data: { channelId }, renotify: true } as NotificationOptions);
  } catch { /* notifications are best effort */ }
}
