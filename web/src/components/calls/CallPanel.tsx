import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Maximize2, Mic, MicOff, MonitorUp, MonitorOff, Phone, PhoneOff, Undo2 } from 'lucide-react';
import { useChat } from '../../context/ChatProvider.tsx';
import { useCall } from '../../context/CallProvider.tsx';
import type { TrackLike } from '../../services/callManager.ts';

function useTrackStream<E extends HTMLMediaElement>(track: TrackLike | null) {
  const ref = useRef<E | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!track) { el.srcObject = null; return; }
    try { el.srcObject = new MediaStream([track as unknown as MediaStreamTrack]); void el.play().catch(() => {}); } catch { /* unsupported */ }
    return () => { el.srcObject = null; };
  }, [track]);
  return ref;
}

/** One hidden player per remote peer for their voice. */
function RemoteAudio({ track }: { track: TrackLike }) {
  const ref = useTrackStream<HTMLAudioElement>(track);
  return <audio ref={ref} autoPlay hidden />;
}

/**
 * Someone's shared screen. Small in the call panel by default; "Full screen" fills this monitor,
 * "Open in window" moves it to its own browser window (drag it to a second monitor, maximise it).
 * The window shows the same live stream — nothing extra is sent or received.
 */
function RemoteScreen({ track, name }: { track: TrackLike; name: string }) {
  const ref = useTrackStream<HTMLVideoElement>(track);
  const win = useRef<Window | null>(null);
  const [popped, setPopped] = useState(false);
  const bringBack = () => { const w = win.current; win.current = null; setPopped(false); try { w?.close(); } catch { /* already closed */ } };
  // The window goes away when the share ends, the sharer changes, the call ends or this page closes.
  useEffect(() => { const close = () => bringBack(); window.addEventListener('pagehide', close); return () => { window.removeEventListener('pagehide', close); close(); }; }, [track]);
  const fullScreen = () => { const v = ref.current; if (v?.requestFullscreen) void v.requestFullscreen().catch(() => {}); };
  const popOut = () => {
    const w = window.open('', 'chat-shared-screen', 'popup,width=1280,height=760');
    if (!w) { fullScreen(); return; }   // pop-ups blocked: full screen is the next best thing
    win.current = w;
    w.document.title = `${name}'s screen`;
    w.document.body.style.cssText = 'margin:0;background:#111827;overflow:hidden';
    w.document.body.replaceChildren();
    const v = w.document.createElement('video');
    v.autoplay = true; v.muted = true; v.playsInline = true;
    v.style.cssText = 'width:100vw;height:100vh;object-fit:contain;display:block';
    v.ondblclick = () => { void (w.document.fullscreenElement ? w.document.exitFullscreen() : v.requestFullscreen()).catch(() => {}); };
    try { v.srcObject = new MediaStream([track as unknown as MediaStreamTrack]); void v.play().catch(() => {}); } catch { /* unsupported */ }
    w.document.body.appendChild(v);
    w.addEventListener('pagehide', () => { if (win.current === w) { win.current = null; setPopped(false); } });
    setPopped(true);
  };
  return (
    <figure className="call-screen">
      <video ref={ref} autoPlay playsInline muted data-testid="call-remote-screen" aria-label={`${name}'s screen`} onDoubleClick={fullScreen} />
      <figcaption className="call-screen-bar">
        <span className="muted call-name">{popped ? `${name}'s screen is open in its own window` : `${name} is sharing their screen`}</span>
        <button className="icon-btn" data-testid="call-screen-full" aria-label="Full screen" title="Full screen" onClick={fullScreen}><Maximize2 size={15} /></button>
        {popped
          ? <button className="icon-btn" data-testid="call-screen-back" aria-label="Close the separate window" title="Close the separate window" onClick={bringBack}><Undo2 size={15} /></button>
          : <button className="icon-btn" data-testid="call-screen-pop" aria-label="Open in a separate window" title="Open in a separate window" onClick={popOut}><ExternalLink size={15} /></button>}
      </figcaption>
    </figure>
  );
}

const canShare = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';

/** Docked call panel (right side on desktop, full screen under 720 px, collapsible there). Escape does not leave. */
export function CallPanel() {
  const { state, user } = useChat();
  const { call, snapshot, shareError, busy, toggleMute, toggleShare, leaveCall } = useCall();
  const [collapsed, setCollapsed] = useState(false);
  if (!busy) return null;
  const channel = state.channels.find((c) => c.id === call.channelId);
  const title = channel ? (channel.type === 'dm' ? channel.dmUserName || 'Direct call' : `#${channel.displayName}`) : 'Call';
  const others = snapshot.participants;
  const sharer = others.find((p) => p.screenTrack && p.state !== 'lost');
  const status = call.phase === 'joining' ? 'Connecting…' : others.length ? `${others.length + 1} in call` : 'Calling…';
  return (
    <aside className={`call-panel${collapsed ? ' collapsed' : ''}`} data-testid="call-panel" aria-label="Voice call">
      <div className="call-head">
        <Phone size={14} aria-hidden="true" />
        <strong className="call-title">{title}</strong>
        <span className="muted">{status}</span>
        <button className="icon-btn only-narrow push-right" aria-label={collapsed ? 'Show call' : 'Hide call'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
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
              <li key={p.userId} className={`call-person state-${p.state}`} data-testid="call-participant" data-user-id={p.userId} data-state={p.state}>
                <span className="call-name">{p.userName}</span>
                {p.muted && <MicOff size={13} aria-label="muted" />}
                {p.sharing && <MonitorUp size={13} aria-label="sharing" />}
                {p.state === 'connecting' && <span className="muted">connecting…</span>}
                {p.state === 'lost' && <span className="muted call-lost">connection lost</span>}
              </li>
            ))}
          </ul>
          {shareError && <p className="error" role="alert">{shareError}</p>}
        </div>
      )}
      <div className="call-controls">
        <button className={`call-btn${snapshot.muted ? ' on' : ''}`} data-testid="call-mute" aria-pressed={snapshot.muted} aria-label={snapshot.muted ? 'Unmute' : 'Mute'} disabled={call.phase !== 'in-call'} onClick={toggleMute}>
          {snapshot.muted ? <MicOff size={16} /> : <Mic size={16} />}<span>{snapshot.muted ? 'Unmute' : 'Mute'}</span>
        </button>
        {canShare() && (
          <button className={`call-btn${snapshot.sharing ? ' on' : ''}`} data-testid="call-share" aria-pressed={snapshot.sharing} aria-label={snapshot.sharing ? 'Stop sharing' : 'Share screen'} disabled={call.phase !== 'in-call'} onClick={() => void toggleShare()}>
            {snapshot.sharing ? <MonitorOff size={16} /> : <MonitorUp size={16} />}<span>{snapshot.sharing ? 'Stop sharing' : 'Share screen'}</span>
          </button>
        )}
        <button className="call-btn call-leave" data-testid="call-leave" aria-label="Leave call" onClick={leaveCall}>
          <PhoneOff size={16} /><span>Leave</span>
        </button>
      </div>
      {others.map((p) => (p.audioTrack ? <RemoteAudio key={`${p.userId}`} track={p.audioTrack} /> : null))}
    </aside>
  );
}
