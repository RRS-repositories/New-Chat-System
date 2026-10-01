import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { useActiveChannelCall } from '../hooks/useActiveChannelCall.ts';
import { useCallHostActions } from '../hooks/useCallHostActions.ts';
import { useCallSocketEvents, type CallSession } from '../hooks/useCallSocketEvents.ts';
import { useLatest } from '../hooks/useLatest.ts';
import { useRinging } from '../hooks/useRinging.ts';
import { ApiError } from '../services/apiClient.ts';
import { createCallApi } from '../services/callApi.ts';
import { CallError, CallManager, type CallSnapshot, type PeerLike } from '../services/callManager.ts';
import { getMicrophone, getScreen } from '../services/media.ts';
import type { CallJoinResponse, JoinRequest } from '../types/index.ts';
import { callErrorText } from '../utils/callErrors.ts';
import { stopRingtone } from '../utils/ringtone.ts';
import { CallContext, type ActiveCall, type CallContextValue } from './callContext.ts';
import { callReducer, initialCallState } from './callState.ts';
import { useChat } from './chatContext.ts';

const NOBODY: CallSnapshot = { muted: false, sharing: false, ownScreenTrack: null, participants: [] };
const NOTICE_SHOWN_MS = 6000;

type Props = { socket: Socket; getToken: () => string | null; children: ReactNode };

/**
 * This tab's call: starting, joining and leaving it, the connections to the other people in it,
 * and which channels have a live call. A call belongs to one browser tab per person.
 */
