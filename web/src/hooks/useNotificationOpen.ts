import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../config/routes.ts';
import { rememberLastChannel } from '../utils/lastChannel.ts';
import { parseSwOpen } from '../utils/notify.ts';

/** A clicked notification (the service worker's `chat-sw:open` message) opens its channel in this tab. */
export function useNotificationOpen(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const worker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const channelId = parseSwOpen(event.data);
      if (!channelId) return;
      rememberLastChannel(channelId);
      navigate(paths.channel(channelId));
    };
    worker.addEventListener('message', onMessage);
    try {
      worker.startMessages();
    } catch {
      /* older browsers */
    }
    return () => worker.removeEventListener('message', onMessage);
  }, [navigate]);
}
