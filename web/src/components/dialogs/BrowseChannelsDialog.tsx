import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChat } from '../../context/ChatProvider.tsx';
import type { BrowseChannel } from '../../types/index.ts';
export function BrowseChannelsDialog({ onClose, onJoined }: { onClose: () => void; onJoined: (id: string) => void }) {
  const { actions } = useChat();
  const [list, setList] = useState<BrowseChannel[] | null>(null); const [error, setError] = useState<string | null>(null); const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    actions.browseChannels().then((r) => { if (live) setList(r); }).catch((e: any) => { if (live) { setList([]); setError(e?.message || 'Could not load channels'); } });
    return () => { live = false; };
  }, [actions]);
  async function join(id: string) {
    setBusyId(id); setError(null);
    try { const ch = await actions.joinChannel(id); onJoined(ch.id); onClose(); }
    catch (e: any) { setError(e?.message || 'Could not join channel'); } finally { setBusyId(null); }
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Browse channels" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Browse channels</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        {error && <p className="error">{error}</p>}
        <div className="pick-list">
          {list === null && <p className="muted pad">Loading…</p>}
          {list?.length === 0 && !error && <p className="muted pad">No public channels yet</p>}
          {list?.map((c) => (
            <div key={c.id} className="pick-row browse-row">
              <div className="browse-info">
                <div className="browse-name"># {c.displayName}</div>
                {c.purpose && <div className="muted">{c.purpose}</div>}
                <div className="muted">{c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}</div>
              </div>
              {c.joined
                ? <button className="btn-ghost" disabled>Joined</button>
                : <button className="btn-accent" disabled={busyId !== null} onClick={() => void join(c.id)}>Join</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