export function CallProvider({ socket, getToken, children }: Props) {
  const { api, user, state, currentChannelId } = useChat();
  const callApi = useMemo(() => createCallApi({ api, getToken }), [api, getToken]);
  const [call, dispatch] = useReducer(callReducer, initialCallState);
  const [snapshot, setSnapshot] = useState<CallSnapshot>(NOBODY);
  const [activeByChannel, setActive] = useState<Record<string, ActiveCall>>({});
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelNote, setPanelNote] = useState<string | null>(null);
  const prefsRef = useLatest(state.prefs);

  const ui = useLatest(call);
  const manager = useRef<CallManager | null>(null);
  const callId = useRef<string | null>(null);
  const joinedSocket = useRef<string | null>(null);
  const expectOwnJoin = useRef(0);
  const rejoining = useRef(false);
  const startBuffer = useRef<Array<{ callId: string; apply: () => void }>>([]);
  const attempt = useRef(0);
  const session = useMemo<CallSession>(
    () => ({ manager, callId, ui, joinedSocket, expectOwnJoin, rejoining, startBuffer, attempt }),
    [ui],
  );
  const { joinRequests, setJoinRequests, muteParticipant, removeParticipant, answerJoinRequest } = useCallHostActions({
    callApi,
    callId,
    setPanelError,
  });

  /** Records (or clears, when `update` returns null) the live call of one channel. */
  const setChannelCall = useCallback(
    (channelId: string, update: (prev: ActiveCall | undefined) => ActiveCall | null) => {
      setActive((all) => {
        const next = update(all[channelId]);
        if (next) return { ...all, [channelId]: next };
        if (!(channelId in all)) return all;
        const { [channelId]: _removed, ...rest } = all;
        return rest;
      });
    },
    [],
  );

  /** Drops this tab's call locally: closes every connection and releases the microphone. */
  const teardown = useCallback(() => {
    const current = manager.current;
    manager.current = null;
    current?.leave();
    callId.current = null;
    joinedSocket.current = null;
    expectOwnJoin.current = 0;
    rejoining.current = false;
    startBuffer.current = [];
    setSnapshot(NOBODY);
    setPanelError(null);
    setPanelNote(null);
    setJoinRequests([]);
  }, []);

  const tellServerILeft = useCallback(
    (id: string) => {
      callApi.leave(id).catch(() => {});
    },
    [callApi],
  );

  const createManager = useCallback(
    () =>
      new CallManager({
        myUserId: user.id,
        createPeer: (iceServers) =>
          new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] }) as unknown as PeerLike,
        getMic: getMicrophone,
        getDisplay: getScreen,
        sendSignal: (toUserId, data) => {
          if (callId.current) {
            socket.emit('webrtc_signal', { call_id: callId.current, to_user_id: toUserId, signal_data: data });
          }
        },
        announceShare: async (on) => {
          if (!callId.current) throw new Error('You are not in a call');
          await callApi.setScreenShare(callId.current, on, socket.id);
        },
        onChange: (next) => {
          if (manager.current && !manager.current.isClosed) setSnapshot(next);
        },
      }),
    [callApi, socket, user.id],
  );

  /** The host removed this person: joining again means asking the host, then waiting for the answer. */
  const askToJoin = useCallback(
    async (id: string, channelId: string) => {
      dispatch({ type: 'asking', callId: id, channelId });
      try {
        await callApi.askToJoin(id);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'not_removed')
          dispatch({ type: 'ask_done', callId: id, allowed: true, notice: 'You can join the call now' });
        else dispatch({ type: 'ask_done', callId: id, allowed: false, error: callErrorText(e) });
      }
    },
    [callApi],
  );

  /** Shared by start and join: microphone first, then the request, then the connections. */
  const enter = useCallback(
    async (channelId: string, knownCallId: string | null, request: (socketId: string) => Promise<CallJoinResponse>) => {
      const phase = ui.current.phase;
      if (phase === 'joining' || phase === 'in-call') {
        dispatch({ type: 'error', error: 'You are already in a call. Leave it first.' });
        return;
      }
      const socketId = socket.id;
      if (!socket.connected || !socketId) {
        dispatch({ type: 'error', error: 'Not connected — try again in a moment' });
        return;
      }
      stopRingtone();
      const thisAttempt = ++attempt.current;
      const stillCurrent = () => attempt.current === thisAttempt;
      dispatch({ type: 'join_begin', callId: knownCallId, channelId });
      callId.current = knownCallId;
      const current = createManager();
      manager.current = current;
      let createdId: string | null = null;
      let hostId: number | null = null;
      let waiting: JoinRequest[] = [];
      try {
        const joined = await current.connect(async () => {
          const answer = await request(socketId);
          createdId = answer.call.id;
          hostId = answer.call.initiatedBy;
          waiting = answer.joinRequests ?? [];
          if (stillCurrent()) callId.current = answer.call.id;
          // Anyone who joined (and offered) before this answer arrived: the manager holds them until the connections are built.
          const early = startBuffer.current;
          startBuffer.current = [];
          if (stillCurrent()) for (const held of early) if (held.callId === answer.call.id) held.apply();
          return { participants: answer.participants, iceServers: answer.iceServers };
        });
        if (!stillCurrent()) return;
        joinedSocket.current = socketId;
        const id = createdId!;
        dispatch({ type: 'joined', callId: id, channelId, hostId });
        setJoinRequests(waiting);
        setSnapshot(current.snapshot());
        setChannelCall(channelId, () => ({ callId: id, participantIds: joined.participants.map((p) => p.userId) }));
      } catch (e) {
        // Left while the request was in flight: the server created or joined the call, so tell it we are gone.
        if (createdId && e instanceof CallError && e.code === 'left') {
          tellServerILeft(createdId);
          return;
        }
        if (!stillCurrent()) return;
        if (manager.current === current) manager.current = null;
        current.leave();
        callId.current = null;
        // The host removed this person earlier (this tab did not know): ask to come back instead.
        if (e instanceof ApiError && e.code === 'removed' && knownCallId) {
          dispatch({ type: 'left' });
          dispatch({ type: 'removed', callId: knownCallId });
          void askToJoin(knownCallId, channelId);
          return;
        }
        if (e instanceof ApiError && e.code === 'call_in_progress' && e.data?.callId) {
          setChannelCall(channelId, (prev) => prev ?? { callId: String(e.data.callId), participantIds: [] });
        }
        if (e instanceof ApiError && (e.code === 'call_ended' || e.code === 'not_found')) {
          setChannelCall(channelId, (prev) => (prev?.callId === knownCallId ? null : (prev ?? null)));
        }
        dispatch({ type: 'failed', error: callErrorText(e) });
      }
    },
    [socket, createManager, tellServerILeft, setChannelCall, askToJoin, ui],
  );

  const startCall = useCallback(
    (channelId: string) => enter(channelId, null, (socketId) => callApi.start(channelId, socketId)),
    [callApi, enter],
  );

  const joinDirect = useCallback(
    (id: string, channelId: string) =>
      enter(channelId, id, async (socketId) => {
        expectOwnJoin.current++;
        try {
          return await callApi.join(id, socketId);
        } catch (e) {
          expectOwnJoin.current = Math.max(0, expectOwnJoin.current - 1);
          throw e;
        }
      }),
    [callApi, enter],
  );

  const joinCall = useCallback(
    (id: string, channelId: string) =>
      ui.current.removedFrom.includes(id) ? askToJoin(id, channelId) : joinDirect(id, channelId),
    [askToJoin, joinDirect, ui],
  );

  const cancelAsk = useCallback(() => {
    const asking = ui.current.asking;
    if (!asking) return;
    dispatch({ type: 'ask_done', callId: asking.callId, allowed: false });
    callApi.cancelAsk(asking.callId).catch(() => {});
  }, [callApi, ui]);

  const declineCall = useCallback(
    (id: string) => {
      stopRingtone();
      dispatch({ type: 'dismissed', callId: id });
      callApi.decline(id).catch(() => {});
    },
    [callApi],
  );

  const leaveCall = useCallback(() => {
    const id = callId.current;
    attempt.current++;
    teardown();
    if (id) tellServerILeft(id);
    dispatch({ type: 'left' });
  }, [teardown, tellServerILeft]);

  const toggleMute = useCallback(() => {
    const current = manager.current;
    if (current) current.setMuted(!current.snapshot().muted);
  }, []);

  const toggleShare = useCallback(async () => {
    const current = manager.current;
    if (!current) return;
    setPanelError(null);
    if (current.snapshot().sharing) {
      current.stopShare();
      return;
    }
    const result = await current.startShare();
    if (!result.ok && result.reason !== 'cancelled' && manager.current === current) setPanelError(result.message);
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'notice', notice: null });
  }, []);

  useCallSocketEvents({
    socket,
    callApi,
    userId: user.id,
    session,
    dispatch,
    teardown,
    setChannelCall,
    setJoinRequests,
    setPanelNote,
    joinDirect,
  });
  useActiveChannelCall({ callApi, socket, channelId: currentChannelId, setChannelCall });

  const ringingCallId = call.phase === 'ringing-in' ? (call.incoming?.callId ?? null) : null;
  useRinging({ ringingCallId, callRef: ui, prefsRef, onGiveUp: (id) => dispatch({ type: 'dismissed', callId: id }) });

  // Closing the page leaves the call (best effort: the server also notices the lost connection).
  useEffect(() => {
    let sent = false;
    const leaveNow = () => {
      const id = callId.current;
      if (!id || !manager.current || sent) return;
      sent = true;
      try {
        manager.current.leave();
      } catch {
        /* the page is going anyway */
      }
      callApi.leaveOnPageClose(id);
    };
    window.addEventListener('pagehide', leaveNow);
    window.addEventListener('beforeunload', leaveNow);
    return () => {
      window.removeEventListener('pagehide', leaveNow);
      window.removeEventListener('beforeunload', leaveNow);
    };
  }, [callApi]);

  // Signing out (this provider goes away) leaves the call too.
  useEffect(
    () => () => {
      const id = callId.current;
      const current = manager.current;
      manager.current = null;
      current?.leave();
      if (id) callApi.leave(id).catch(() => {});
    },
    [callApi],
  );

  // On wide screens the call panel docks on the right: the page makes room for it (see calls.css `body.in-call`).
  const busy = call.phase === 'joining' || call.phase === 'in-call';
  useEffect(() => {
    document.body.classList.toggle('in-call', busy);
    return () => document.body.classList.remove('in-call');
  }, [busy]);

  // So does the note in the call panel.
  useEffect(() => {
    if (!panelNote) return;
    const timer = setTimeout(() => setPanelNote(null), NOTICE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [panelNote]);

  const isHost = call.phase === 'in-call' && call.hostId === user.id;

  // Notices fade on their own.
  useEffect(() => {
    if (!call.notice) return;
    const timer = setTimeout(() => dispatch({ type: 'notice', notice: null }), NOTICE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [call.notice]);

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      snapshot,
      activeByChannel,
      busy,
      panelError,
      panelNote,
      isHost,
      joinRequests,
      startCall,
      joinCall,
      declineCall,
      leaveCall,
      toggleMute,
      toggleShare,
      muteParticipant,
      removeParticipant,
      answerJoinRequest,
      cancelAsk,
      clearMessages,
    }),
    [
      call,
      snapshot,
      activeByChannel,
      busy,
      panelError,
      panelNote,
      isHost,
      joinRequests,
      startCall,
      joinCall,
      declineCall,
      leaveCall,
      toggleMute,
      toggleShare,
      muteParticipant,
      removeParticipant,
      answerJoinRequest,
      cancelAsk,
      clearMessages,
    ],
  );
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
