import { useState } from 'react';
import { Phone } from 'lucide-react';
import { useCall } from '../../context/callContext.ts';
import type { Message } from '../../types/index.ts';
import { formatTime } from '../../utils/format.ts';

/**
 * "Join my call": the message posted into a direct conversation when someone rings a person into
 * their call. It still works after the ring was missed, for as long as the call is going on.
 */
export function CallInviteCard({ m, own }: { m: Message; own: boolean }) {
  const { call, busy, joinCall, acceptCall, isCallLive } = useCall();
  const [over, setOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const callId = m.metadata?.call_id || '';
  const channelId = m.metadata?.channel_id || '';
  const inIt = busy && call.callId === callId;

  async function join() {
    setChecking(true);
    const live = await isCallLive(callId);
    setChecking(false);
    if (!live) return setOver(true);
    if (!busy) return void joinCall(callId, channelId);
    // Already in another call: this one is answered like a ring, which changes calls.
    void acceptCall({
      callId,
      channelId,
      channelName: '',
      channelType: 'private',
      fromId: m.userId,
      fromName: m.userName,
      invited: true,
    });
  }

  return (
    <div id={`msg-${m.id}`} className="msg sysm msg-call" data-testid="call-invite-card">
      <div className="gav" />
      <div className="bd">
        <Phone size={14} aria-hidden="true" />
        <span>{own ? 'You asked them to join your call' : `${m.userName} asked you to join their call`}</span>
        <span>· {formatTime(m.createdAt)}</span>
        {!own &&
          (over ? (
            <span className="call-card-over" data-testid="call-invite-over">
              Call has ended
            </span>
          ) : inIt ? (
            <span className="call-card-over">You are in this call</span>
          ) : (
            <button className="call-card-join" data-testid="call-invite-join" disabled={checking} onClick={join}>
              {busy ? 'Switch to this call' : 'Join call'}
            </button>
          ))}
      </div>
    </div>
  );
}
