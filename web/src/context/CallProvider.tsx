import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { ApiError } from '../services/apiClient.ts';
import type { CallJoinResponse, CallParticipant } from '../types/index.ts';
import { useChat } from './ChatProvider.tsx';
import { callReducer, initialCallState, type CallUiState, type EndStatus, type IncomingCall } from './callState.ts';
import { CallError, CallManager, MIC_CONSTRAINTS, type CallSnapshot, type PeerLike, type StreamLike } from '../services/callManager.ts';
import { startRingtone, stopRingtone } from '../utils/ringtone.ts';
import { isLookedAt, showDesktopNotification } from '../utils/notify.ts';

/** A live call in a channel (from GET …/calls/active and the call_* events). */
export type ActiveCall = { callId: string; participantIds: number[] };

type CallCtx = {
  call: CallUiState;
  snapshot: CallSnapshot;
  /** Live calls per channel, as far as this tab knows. */
  activeByChannel: Record<string, ActiveCall>;
  /** This tab is joining or in a call. */
  busy: boolean;
  shareError: string | null;
  startCall: (channelId: string) => Promise<void>;
  joinCall: (callId: string, channelId: string) => Promise<void>;
  declineCall: (callId: string) => void;
  leaveCall: () => void;
  toggleMute: () => void;
  toggleShare: () => Promise<void>;
  clearMessages: () => void;
};
const Ctx = createContext<CallCtx | null>(null);
const EMPTY: CallSnapshot = { muted: false, sharing: false, participants: [] };
const RING_CAP_MS = 35_000; // the server ends an unanswered call after 30 s; this only guards a lost event

function errorText(e: unknown): string {
  if (e instanceof CallError) return e.message;
  if (e instanceof ApiError) {
    if (e.code === 'call_in_progress') return 'A call is already in progress in this channel';
    if (e.code === 'call_full') return 'This call is full';
    if (e.code === 'restricted') return 'You cannot call this person';
    if (e.code === 'call_ended' || e.code === 'not_found') return 'This call has ended';
    if (e.code === 'bad_socket') return 'Not connected — try again in a moment';
    return e.message;
  }
  return (e as any)?.message || 'Could not join the call';
}

async function getMic(): Promise<StreamLike> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no media devices');
  return (await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS }, video: false })) as unknown as StreamLike;
}
async function getDisplay(): Promise<StreamLike> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('screen sharing is not supported here');
  return (await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })) as unknown as StreamLike;
}

