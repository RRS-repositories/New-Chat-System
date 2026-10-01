import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChat } from '../../context/ChatProvider.tsx';
import type { NotifyLevel } from '../../types/index.ts';
import { allowDesktop, currentPushState, desktopSupported, disablePush, enablePush, loadPushKey, pushSupported, type PushState } from '../../services/push.ts';

/** Own notification preferences, status and this device's push subscription. Every change applies at once. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { state, api, actions } = useChat(); const prefs = state.prefs;
  const [error, setError] = useState<string | null>(null);
  const [statusEmoji, setStatusEmoji] = useState(prefs.statusEmoji); const [statusText, setStatusText] = useState(prefs.statusText);
  const [statusMsg, setStatusMsg] = useState<string | null>(null); const [savingStatus, setSavingStatus] = useState(false);
  // Push: hidden entirely unless the browser supports it AND the server has a key.
  const [pushKey, setPushKey] = useState<string | null>(null); const [push, setPush] = useState<PushState>('unavailable'); const [pushBusy, setPushBusy] = useState(false);
  // Without a push key (or Push support) desktop notifications can still work while the chat is open.
  const [keyChecked, setKeyChecked] = useState(false);
  const [desktopPerm, setDesktopPerm] = useState<NotificationPermission | null>(() => (desktopSupported() ? Notification.permission : null));
  useEffect(() => {
    let live = true;
    if (pushSupported()) void Promise.all([loadPushKey(api), currentPushState()]).then(([k, st]) => { if (live) { setPushKey(k); setPush(st); setKeyChecked(true); } });
    else setKeyChecked(true);
    return () => { live = false; };
  }, [api]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => { setStatusEmoji(prefs.statusEmoji); setStatusText(prefs.statusText); }, [prefs.statusEmoji, prefs.statusText]);

  const change = (patch: Parameters<typeof actions.updatePrefs>[0]) => { setError(null); actions.updatePrefs(patch).catch((e: any) => setError(e?.message || 'Could not save your settings')); };
  async function saveStatus() {
    setSavingStatus(true); setStatusMsg(null);
    try { await actions.setStatus(statusText.trim(), statusEmoji.trim()); setStatusMsg('Saved'); }
    catch (e: any) { setStatusMsg(e?.message || 'Could not save your status'); } finally { setSavingStatus(false); }
  }
  // enablePush asks for permission first, still inside this click.
  function turnOn() {
    if (!pushKey) return; setPushBusy(true); setError(null);
    enablePush(api, pushKey).then(setPush).catch((e: any) => setError(e?.message || 'Could not turn on notifications')).finally(() => setPushBusy(false));
  }
  // Permission is requested first thing, still inside this click.
  function allowDesktopClick() {
    setPushBusy(true); setError(null);
    allowDesktop().then(setDesktopPerm).catch(() => setError('Could not turn on desktop notifications')).finally(() => setPushBusy(false));
  }
  function turnOff() {
    setPushBusy(true); setError(null);
    disablePush(api).then(() => setPush('off')).catch((e: any) => setError(e?.message || 'Could not turn off notifications')).finally(() => setPushBusy(false));
  }
  const showPush = push !== 'unavailable' && !!pushKey;
  const showDesktopOnly = !showPush && keyChecked && desktopPerm !== null;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Settings</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        <label className="field"><span>Notify me about</span>
          <select value={prefs.desktopNotif} onChange={(e) => change({ desktopNotif: e.target.value as NotifyLevel })}>
            <option value="all">All messages</option><option value="mentions">Mentions and direct messages</option><option value="nothing">Nothing</option>
          </select>
        </label>
        <label className="check-row"><input type="checkbox" checked={prefs.soundEnabled} onChange={(e) => change({ soundEnabled: e.target.checked })} />Play a sound</label>
        <label className="check-row"><input type="checkbox" checked={prefs.sendOnEnter} onChange={(e) => change({ sendOnEnter: e.target.checked })} />Enter sends a message (otherwise Ctrl+Enter)</label>
        {showPush && (
          <div className="field"><span>This device</span>
            {push === 'on' && <div className="row gap"><span className="settings-note">Notifications are on for this device</span><button className="btn-ghost" disabled={pushBusy} onClick={turnOff}>Turn off on this device</button></div>}
            {push === 'off' && <div><button className="btn-accent" disabled={pushBusy} onClick={turnOn}>Enable notifications on this device</button></div>}
            {push === 'denied' && <span className="settings-note">Notifications are blocked for this site in your browser settings.</span>}
          </div>
        )}
        {showDesktopOnly && (
          <div className="field"><span>Desktop notifications</span>
            {desktopPerm === 'default' && <div><button className="btn-accent" disabled={pushBusy} onClick={allowDesktopClick}>Allow desktop notifications</button></div>}
            {desktopPerm === 'granted' && <span className="settings-note">Desktop notifications are on for this browser</span>}
            {desktopPerm === 'denied' && <span className="settings-note">Notifications are blocked for this site in your browser settings.</span>}
          </div>
        )}
        <div className="field"><span>Status</span>
          <div className="row gap">
            <input className="status-emoji" aria-label="Status emoji" placeholder="🙂" maxLength={16} value={statusEmoji} onChange={(e) => setStatusEmoji(e.target.value)} />
            <input className="status-text" aria-label="Status text" placeholder="What are you up to?" maxLength={100} value={statusText} onChange={(e) => setStatusText(e.target.value)} />
            <button className="btn-ghost" disabled={savingStatus || (statusText.trim() === prefs.statusText && statusEmoji.trim() === prefs.statusEmoji)} onClick={() => void saveStatus()}>Save</button>
          </div>
          {statusMsg && <span className={statusMsg === 'Saved' ? 'muted' : 'error'}>{statusMsg}</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
