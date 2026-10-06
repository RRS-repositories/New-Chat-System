import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { ChatUser } from '../../types/index.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
export function NewChannelDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { actions } = useChat();
  const [name, setName] = useState('');
  const [type, setType] = useState<'public' | 'private'>('public');
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    actions
      .listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [actions]);
  // A refused private channel (403 restricted: "Some of these people cannot
  // share a private channel") is shown inline in the error line below.
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const ch = await actions.createChannel({ displayName: name, type, memberIds: picked });
      onCreated(ch.id);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not create channel');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="New channel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Create a channel</h2>
          <button className="p-x" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. claims-team" autoFocus />
        </label>
        <label className="togrow check-row">
          <span className="tx">
            <b>Private channel</b>
            <span>Only invited people can see it</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={type === 'private'}
            onChange={(e) => setType(e.target.checked ? 'private' : 'public')}
          />
        </label>
        <div className="field">
          <span>Members{picked.length ? ` · ${picked.length} chosen` : ''}</span>
          <input
            value={query}
            placeholder="Search people"
            aria-label="Search people"
            data-testid="new-channel-filter"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="pick-list">
            {users
              .filter((u) => !query.trim() || u.fullName.toLowerCase().includes(query.trim().toLowerCase()))
              .map((u) => (
                <label key={u.id} className="pick-row pick-check">
                  <input
                    type="checkbox"
                    checked={picked.includes(u.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))}
                  />
                  <UserAvatar userId={u.id} name={u.fullName} size="md" />
                  <span className="pi">
                    <b>{u.fullName}</b>
                    <span>{u.role}</span>
                  </span>
                </label>
              ))}
            {!!query.trim() && !users.some((u) => u.fullName.toLowerCase().includes(query.trim().toLowerCase())) && (
              <p className="muted pad">No one found</p>
            )}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-acts">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-accent" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create channel
          </button>
        </div>
      </div>
    </div>
  );
}
