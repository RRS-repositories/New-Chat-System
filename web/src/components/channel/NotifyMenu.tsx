import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Check } from 'lucide-react';
import type { ChannelNotifyPref } from '../../types/index.ts';

const OPTIONS: Array<[ChannelNotifyPref, string]> = [['default', 'Default'], ['all', 'All messages'], ['mentions', 'Mentions only'], ['nothing', 'Nothing']];

/** Per-channel notification level ("Notifications: Default / All messages / Mentions only / Nothing"). */
export function NotifyMenu({ value, onChange }: { value: ChannelNotifyPref; onChange: (pref: ChannelNotifyPref) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  async function pick(pref: ChannelNotifyPref) {
    setError(null); if (pref === value) { setOpen(false); return; }
    try { await onChange(pref); setOpen(false); } catch (e: any) { setError(e?.message || 'Could not change notifications'); }
  }
  const muted = value === 'nothing';
  return (
    <span className="menu-wrap" ref={box}>
      <button ref={trigger} className="icon-btn" aria-label="Notifications" aria-haspopup="menu" aria-expanded={open} title={muted ? 'Notifications: muted' : 'Notifications'} onClick={() => { setError(null); setOpen(!open); }}>
        {muted ? <BellOff size={16} /> : <Bell size={16} />}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Notifications">
          <div className="menu-title muted">Notifications</div>
          {OPTIONS.map(([pref, label]) => (
            <button key={pref} role="menuitemradio" aria-checked={pref === value} className="menu-item" onClick={() => void pick(pref)}>
              <span className="menu-check">{pref === value && <Check size={14} />}</span>{label}
            </button>
          ))}
          {error && <p className="error menu-error" role="alert">{error}</p>}
        </div>
      )}
    </span>
  );
}
