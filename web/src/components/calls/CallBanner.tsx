import { Phone, X } from 'lucide-react';
import { useCall } from '../../context/CallProvider.tsx';

/** Under the channel header: "Call in progress — Join" for a live call this tab is not in, plus call errors/notices. */
export function CallBanner({ channelId }: { channelId: string | null }) {
  const { activeByChannel, call, joinCall, clearMessages } = useCall();
  const live = channelId ? activeByChannel[channelId] : undefined;
  const here = !!live && call.callId === live.callId && call.phase !== 'idle';
  const joining = call.phase === 'joining';
  return (
    <>
      {live && !here && channelId && (
        <div className="call-banner" role="status">
          <Phone size={14} aria-hidden="true" />
          <span className="call-banner-text">Call in progress{live.participantIds.length ? ` · ${live.participantIds.length} in call` : ''}</span>
          <button className="btn-accent btn-small" data-testid="call-banner-join" aria-label="Join call" disabled={joining} onClick={() => void joinCall(live.callId, channelId)}>Join</button>
        </div>
      )}
      {(call.error || call.notice) && (
        <div className={`call-note${call.error ? ' is-error' : ''}`} role={call.error ? 'alert' : 'status'}>
          <span>{call.error || call.notice}</span>
          <button className="icon-btn small" aria-label="Dismiss" onClick={clearMessages}><X size={12} /></button>
        </div>
      )}
    </>
  );
}
