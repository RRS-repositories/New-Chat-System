import { useState } from 'react';
import { ChevronDown, ChevronUp, Mic, MicOff, MonitorUp, MonitorOff, Phone, PhoneOff } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import { useCall } from '../../context/callContext.ts';
import { RemoteAudio } from './RemoteAudio.tsx';
import { RemoteScreen } from './RemoteScreen.tsx';

const canShare = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

/** Docked call panel (right side on desktop, full screen under 720 px, collapsible there). Escape does not leave. */
export function CallPanel() {
  const { state, user } = useChat();
  const { call, snapshot, shareError, busy, toggleMute, toggleShare, leaveCall } = useCall();
  const [collapsed, setCollapsed] = useState(false);
  if (!busy) return null;
  const channel = state.channels.find((c) => c.id === call.channelId);
  const title = channel
    ? channel.type === 'dm'
      ? channel.dmUserName || 'Direct call'
      : `#${channel.displayName}`
    : 'Call';
  const others = snapshot.participants;
  const sharer = others.find((p) => p.screenTrack && p.state !== 'lost');
  const status = call.phase === 'joining' ? 'Connecting…' : others.length ? `${others.length + 1} in call` : 'Calling…';
  return (
    <aside className={`call-panel${collapsed ? ' collapsed' : ''}`} data-testid="call-panel" aria-label="Voice call">
      <div className="call-head">
        <Phone size={14} aria-hidden="true" />
        <strong className="call-title">{title}</strong>
        <span className="muted">{status}</span>
        <button
          className="icon-btn only-narrow push-right"
          aria-label={collapsed ? 'Show call' : 'Hide call'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {!collapsed && (
        <div className="call-body">
          {sharer && <RemoteScreen track={sharer.screenTrack!} name={sharer.userName} />}
          {snapshot.sharing && <p className="muted call-self-share">You are sharing your screen</p>}
          <ul className="call-people" aria-label="People in the call">
            <li className="call-person" data-testid="call-participant" data-user-id={user.id} data-state="connected">
              <span className="call-name">{user.fullName} (you)</span>
              {snapshot.muted && <MicOff size={13} aria-label="muted" />}
              {snapshot.sharing && <MonitorUp size={13} aria-label="sharing" />}
            </li>
            {others.map((p) => (
              <li
                key={p.userId}
                className={`call-person state-${p.state}`}
                data-testid="call-participant"
                data-user-id={p.userId}
                data-state={p.state}
              >
                <span className="call-name">{p.userName}</span>
                {p.muted && <MicOff size={13} aria-label="muted" />}
                {p.sharing && <MonitorUp size={13} aria-label="sharing" />}
                {p.state === 'connecting' && <span className="muted">connecting…</span>}
                {p.state === 'lost' && <span className="muted call-lost">connection lost</span>}
              </li>
            ))}
          </ul>
          {shareError && (
            <p className="error" role="alert">
              {shareError}
            </p>
          )}
        </div>
      )}
      <div className="call-controls">
        <button
          className={`call-btn${snapshot.muted ? ' on' : ''}`}
          data-testid="call-mute"
          aria-pressed={snapshot.muted}
          aria-label={snapshot.muted ? 'Unmute' : 'Mute'}
          disabled={call.phase !== 'in-call'}
          onClick={toggleMute}
        >
          {snapshot.muted ? <MicOff size={16} /> : <Mic size={16} />}
          <span>{snapshot.muted ? 'Unmute' : 'Mute'}</span>
        </button>
        {canShare() && (
          <button
            className={`call-btn${snapshot.sharing ? ' on' : ''}`}
            data-testid="call-share"
            aria-pressed={snapshot.sharing}
            aria-label={snapshot.sharing ? 'Stop sharing' : 'Share screen'}
            disabled={call.phase !== 'in-call'}
            onClick={() => void toggleShare()}
          >
            {snapshot.sharing ? <MonitorOff size={16} /> : <MonitorUp size={16} />}
            <span>{snapshot.sharing ? 'Stop sharing' : 'Share screen'}</span>
          </button>
        )}
        <button className="call-btn call-leave" data-testid="call-leave" aria-label="Leave call" onClick={leaveCall}>
          <PhoneOff size={16} />
          <span>Leave</span>
        </button>
      </div>
      {others.map((p) => (p.audioTrack ? <RemoteAudio key={`${p.userId}`} track={p.audioTrack} /> : null))}
    </aside>
  );
}
