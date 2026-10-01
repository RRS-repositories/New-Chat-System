import { Phone, PhoneOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../../config/routes.ts';
import { useCall } from '../../context/callContext.ts';

/** "<Name> is calling" with Accept / Decline. The ringtone and desktop notification are run by CallProvider. */
export function IncomingCallModal() {
  const { call, joinCall, declineCall } = useCall();
  const nav = useNavigate();
  const inc = call.phase === 'ringing-in' ? call.incoming : null;
  if (!inc) return null;
  const where = inc.channelType === 'dm' ? 'Direct call' : `#${inc.channelName}`;
  const accept = () => {
    nav(paths.channel(inc.channelId));
    void joinCall(inc.callId, inc.channelId);
  };
  return (
    <div className="modal-scrim call-scrim">
      <div
        className="modal incoming-call"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="incoming-title"
        aria-describedby="incoming-where"
        data-testid="incoming-call"
      >
        <div className="incoming-icon" aria-hidden="true">
          <Phone size={20} />
        </div>
        <h2 id="incoming-title" className="incoming-title">
          {inc.fromName} is calling
        </h2>
        <p id="incoming-where" className="muted center">
          {where}
        </p>
        <div className="row gap incoming-actions">
          <button
            className="btn-ghost call-decline"
            data-testid="incoming-decline"
            aria-label="Decline call"
            onClick={() => declineCall(inc.callId)}
          >
            <PhoneOff size={14} /> Decline
          </button>
          <button
            className="btn-accent call-accept"
            data-testid="incoming-accept"
            aria-label="Accept call"
            autoFocus
            onClick={accept}
          >
            <Phone size={14} /> Accept
          </button>
        </div>
      </div>
    </div>
  );
}
