import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { ChatUser } from '../../types/index.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';

type Props = { channelId: string; channelName: string; onClose: () => void };

/** Adds people to a channel: pick from everyone who is not in it yet. */
export function AddMembersDialog({ channelId, channelName, onClose }: Props) {
  const { state, actions } = useChat();
  const [users, setUsers] = useState<ChatUser[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const members = state.membersByChannel[channelId] || [];

  useEffect(() => {
    actions
      .listUsers()
      .then(setUsers)
      .catch((e: any) => {
        setUsers([]);
        setError(e?.message || 'Could not load people');
      });
  }, [actions]);

  const outside = useMemo(() => {
    const inIt = new Set(members.map((m) => m.id));
    const words = query.trim().toLowerCase();
    return (users || []).filter((u) => !inIt.has(u.id) && (!words || u.fullName.toLowerCase().includes(words)));
  }, [users, members, query]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await actions.addMembers(channelId, picked);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not add them');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Add people" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add people to #{channelName}</h2>
          <button className="p-x" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <label className="field">
          <span>Find</span>
          <input
            value={query}
            placeholder="Type a name"
            autoFocus
            data-testid="add-members-filter"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="field">
          <span>People not in the channel</span>
          <div className="pick-list" data-testid="add-members-list">
            {users === null && <p className="muted pad">Loading…</p>}
            {users !== null && !outside.length && (
              <p className="muted pad">{query ? 'Nobody by that name' : 'Everyone is already in this channel'}</p>
            )}
            {outside.map((u) => (
              <label key={u.id} className="pick-row pick-check">
                <input
                  type="checkbox"
                  data-testid="add-members-person"
                  data-user-id={u.id}
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
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-acts">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <span className="push-right" />
          <button
            className="btn-accent"
            data-testid="add-members-save"
            disabled={busy || !picked.length}
            onClick={() => void add()}
          >
            {picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
