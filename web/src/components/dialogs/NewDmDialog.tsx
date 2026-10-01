import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChat } from '../../context/ChatProvider.tsx';
import type { ChatUser } from '../../types/index.ts';
export function NewDmDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (channelId: string) => void }) {
  const { api, actions } = useChat();
  const [users, setUsers] = useState<ChatUser[]>([]); const [q, setQ] = useState(''); const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<{ users: ChatUser[] }>('/api/chat/users').then((r) => setUsers(r.users)).catch(() => setUsers([])); }, [api]);
  const shown = users.filter((u) => u.fullName.toLowerCase().includes(q.toLowerCase()));
  const [busy, setBusy] = useState(false);
  // A refused DM (403 restricted: "You cannot message this person") is shown
  // inline below the list, like any other failure.
  async function pick(u: ChatUser) {
    if (busy) return; setBusy(true); setError(null);
    try { const ch = await actions.openDm(u.id); onOpened(ch.id); onClose(); }
    catch (e: any) { setError(e?.message || 'Could not open conversation'); } finally { setBusy(false); }
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="New message" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>New message</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        <label className="field"><span>To</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" autoFocus /></label>
        <div className="pick-list">{shown.map((u) => <button key={u.id} className="pick-row" disabled={busy} onClick={() => void pick(u)}>{u.fullName}<span className="muted"> · {u.role}</span></button>)}{!shown.length && <p className="muted">No one found</p>}</div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
