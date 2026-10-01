import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { ChatUser } from '../../types/index.ts';
export function NewChannelDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { actions } = useChat();
  const [name, setName] = useState('');
  const [type, setType] = useState<'public' | 'private'>('public');
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
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
          <h2>New channel</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as 'public' | 'private')}>
            <option value="public">Public — anyone can join</option>
            <option value="private">Private — invite only</option>
          </select>
        </label>
        <div className="field">
          <span>Members</span>
          <div className="pick-list">
            {users.map((u) => (
              <label key={u.id} className="pick-row">
                <input
                  type="checkbox"
                  checked={picked.includes(u.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))}
                />
                {u.fullName}
              </label>
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row gap end">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-accent" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
