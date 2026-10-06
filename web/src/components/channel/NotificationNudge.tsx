import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import { allowDesktop, desktopSupported, enablePush, loadPushKey, pushSupported } from '../../services/push.ts';

const KEY = 'chatNotifyNudge';
const QUIET_DAYS = 7;

/** "Not now" keeps the line away for a week; it comes back after that until notifications are on or refused. */
function quiet(): boolean {
  try {
    const until = Number(localStorage.getItem(KEY) || 0);
    return until > Date.now();
  } catch {
    return false;
  }
}

/**
 * A slim line above the messages for people who have not switched notifications on yet: without the
 * browser's permission nothing can reach them in another tab or app, and most people never find the
 * switch in Settings. Gone once notifications are on (or refused) or for a week after "Not now".
 */
export function NotificationNudge() {
  const { api } = useChat();
  const toast = useToast();
  const [show, setShow] = useState(() => desktopSupported() && Notification.permission === 'default' && !quiet());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Permission granted or refused from Settings meanwhile: the line goes.
    const onFocus = () => {
      if (desktopSupported() && Notification.permission !== 'default') setShow(false);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  if (!show) return null;

  async function turnOn() {
    setBusy(true);
    try {
      // Push (works with the tab closed) when the server has a key; otherwise plain desktop notifications.
      const key = pushSupported() ? await loadPushKey(api) : null;
      const state = key ? await enablePush(api, key) : await allowDesktop();
      if (state === 'on' || state === 'granted') toast({ text: 'Notifications are on for this device' });
      else if (state === 'denied') toast({ text: 'Notifications are blocked for this site in your browser settings' });
    } catch (e: any) {
      toast({ text: e?.message || 'Could not turn notifications on' });
    } finally {
      setBusy(false);
      setShow(false);
    }
  }
  function notNow() {
    try {
      localStorage.setItem(KEY, String(Date.now() + QUIET_DAYS * 86_400_000));
    } catch {
      /* the line still goes for this visit */
    }
    setShow(false);
  }
  return (
    <div className="notify-nudge" role="status" data-testid="notify-nudge">
      <Bell size={15} aria-hidden="true" />
      <span>Turn on notifications to hear about messages and calls while you are in another tab or app.</span>
      <button
        className="btn-accent btn-small"
        disabled={busy}
        data-testid="notify-nudge-on"
        onClick={() => void turnOn()}
      >
        Turn on
      </button>
      <button className="p-x" aria-label="Not now" data-testid="notify-nudge-later" onClick={notNow}>
        <X size={14} />
      </button>
    </div>
  );
}
