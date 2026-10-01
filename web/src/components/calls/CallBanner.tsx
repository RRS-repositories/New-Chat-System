import { Phone, X } from 'lucide-react';
import { useCall } from '../../context/callContext.ts';

/**
 * Under the channel header: "Call in progress — Join" for a live call this tab is not in, plus call
 * errors and notices. A person the host removed sees "Ask to join", then waits for the host's answer.
 */
export function CallBanner({ channelId }: { channelId: string | null }) {
  const { activeByChannel, call, joinCall, cancelAsk, clearMessages } = useCall();
  const live = channelId ? activeByChannel[channelId] : undefined;
  const here = !!live && call.callId === live.callId && call.phase !== 'idle';
  const joining = call.phase === 'joining';
  const waiting = !!live && call.asking?.callId === live.callId;
  const removed = !!live && call.removedFrom.includes(live.callId);
  return (
    <>
      {live && !here && channelId && (
        <div className="call-banner" role="status">
          <Phone size={14} aria-hidden="true" />
          {waiting ? (
            <>
              <span className="call-banner-text" data-testid="call-banner-waiting">
                Waiting for the host to let you back in…
              </span>
              <button className="btn-ghost btn-small" data-testid="call-banner-cancel" onClick={cancelAsk}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="call-banner-text">
                Call in progress{live.participantIds.length ? ` · ${live.participantIds.length} in call` : ''}
              </span>
              <button
                className="btn-accent btn-small"
                data-testid="call-banner-join"
                aria-label={removed ? 'Ask to join the call' : 'Join call'}
                disabled={joining}
                onClick={() => void joinCall(live.callId, channelId)}
              >
                {removed ? 'Ask to join' : 'Join'}
              </button>
            </>
          )}
        </div>
      )}
      {(call.error || call.notice) && (
        <div className={`call-note${call.error ? ' is-error' : ''}`} role={call.error ? 'alert' : 'status'}>
          <span>{call.error || call.notice}</span>
          <button className="icon-btn small" aria-label="Dismiss" onClick={clearMessages}>
            <X size={12} />
          </button>
        </div>
      )}
    </>
  );
}
