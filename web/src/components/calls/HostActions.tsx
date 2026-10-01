import { useEffect, useState } from 'react';
import { MicOff, UserX } from 'lucide-react';

const CONFIRM_SHOWN_MS = 5000;

type Props = {
  name: string;
  /** Already muted: there is nothing for the host to do (the host cannot unmute anyone). */
  muted: boolean;
  /** Not offered in a one-to-one call, where leaving does the same. */
  canRemove: boolean;
  onMute: () => void;
  onRemove: () => void;
};

/** What the host can do to one person in the call: mute them, or remove them (asked twice). */
export function HostActions({ name, muted, canRemove, onMute, onRemove }: Props) {
  const [confirming, setConfirming] = useState(false);

  // An unanswered "Remove?" goes back to the plain buttons on its own.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (confirming) {
    return (
      <span className="call-host-actions">
        <span className="muted">Remove?</span>
        <button
          className="btn-ghost btn-small danger"
          data-testid="call-host-remove-yes"
          aria-label={`Yes, remove ${name} from the call`}
          onClick={() => {
            setConfirming(false);
            onRemove();
          }}
        >
          Yes
        </button>
        <button
          className="btn-ghost btn-small"
          aria-label="No, keep them in the call"
          onClick={() => setConfirming(false)}
        >
          No
        </button>
      </span>
    );
  }
  return (
    <span className="call-host-actions">
      <button
        className="icon-btn small"
        data-testid="call-host-mute"
        aria-label={`Mute ${name}`}
        title={muted ? 'Already muted' : 'Mute this person'}
        disabled={muted}
        onClick={onMute}
      >
        <MicOff size={13} />
      </button>
      {canRemove && (
        <button
          className="icon-btn small"
          data-testid="call-host-remove"
          aria-label={`Remove ${name} from the call`}
          title="Remove from the call"
          onClick={() => setConfirming(true)}
        >
          <UserX size={13} />
        </button>
      )}
    </span>
  );
}