export function CallProvider({ socket, getToken, children }: { socket: Socket; getToken: () => string | null; children: ReactNode }) {
  const { api, user, state, currentChannelId } = useChat();
  const [call, dispatch] = useReducer(callReducer, initialCallState);
  const [snapshot, setSnapshot] = useState<CallSnapshot>(EMPTY);
  const [activeByChannel, setActive] = useState<Record<string, ActiveCall>>({});
  const [shareError, setShareError] = useState<string | null>(null);

  const callRef = useRef(call); callRef.current = call;
  const mgr = useRef<CallManager | null>(null);
  /** The call this tab is joining/in (set as soon as it is known, before React state catches up). */
  const callIdRef = useRef<string | null>(null);
  /** The socket id this tab joined the call on (a reconnect gets a new one → re-join). */
  const joinedSocket = useRef<string | null>(null);
  /** Own `call_participant_joined` events we caused ourselves (join / re-join), not a takeover by another tab. */
  const expectOwnJoin = useRef(0);
  const rejoining = useRef(false);
  /** While my own start request is in flight the call id is unknown: others' joins/signals for it wait here. */
  const startBuffer = useRef<Array<{ callId: string; apply: () => void }>>([]);
  const attempt = useRef(0);
  const prefsRef = useRef(state.prefs); prefsRef.current = state.prefs;

  const setChannelCall = useCallback((channelId: string, update: (prev: ActiveCall | undefined) => ActiveCall | null) => {
    setActive((all) => {
      const next = update(all[channelId]);
      if (!next) { if (!(channelId in all)) return all; const { [channelId]: _gone, ...rest } = all; return rest; }
      return { ...all, [channelId]: next };
    });
  }, []);

  const teardown = useCallback(() => {
    const m = mgr.current; mgr.current = null;
    m?.leave();
    callIdRef.current = null; joinedSocket.current = null; expectOwnJoin.current = 0; rejoining.current = false; startBuffer.current = [];
    setSnapshot(EMPTY); setShareError(null);
  }, []);

  const postLeave = useCallback((callId: string) => { api.post(`/api/chat/calls/${encodeURIComponent(callId)}/leave`).catch(() => {}); }, [api]);

  const makeManager = useCallback(() => new CallManager({
    myUserId: user.id,
    createPeer: (iceServers) => new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] }) as unknown as PeerLike,
    getMic, getDisplay,
    sendSignal: (toUserId, data) => { if (callIdRef.current) socket.emit('webrtc_signal', { call_id: callIdRef.current, to_user_id: toUserId, signal_data: data }); },
    announceShare: async (on) => {
      const id = callIdRef.current; if (!id) throw new Error('You are not in a call');
      await api.post(`/api/chat/calls/${encodeURIComponent(id)}/screen-share`, { on, socketId: socket.id });
    },
    onChange: (s) => { if (mgr.current && !mgr.current.isClosed) setSnapshot(s); },
  }), [api, socket, user.id]);

  /** Shared by start and join: microphone first, then the request, then the mesh. */
  const enter = useCallback(async (channelId: string, callId: string | null, request: (socketId: string) => Promise<CallJoinResponse>) => {
    const phase = callRef.current.phase;
    if (phase === 'joining' || phase === 'in-call') { dispatch({ type: 'error', error: 'You are already in a call. Leave it first.' }); return; }
    const socketId = socket.id;
    if (!socket.connected || !socketId) { dispatch({ type: 'error', error: 'Not connected — try again in a moment' }); return; }
    stopRingtone();
    const mine = ++attempt.current;
    dispatch({ type: 'join_begin', callId, channelId });
    callIdRef.current = callId;
    const m = makeManager(); mgr.current = m;
    let createdId: string | null = null;
    try {
      const r = await m.connect(async () => {
        const out = await request(socketId);
        createdId = out.call.id; if (attempt.current === mine) callIdRef.current = out.call.id;
        // Anyone who joined (and offered) before this answer arrived: the manager still holds them until the mesh is built.
        const early = startBuffer.current; startBuffer.current = [];
        if (attempt.current === mine) for (const b of early) if (b.callId === out.call.id) b.apply();
        return { participants: out.participants, iceServers: out.iceServers };
      });
      if (attempt.current !== mine) return;
      joinedSocket.current = socketId;
      const id = createdId!;
      dispatch({ type: 'joined', callId: id, channelId });
      setSnapshot(m.snapshot());
      setChannelCall(channelId, () => ({ callId: id, participantIds: r.participants.map((p) => p.userId) }));
    } catch (e) {
      if (createdId && e instanceof CallError && e.code === 'left') { postLeave(createdId); return; } // left while the request was in flight
      if (attempt.current !== mine) return;
      if (mgr.current === m) mgr.current = null;
      m.leave(); callIdRef.current = null;
      if (e instanceof ApiError && e.code === 'call_in_progress' && e.data?.callId) setChannelCall(channelId, (prev) => prev ?? { callId: String(e.data.callId), participantIds: [] });
      if (e instanceof ApiError && (e.code === 'call_ended' || e.code === 'not_found')) setChannelCall(channelId, (prev) => (prev?.callId === callId ? null : prev ?? null));
      dispatch({ type: 'failed', error: errorText(e) });
    }
  }, [socket, makeManager, postLeave, setChannelCall]);

  const startCall = useCallback((channelId: string) => enter(channelId, null, (socketId) =>
    api.post<CallJoinResponse>(`/api/chat/channels/${encodeURIComponent(channelId)}/calls`, { socketId })), [api, enter]);

  const joinCall = useCallback((callId: string, channelId: string) => enter(channelId, callId, async (socketId) => {
    expectOwnJoin.current++;
    try { return await api.post<CallJoinResponse>(`/api/chat/calls/${encodeURIComponent(callId)}/join`, { socketId }); }
    catch (e) { expectOwnJoin.current = Math.max(0, expectOwnJoin.current - 1); throw e; }
  }), [api, enter]);

  const declineCall = useCallback((callId: string) => {
    stopRingtone();
    dispatch({ type: 'dismissed', callId });
    api.post(`/api/chat/calls/${encodeURIComponent(callId)}/decline`).catch(() => {});
  }, [api]);

  const leaveCall = useCallback(() => {
    const id = callIdRef.current;
    attempt.current++;
    teardown();
    if (id) postLeave(id);
    dispatch({ type: 'left' });
  }, [teardown, postLeave]);

  const toggleMute = useCallback(() => { const m = mgr.current; if (m) m.setMuted(!m.snapshot().muted); }, []);
  const toggleShare = useCallback(async () => {
    const m = mgr.current; if (!m) return;
    setShareError(null);
    if (m.snapshot().sharing) { m.stopShare(); return; }
    const r = await m.startShare();
    if (!r.ok && r.reason !== 'cancelled' && mgr.current === m) setShareError(r.message);
  }, []);
  const clearMessages = useCallback(() => { dispatch({ type: 'error', error: null }); dispatch({ type: 'notice', notice: null }); }, []);

  // ---- socket events -------------------------------------------------------
  useEffect(() => {
    const mineCall = (id: string) => !!id && callIdRef.current === id && !!mgr.current;
    const startInFlight = () => !!mgr.current && !callIdRef.current;
    const hold = (callId: string, apply: () => void) => { if (startBuffer.current.length < 500) startBuffer.current.push({ callId, apply }); };
    const onStarted = (p: { call_id: string; channel_id: string; channel_name: string; channel_type: IncomingCall['channelType']; initiated_by: number; initiated_by_name: string }) => {
      setChannelCall(p.channel_id, () => ({ callId: p.call_id, participantIds: [Number(p.initiated_by)] }));
      if (Number(p.initiated_by) === user.id) return; // own call (maybe from another tab): never ring
      dispatch({ type: 'incoming', call: { callId: p.call_id, channelId: p.channel_id, channelName: p.channel_name || '', channelType: p.channel_type, fromId: Number(p.initiated_by), fromName: p.initiated_by_name || 'Someone' } });
    };
    const onJoined = (p: { call_id: string; channel_id: string; user_id: number; user_name: string }) => {
      const uid = Number(p.user_id);
      setChannelCall(p.channel_id, (prev) => ({ callId: p.call_id, participantIds: [...new Set([...(prev?.callId === p.call_id ? prev.participantIds : []), uid])] }));
      if (uid === user.id) {
        if (callRef.current.phase === 'ringing-in') dispatch({ type: 'dismissed', callId: p.call_id }); // answered in another tab
        if (mineCall(p.call_id)) {
          if (expectOwnJoin.current > 0) { expectOwnJoin.current--; return; }
          // Another tab of mine took the call over: this tab drops out quietly (no leave — I am still in the call there).
          attempt.current++; teardown(); dispatch({ type: 'left', notice: 'The call continued in another tab' });
        }
        return;
      }
      if (mineCall(p.call_id)) mgr.current!.addParticipant(uid, p.user_name || '');
      else if (startInFlight()) hold(p.call_id, () => mgr.current?.addParticipant(uid, p.user_name || ''));
    };
    const onLeft = (p: { call_id: string; channel_id: string; user_id: number }) => {
      const uid = Number(p.user_id);
      setChannelCall(p.channel_id, (prev) => (prev?.callId === p.call_id ? { ...prev, participantIds: prev.participantIds.filter((x) => x !== uid) } : prev ?? null));
      if (!mineCall(p.call_id)) return;
      if (uid === user.id) {
        if (rejoining.current) return;
        attempt.current++; teardown(); dispatch({ type: 'left', notice: 'You were disconnected from the call' });
        return;
      }
      mgr.current!.removeParticipant(uid);
    };
    const onEnded = (p: { call_id: string; channel_id: string; status: EndStatus }) => {
      setChannelCall(p.channel_id, (prev) => (prev && prev.callId !== p.call_id ? prev : null));
      if (mineCall(p.call_id) || callIdRef.current === p.call_id) { attempt.current++; teardown(); }
      dispatch({ type: 'ended', callId: p.call_id, status: p.status });
    };
    const onDismissed = (p: { call_id: string }) => dispatch({ type: 'dismissed', callId: p.call_id });
    const onShare = (on: boolean) => (p: { call_id: string; user_id: number }) => {
      if (mineCall(p.call_id) && Number(p.user_id) !== user.id) mgr.current!.setRemoteSharing(Number(p.user_id), on);
    };
    const onSignal = (p: { call_id: string; from_user_id: number; signal_data: any }) => {
      if (mineCall(p.call_id)) mgr.current!.handleSignal(Number(p.from_user_id), p.signal_data);
      else if (startInFlight()) hold(p.call_id, () => mgr.current?.handleSignal(Number(p.from_user_id), p.signal_data));
    };
    // A reconnect gives this tab a new socket id: re-join so the call follows it (the server waits 10 s).
    const onConnect = () => {
      const m = mgr.current; const id = callIdRef.current;
      if (!m || !id || callRef.current.phase !== 'in-call' || !socket.id || socket.id === joinedSocket.current) return;
      const socketId = socket.id; rejoining.current = true; expectOwnJoin.current++;
      m.rejoin(async () => {
        const r = await api.post<CallJoinResponse>(`/api/chat/calls/${encodeURIComponent(id)}/join`, { socketId });
        return { participants: r.participants, iceServers: r.iceServers };
      }).then(() => { if (mgr.current === m) joinedSocket.current = socketId; })
        .catch(() => { if (mgr.current === m) { attempt.current++; teardown(); dispatch({ type: 'left', notice: 'The call ended while you were disconnected' }); } })
        .finally(() => { rejoining.current = false; });
    };
    const handlers: Array<[string, (...a: any[]) => void]> = [
      ['call_started', onStarted], ['call_participant_joined', onJoined], ['call_participant_left', onLeft], ['call_ended', onEnded],
      ['call_dismissed', onDismissed], ['call_screen_share_started', onShare(true)], ['call_screen_share_stopped', onShare(false)],
      ['webrtc_signal', onSignal], ['connect', onConnect],
    ];
    for (const [ev, fn] of handlers) socket.on(ev, fn);
    return () => { for (const [ev, fn] of handlers) socket.off(ev, fn); };
  }, [socket, api, user.id, teardown, setChannelCall]);

  // ---- live call of the open channel (banner) -------------------------------
  useEffect(() => {
    if (!currentChannelId) return;
    let live = true; const id = currentChannelId;
    const load = () => api.get<{ call: { id: string } | null; participants: CallParticipant[] }>(`/api/chat/channels/${encodeURIComponent(id)}/calls/active`)
      .then((r) => { if (live) setChannelCall(id, () => (r.call ? { callId: r.call.id, participantIds: (r.participants || []).map((p) => p.userId) } : null)); })
      .catch(() => {});
    void load();
    socket.on('connect', load);
    return () => { live = false; socket.off('connect', load); };
  }, [api, socket, currentChannelId, setChannelCall]);

  // ---- ringing ------------------------------------------------------------
  const ringingId = call.phase === 'ringing-in' ? call.incoming?.callId ?? null : null;
  useEffect(() => {
    if (!ringingId) return;
    const inc = callRef.current.incoming;
    if (prefsRef.current.soundEnabled) startRingtone(30_000);
    if (inc && !isLookedAt({ hidden: document.hidden, focused: document.hasFocus() })) {
      void showDesktopNotification('Incoming call', `${inc.fromName} is calling${inc.channelType === 'dm' ? ' you' : ` in #${inc.channelName}`}`, inc.channelId);
    }
    const cap = setTimeout(() => dispatch({ type: 'dismissed', callId: ringingId }), RING_CAP_MS);
    return () => { clearTimeout(cap); stopRingtone(); };
  }, [ringingId]);

  // ---- leaving with the page ------------------------------------------------
  useEffect(() => {
    let sent = false;
    const bye = () => {
      const id = callIdRef.current; if (!id || !mgr.current || sent) return;
      sent = true;
      try { mgr.current.leave(); } catch { /* the page is going anyway */ }
      try {
        void fetch(`/api/chat/calls/${encodeURIComponent(id)}/leave`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` }, body: '{}' }).catch(() => {});
      } catch { /* best effort */ }
    };
    window.addEventListener('pagehide', bye); window.addEventListener('beforeunload', bye);
    return () => { window.removeEventListener('pagehide', bye); window.removeEventListener('beforeunload', bye); };
  }, [getToken]);
  // Signing out (the provider unmounts) leaves the call too.
  useEffect(() => () => { const id = callIdRef.current; const m = mgr.current; mgr.current = null; m?.leave(); if (id) api.post(`/api/chat/calls/${encodeURIComponent(id)}/leave`).catch(() => {}); }, [api]);

  // Desktop: the call panel docks on the right (styles.css `body.in-call`).
  const busy = call.phase === 'joining' || call.phase === 'in-call';
  useEffect(() => { document.body.classList.toggle('in-call', busy); return () => document.body.classList.remove('in-call'); }, [busy]);
  // Notices fade on their own.
  useEffect(() => { if (!call.notice) return; const t = setTimeout(() => dispatch({ type: 'notice', notice: null }), 6000); return () => clearTimeout(t); }, [call.notice]);

  const value = useMemo<CallCtx>(() => ({ call, snapshot, activeByChannel, busy, shareError, startCall, joinCall, declineCall, leaveCall, toggleMute, toggleShare, clearMessages }),
    [call, snapshot, activeByChannel, busy, shareError, startCall, joinCall, declineCall, leaveCall, toggleMute, toggleShare, clearMessages]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCall(): CallCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>');
  return ctx;
}

