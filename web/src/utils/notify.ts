import type { Channel, Message, NotifyLevel, Preferences } from '../types/index.ts';

/** Service worker → page: a notification was clicked; open this channel. */
export const SW_OPEN = 'chat-sw:open';
const SAFE_ID = /^[\w-]{1,64}$/;

type NotifyInput = {
  message: Pick<Message, 'userId' | 'type' | 'mentionsMe'>;
  channel: (Pick<Channel, 'type'> & { notifyPref?: Channel['notifyPref'] }) | undefined;
  prefs: Pick<Preferences, 'desktopNotif'>;
  me: number;
  /** That channel is open AND the chat is being looked at. */
  viewing: boolean;
};

/** Mirrors the server's push recipient rule, plus "not while you are looking at it". */
export function shouldNotify({ message, channel, prefs, me, viewing }: NotifyInput): boolean {
  if (message.userId === me) return false;
  if (message.type === 'system' || message.type === 'join' || message.type === 'leave' || message.type === 'call')
    return false;
  if (viewing) return false;
  const pref = channel?.notifyPref;
  const level: NotifyLevel = pref && pref !== 'default' ? pref : prefs.desktopNotif;
  if (level === 'all') return true;
  if (level === 'mentions') return !!message.mentionsMe || channel?.type === 'dm' || channel?.type === 'group_dm';
  return false;
}

/** Title/body as in the push payload: `#channel` (sender for a DM), `Sender: first 140 chars` or `Sender sent a file`. */
export function notificationContent(
  message: Pick<Message, 'userName' | 'content' | 'type'>,
  channel: Pick<Channel, 'type' | 'displayName'> | undefined,
): { title: string; body: string } {
  const sender = message.userName || 'Someone';
  const title = !channel || channel.type === 'dm' ? sender : `#${channel.displayName}`;
  const body =
    message.type === 'file' ? `${sender} sent a file` : `${sender}: ${String(message.content || '').slice(0, 140)}`;
  return { title, body };
}

export function isLookedAt({ hidden, focused }: { hidden: boolean; focused: boolean }): boolean {
  return !hidden && focused;
}

export function parseSwOpen(data: any): string | null {
  if (!data || data.type !== SW_OPEN || typeof data.channelId !== 'string' || !SAFE_ID.test(data.channelId))
    return null;
  return data.channelId;
}

export const NOTIFICATION_ICON = '/icon-192.png';
/** The page's own event for "open this channel", raised when a notification shown by the page itself is clicked. */
export const OPEN_CHANNEL_EVENT = 'chat:open-channel';

/**
 * A desktop notification: through the service worker when there is one (clicks are then handled in
 * sw.js, and it works with the tab closed), otherwise straight from the page, so a person who has
 * allowed notifications is told even before push is set up on their device. Silent on any failure.
 */
export async function showDesktopNotification(title: string, body: string, channelId: string): Promise<void> {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // renotify: a second message in the same channel (same tag) alerts again. Not in TS's DOM types.
    const options = {
      body,
      tag: channelId,
      data: { channelId },
      renotify: true,
      icon: NOTIFICATION_ICON,
    } as NotificationOptions;
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
    const shown = new Notification(title, options);
    shown.onclick = () => {
      window.focus();
      window.dispatchEvent(new CustomEvent(OPEN_CHANNEL_EVENT, { detail: channelId }));
      shown.close();
    };
  } catch {
    /* notifications are best effort */
  }
}

// ---- Incoming calls: a notification with Accept and Decline, kept until answered ----------------

export const CALL_ACTION_EVENT = 'chat:call-action';
export const SW_CALL = 'chat-sw:call';
export type CallAction = 'accept' | 'decline' | 'open';

/** The tag a call's notification carries, so it can be closed when the ring ends. */
export const callTag = (callId: string) => `call-${callId}`;

/** What the notification for an incoming call says and offers. Pure. */
export function callNotificationOptions(inc: {
  callId: string;
  channelId: string;
  channelName: string;
  channelType: string;
  fromName: string;
}): { title: string; options: Record<string, unknown> } {
  const where = inc.channelType === 'dm' ? ' you' : ` in #${inc.channelName}`;
  return {
    title: 'Incoming call',
    options: {
      body: `${inc.fromName} is calling${where}`,
      tag: callTag(inc.callId),
      renotify: true,
      requireInteraction: true,
      icon: NOTIFICATION_ICON,
      vibrate: [300, 150, 300, 150, 300],
      data: { kind: 'call', callId: inc.callId, channelId: inc.channelId },
      actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'decline', title: 'Decline' },
      ],
    },
  };
}

/** The service worker's message for a call notification that was clicked: which call, which button. */
export function parseSwCall(data: any): { callId: string; channelId: string | null; action: CallAction } | null {
  if (!data || typeof data !== 'object' || data.type !== SW_CALL) return null;
  if (typeof data.callId !== 'string' || !data.callId) return null;
  const action: CallAction = data.action === 'accept' || data.action === 'decline' ? data.action : 'open';
  return {
    callId: data.callId,
    channelId: typeof data.channelId === 'string' && data.channelId ? data.channelId : null,
    action,
  };
}

/** The call to act on when the chat was opened from a notification: `?call=<id>&do=accept|decline`. */
export function callFromAddress(search: string): { callId: string; action: CallAction } | null {
  try {
    const q = new URLSearchParams(search);
    const callId = q.get('call');
    if (!callId) return null;
    const d = q.get('do');
    return { callId, action: d === 'accept' || d === 'decline' ? d : 'open' };
  } catch {
    return null;
  }
}

/**
 * Shows the incoming-call notification: through the service worker (with Accept and Decline
 * buttons, works from another app), else from the page (click = come to the chat). Stays until
 * answered or closed. Silent on any failure.
 */
export async function showCallNotification(inc: Parameters<typeof callNotificationOptions>[0]): Promise<void> {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const { title, options } = callNotificationOptions(inc);
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, options as NotificationOptions);
      return;
    }
    const { actions: _actions, ...plain } = options;
    const shown = new Notification(title, plain as NotificationOptions);
    shown.onclick = () => {
      window.focus();
      window.dispatchEvent(
        new CustomEvent(CALL_ACTION_EVENT, {
          detail: { callId: inc.callId, channelId: inc.channelId, action: 'open' },
        }),
      );
      shown.close();
    };
  } catch {
    /* best effort */
  }
}

/** Closes the notification for a call (it was answered, declined or stopped ringing). */
export async function closeCallNotification(callId: string): Promise<void> {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (!reg) return;
    for (const n of await reg.getNotifications({ tag: callTag(callId) })) n.close();
  } catch {
    /* best effort */
  }
}
