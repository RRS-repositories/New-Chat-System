import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../config/routes.ts';
import { rememberLastChannel } from '../utils/lastChannel.ts';
import { CALL_ACTION_EVENT, OPEN_CHANNEL_EVENT, parseSwCall, parseSwOpen } from '../utils/notify.ts';

/** A clicked notification (the service worker's `chat-sw:open` message, or the page's own event) opens its channel in this tab. */
export function useNotificationOpen(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const open = (channelId: string) => {
      rememberLastChannel(channelId);
      navigate(paths.channel(channelId));
    };
    const onOwn = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === 'string' && id) open(id);
    };
    window.addEventListener(OPEN_CHANNEL_EVENT, onOwn);
    const worker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    if (!worker) return () => window.removeEventListener(OPEN_CHANNEL_EVENT, onOwn);
    const onMessage = (event: MessageEvent) => {
      const call = parseSwCall(event.data);
      if (call) {
        // Accept or Decline on the notification: the call layer acts; "open" just comes to the channel.
        if (call.channelId) open(call.channelId);
        window.dispatchEvent(new CustomEvent(CALL_ACTION_EVENT, { detail: call }));
        return;
      }
      const channelId = parseSwOpen(event.data);
      if (channelId) open(channelId);
    };
    worker.addEventListener('message', onMessage);
    try {
      worker.startMessages();
    } catch {
      /* older browsers */
    }
    return () => {
      worker.removeEventListener('message', onMessage);
      window.removeEventListener(OPEN_CHANNEL_EVENT, onOwn);
    };
  }, [navigate]);
}
