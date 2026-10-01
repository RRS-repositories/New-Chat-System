import { useState } from 'react';
import { Archive, LogOut, Pencil } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { Channel } from '../../types/index.ts';

const NAME_MAX = 80;
const PURPOSE_MAX = 250;

type Props = {
  channel: Channel;
  /** Channel owner or admin, or Management: may rename and archive. */
  canManage: boolean;
  /** The channel is no longer in this person's list (they left it, or it was archived). */
  onGone: () => void;
};

/**
 * Housekeeping for one channel: rename it, leave it, archive it.
 * Nothing here applies to a direct message, and General can be renamed but never left or archived.
 */
export function ChannelOptions({ channel, canManage, onGone }: Props) {
  const { actions } = useChat();
  const [name, setName] = useState(channel.displayName);
  const [purpose, setPurpose] = useState(channel.purpose);
  const [asking, setAsking] = useState<'leave' | 'archive' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isGeneral = channel.name === 'general' && channel.type === 'public';
  const changed = name.trim() !== channel.displayName || purpose.trim() !== channel.purpose;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await work();
    } catch (e: any) {
      setError(e?.message || 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    run(async () => {
      await actions.renameChannel(channel.id, { displayName: name.trim(), purpose: purpose.trim() });
      setSaved(true);
    });
  const confirmed = () =>
    run(async () => {
      if (asking === 'leave') await actions.leaveChannel(channel.id);
      else await actions.archiveChannel(channel.id);
      onGone();
    });

  return (
    <div className="chan-options">
      {canManage && (
        <form
          className="chan-options-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (changed && name.trim()) void save();
          }}
        >
          <label className="field">
            <span>Channel name</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              data-testid="channel-name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>What it is for (optional)</span>
            <textarea
              value={purpose}
              maxLength={PURPOSE_MAX}
              rows={2}
              data-testid="channel-purpose"
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
          <div className="row gap">
            <button
              className="btn-accent btn-small"
              type="submit"
              data-testid="channel-save"
              disabled={busy || !changed || !name.trim()}
            >
              <Pencil size={13} /> Save
            </button>
            {saved && !changed && <span className="muted">Saved</span>}
          </div>
        </form>
      )}
      {!canManage && channel.purpose && <p className="muted chan-purpose">{channel.purpose}</p>}

      {asking ? (
        <div className="chan-confirm" role="alertdialog" aria-label="Please confirm">
          <p>
            {asking === 'leave'
              ? `Leave ${channel.displayName}? You will stop getting its messages.`
              : `Archive ${channel.displayName} for everyone? It disappears from everybody's list. Its messages are kept, but nobody can read or post in it.`}
          </p>
          <div className="row gap">
            <button
              className="btn-ghost btn-small danger"
              data-testid="channel-confirm"
              disabled={busy}
              onClick={() => void confirmed()}
            >
              {asking === 'leave' ? 'Yes, leave' : 'Yes, archive'}
            </button>
            <button className="btn-ghost btn-small" disabled={busy} onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        !isGeneral && (
          <div className="row gap chan-options-actions">
            <button className="btn-ghost btn-small" data-testid="channel-leave" onClick={() => setAsking('leave')}>
              <LogOut size={13} /> Leave channel
            </button>
            {canManage && (
              <button
                className="btn-ghost btn-small danger"
                data-testid="channel-archive"
                onClick={() => setAsking('archive')}
              >
                <Archive size={13} /> Archive channel
              </button>
            )}
          </div>
        )
      )}
      {isGeneral && <p className="muted">Everyone stays in General, so it cannot be left or archived.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
