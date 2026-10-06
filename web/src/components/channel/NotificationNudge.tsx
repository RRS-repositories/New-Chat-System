import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import { allowDesktop, desktopSupported, enablePush, loadPushKey, pushSupported } from '../../services/push.ts';

type State = 'default' | 'denied' | 'granted' | 'unsupported';
const current = (): State => (desktopSupported() ? Notification.permission : 'unsupported');

/**
 * Notifications are not optional here (the owner's rule, 6 Oct 2026): until this device has them
 * on, a line sits above the messages asking for them, and it cannot be dismissed. The browser alone
 * can grant the permission, and only when the person presses Allow in its prompt, so the line
 * explains and asks; when the browser has them blocked, it says how to unblock.
 */
export function NotificationNudge() {
  const { api } = useChat();
  const toast = useToast();
  const [state, setState] = useState<State>(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Allowed or blocked from the browser's own settings meanwhile: the line follows.
    const refresh = () => setState(current());
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);
  if (state === 'granted' || state === 'unsupported') return null;

  async function turnOn() {
    setBusy(true);
    try {
      // Push (works with the tab closed) when the server has a key; otherwise plain desktop notifications.
      const key = pushSupported() ? await loadPushKey(api) : null;
      const result = key ? await enablePush(api, key) : await allowDesktop();
      if (result === 'on' || result === 'granted') toast({ text: 'Notifications are on for this device' });
    } catch (e: any) {
      toast({ text: e?.message || 'Could not turn notifications on' });
    } finally {
      setBusy(false);
      setState(current());
    }
  }

  if (state === 'denied')
    return (
      <div className="notify-nudge blocked" role="alert" data-testid="notify-nudge-blocked">
        <BellOff size={15} aria-hidden="true" />
        <span>
          <b>Notifications are blocked for this site.</b> Everyone here needs them on: click the lock (or tune) icon at
          the left of the address bar, set Notifications to Allow, then reload.
        </span>
      </div>
    );
  return (
    <div className="notify-nudge" role="alert" data-testid="notify-nudge">
      <Bell size={15} aria-hidden="true" />
      <span>
        <b>Turn on notifications.</b> Everyone here has them on, so messages and calls reach you in another tab or app.
        Press Turn on, then Allow in the browser.
      </span>
      <button
        className="btn-accent btn-small"
        disabled={busy}
        data-testid="notify-nudge-on"
        onClick={() => void turnOn()}
      >
        Turn on
      </button>
    </div>
  );
}
