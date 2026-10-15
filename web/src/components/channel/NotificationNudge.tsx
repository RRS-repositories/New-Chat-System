import { useEffect, useState } from 'react';
import { Bell, BellOff, Mic, MicOff } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import { allowDesktop, desktopSupported, enablePush, loadPushKey, pushSupported } from '../../services/push.ts';
import { isEmbedded } from '../../utils/embed.ts';

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
          {isEmbedded() ? (
            <>
              <b>Notifications cannot be switched on from inside the CRM.</b> Open{' '}
              <a href={window.location.origin} target="_blank" rel="noopener noreferrer">
                {window.location.host}
              </a>{' '}
              in its own tab once, press Allow when it asks, then come back here: the browser remembers it.
            </>
          ) : (
            <>
              <b>Notifications are blocked for this site.</b> Everyone here needs them on: click the lock (or tune) icon
              at the left of the address bar, set Notifications to Allow, then reload.
            </>
          )}
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

type MicState = 'prompt' | 'denied' | 'granted' | 'unknown';

/** What the browser says about the microphone for this site, where it can be asked (Chrome and Edge). */
async function micState(): Promise<MicState> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return 'unknown';
    const q = (navigator as any).permissions?.query;
    if (typeof q !== 'function') return 'unknown';
    const st = await (navigator as any).permissions.query({ name: 'microphone' });
    return st.state === 'granted' ? 'granted' : st.state === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unknown';
  }
}

/**
 * Calls need the microphone, and the browser asks for it the first time a call is answered — which
 * is the worst moment to miss a prompt. So, like notifications, it is asked for once up front (the
 * owner, 15 Oct 2026). The line goes as soon as the browser has it.
 */
export function MicNudge() {
  const toast = useToast();
  const [state, setState] = useState<MicState>('unknown');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => void micState().then((s) => live && setState(s));
    refresh();
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);
  if (state === 'granted' || state === 'unknown') return null;

  async function allow() {
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const t of stream.getTracks()) t.stop();
      toast({ text: 'Microphone allowed: calls will connect straight away' });
      setState('granted');
    } catch {
      setState(await micState());
    } finally {
      setBusy(false);
    }
  }

  if (state === 'denied')
    return (
      <div className="notify-nudge blocked" role="alert" data-testid="mic-nudge-blocked">
        <MicOff size={15} aria-hidden="true" />
        <span>
          <b>The microphone is blocked for this site</b>, so calls cannot be answered. Click the lock (or tune) icon at
          the left of the address bar, set Microphone to Allow, then reload.
        </span>
      </div>
    );
  return (
    <div className="notify-nudge" role="alert" data-testid="mic-nudge">
      <Mic size={15} aria-hidden="true" />
      <span>
        <b>Allow your microphone once</b>, so a call connects the moment you accept it. Press Allow, then Allow in the
        browser.
      </span>
      <button className="btn-accent btn-small" disabled={busy} data-testid="mic-nudge-on" onClick={() => void allow()}>
        Allow
      </button>
    </div>
  );
}
