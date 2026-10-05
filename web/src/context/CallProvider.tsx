import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { useActiveChannelCall } from '../hooks/useActiveChannelCall.ts';
import { useCallHostActions } from '../hooks/useCallHostActions.ts';
import { useCallRecording } from '../hooks/useCallRecording.ts';
import { useCallSocketEvents, type CallSession } from '../hooks/useCallSocketEvents.ts';
import { useLatest } from '../hooks/useLatest.ts';
import { useRinging } from '../hooks/useRinging.ts';
import { ApiError } from '../services/apiClient.ts';
import { createCallApi } from '../services/callApi.ts';
import { CallError, CallManager, type CallSnapshot, type PeerLike } from '../services/callManager.ts';
import { canRecord as browserCanRecord } from '../services/callRecorder.ts';
import { getMicrophone, getScreen } from '../services/media.ts';
import { Whiteboard, type Stroke, type View } from '../services/whiteboard.ts';
import type { CallInvite, CallJoinResponse, JoinRequest } from '../types/index.ts';
import { NO_BREAKOUT, roomOf, type Breakout, type BreakoutGroup } from '../utils/breakout.ts';
import { callErrorText } from '../utils/callErrors.ts';
import { stopRingtone } from '../utils/ringtone.ts';
import { CallContext, type ActiveCall, type CallContextValue, type CallReaction } from './callContext.ts';
import { callReducer, initialCallState, type IncomingCall } from './callState.ts';
import { useChat } from './chatContext.ts';
import { useToast } from './ToastProvider.tsx';

const NOBODY: CallSnapshot = {
  muted: false,
  sharing: false,
  ownScreenTrack: null,
  ownAudioTrack: null,
  participants: [],
};
const MAX_REACTIONS_SHOWN = 24;
const NOTICE_SHOWN_MS = 6000;
const WAITING_CAP_MS = 35_000; // the server stops a ring after 30 s; this only guards a lost event

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
  const [hands, setHands] = useState<number[]>([]);
  const [reactions, setReactions] = useState<CallReaction[]>([]);
  const [invites, setInvites] = useState<CallInvite[]>([]);
  const [breakout, setBreakout] = useState<Breakout>(NO_BREAKOUT);
  const nextReaction = useRef(1);
  const prefsRef = useLatest(state.prefs);

  const ui = useLatest(call);
  const handsRef = useLatest(hands);
  const manager = useRef<CallManager | null>(null);
  const callId = useRef<string | null>(null);
  const joinedSocket = useRef<string | null>(null);
  /** Run just before this tab's call is dropped: a recording in progress is stopped and saved. */
  const beforeTeardown = useRef<() => void>(() => {});
  const toast = useToast();
  const tell = useCallback((text: string) => void toast({ text }), [toast]);
  const onPersonJoined = useCallback(
    (name: string) =>
      void toast({
        icon: <Check size={16} />,
        text: (
          <>
            <b>{name}</b> joined the call
          </>
        ),
      }),
    [toast],
  );
  const whiteboard = useMemo(
    () =>
      new Whiteboard({
        myUserId: user.id,
        send: (op) => {
          if (callId.current) socket.emit('call_wb', { call_id: callId.current, op });
        },
      }),
    [socket, user.id],
  );
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
    beforeTeardown.current();
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
    setHands([]);
    setReactions([]);
    setInvites([]);
    setBreakout(NO_BREAKOUT);
    setRecordingRef.current(null);
    whiteboard.reset();
  }, [whiteboard]);

  const setRecordingRef = useRef<(value: { by: number; since: number } | null) => void>(() => {});
  const { recording, setRecording, toggleRecording, finishRecording } = useCallRecording({
    socket,
    callApi,
    userId: user.id,
    callId,
    ui,
    snapshot,
    tell,
    setPanelError,
  });
  setRecordingRef.current = setRecording;
  beforeTeardown.current = finishRecording;

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
    async (
      channelId: string,
      knownCallId: string | null,
      request: (socketId: string) => Promise<CallJoinResponse>,
      { switching = false }: { switching?: boolean } = {},
    ) => {
      const phase = ui.current.phase;
      if (phase === 'joining' || phase === 'in-call') {
        if (!switching) {
          dispatch({ type: 'error', error: 'You are already in a call. Leave it first.' });
          return;
        }
        // Moving to another call: this tab leaves the one it is in first.
        const leaving = callId.current;
        attempt.current++;
        teardown();
        if (leaving && leaving !== knownCallId) tellServerILeft(leaving);
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
      let raised: number[] = [];
      let ringingNow: CallInvite[] = [];
      let drawn: Stroke[] = [];
      let looking: View | null = null;
      let beingRecorded: { by: number; since: number } | null = null;
      let groupsNow: Breakout = NO_BREAKOUT;
      let since = Date.now();
      try {
        const joined = await current.connect(async () => {
          const answer = await request(socketId);
          createdId = answer.call.id;
          hostId = answer.hostId ?? answer.call.initiatedBy;
          waiting = answer.joinRequests ?? [];
          raised = answer.hands ?? [];
          ringingNow = answer.invites ?? [];
          drawn = answer.whiteboard ?? [];
          looking = answer.whiteboardView ?? null;
          beingRecorded = answer.recording ?? null;
          groupsNow = answer.breakout ?? NO_BREAKOUT;
          since = answer.call.startedAt ? Date.parse(answer.call.startedAt) : Date.now();
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
        dispatch({ type: 'joined', callId: id, channelId, hostId, since });
        setJoinRequests(waiting);
        setHands(raised);
        setInvites(ringingNow);
        whiteboard.load(drawn, looking);
        setRecording(beingRecorded);
        setBreakout(groupsNow);
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
    [socket, createManager, tellServerILeft, setChannelCall, askToJoin, teardown, whiteboard, setRecording, ui],
  );

  const startCall = useCallback(
    (channelId: string) => enter(channelId, null, (socketId) => callApi.start(channelId, socketId)),
    [callApi, enter],
  );

  const joinDirect = useCallback(
    (id: string, channelId: string, opts: { switching?: boolean } = {}) =>
      enter(
        channelId,
        id,
        async (socketId) => {
          expectOwnJoin.current++;
          try {
            return await callApi.join(id, socketId);
          } catch (e) {
            expectOwnJoin.current = Math.max(0, expectOwnJoin.current - 1);
            throw e;
          }
        },
        opts,
      ),
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

  const acceptCall = useCallback(
    async (incoming: IncomingCall) => {
      const mine = callId.current;
      const phase = ui.current.phase;
      const inACall = phase === 'joining' || phase === 'in-call';
      if (!inACall) return joinCall(incoming.callId, incoming.channelId);
      // A one-to-one caller is brought into the call this tab is in: nobody has to leave anything.
      if (mine && phase === 'in-call' && incoming.channelType === 'dm' && !incoming.invited) {
        try {
          await callApi.merge(incoming.callId, mine);
          dispatch({ type: 'dismissed', callId: incoming.callId });
          setPanelNote(`${incoming.fromName} is joining your call`);
        } catch (e) {
          setPanelError(callErrorText(e));
        }
        return;
      }
      dispatch({ type: 'dismissed', callId: incoming.callId });
      return joinDirect(incoming.callId, incoming.channelId, { switching: true });
    },
    [callApi, joinCall, joinDirect, ui],
  );

  const inviteToCall = useCallback(
    async (userId: number) => {
      const id = callId.current;
      if (!id) return;
      setPanelError(null);
      try {
        const { invite } = await callApi.invite(id, userId);
        if (callId.current === id)
          setInvites((list) => (list.some((i) => i.userId === invite.userId) ? list : [...list, invite]));
      } catch (e) {
        if (callId.current === id) setPanelError(callErrorText(e));
      }
    },
    [callApi],
  );

  const cancelInvite = useCallback(
    async (userId: number) => {
      const id = callId.current;
      if (!id) return;
      try {
        await callApi.cancelInvite(id, userId);
        if (callId.current === id) setInvites((list) => list.filter((i) => i.userId !== userId));
      } catch (e) {
        if (callId.current === id) setPanelError(callErrorText(e));
      }
    },
    [callApi],
  );

  const isCallLive = useCallback(
    async (id: string) => {
      try {
        const { call: found } = await callApi.get(id);
        return found?.status === 'ringing' || found?.status === 'active';
      } catch {
        return false;
      }
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

  const setBreakoutGroups = useCallback(
    (groups: BreakoutGroup[]) => {
      if (callId.current) socket.emit('call_bo_set', { call_id: callId.current, groups });
    },
    [socket],
  );
  const startBreakouts = useCallback(() => {
    if (callId.current) socket.emit('call_bo_start', { call_id: callId.current });
  }, [socket]);
  const endBreakouts = useCallback(() => {
    if (callId.current) socket.emit('call_bo_end', { call_id: callId.current });
  }, [socket]);

  // Breakout groups open: my voice goes only to the people in my room. Sharing stops (it is paused meanwhile).
  useEffect(() => {
    const current = manager.current;
    if (!current) return;
    current.setRoom(
      roomOf(
        breakout,
        user.id,
        snapshot.participants.map((p) => p.userId),
      ),
    );
    if (breakout.active && current.snapshot().sharing) current.stopShare();
  }, [breakout, snapshot.participants, user.id]);

  const toggleHand = useCallback(() => {
    if (!callId.current) return;
    socket.emit('call_hand', { call_id: callId.current, up: !handsRef.current.includes(user.id) });
  }, [socket, user.id, handsRef]);

  const sendReaction = useCallback(
    (emoji: string) => {
      if (callId.current) socket.emit('call_reaction', { call_id: callId.current, emoji });
    },
    [socket],
  );

  const showReaction = useCallback((userId: number, emoji: string) => {
    const id = nextReaction.current++;
    setReactions((list) => [...list.slice(-(MAX_REACTIONS_SHOWN - 1)), { id, userId, emoji }]);
  }, []);
  const dismissReaction = useCallback((id: number) => setReactions((list) => list.filter((r) => r.id !== id)), []);

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
    setHands,
    setInvites,
    setRecording,
    setBreakout,
    whiteboard,
    onPersonJoined,
    showReaction,
    joinDirect,
  });
  useActiveChannelCall({ callApi, socket, channelId: currentChannelId, setChannelCall });

  const ringingCallId = call.phase === 'ringing-in' ? (call.incoming?.callId ?? null) : null;
  useRinging({ ringingCallId, callRef: ui, prefsRef, onGiveUp: (id) => dispatch({ type: 'dismissed', callId: id }) });

  // A call waiting behind this one gives up by itself if its "ended" event never arrives.
  const waitingCallId = call.waiting?.callId ?? null;
  useEffect(() => {
    if (!waitingCallId) return;
    const cap = setTimeout(() => dispatch({ type: 'dismissed', callId: waitingCallId }), WAITING_CAP_MS);
    return () => clearTimeout(cap);
  }, [waitingCallId]);

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

  const busy = call.phase === 'joining' || call.phase === 'in-call';

  // So does the note in the call panel.
  useEffect(() => {
    if (!panelNote) return;
    const timer = setTimeout(() => setPanelNote(null), NOTICE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [panelNote]);

  const isHost = call.phase === 'in-call' && call.hostId === user.id;
  // Recording saves into the call's conversation, so the person must be in it (not only added to the call).
  const canRecord =
    browserCanRecord() && (isHost || recording?.by === user.id) && state.channels.some((c) => c.id === call.channelId);

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
      hands,
      reactions,
      breakout,
      setBreakoutGroups,
      startBreakouts,
      endBreakouts,
      recording,
      canRecord,
      toggleRecording,
      whiteboard,
      invites,
      startCall,
      joinCall,
      declineCall,
      acceptCall,
      inviteToCall,
      cancelInvite,
      isCallLive,
      leaveCall,
      toggleMute,
      toggleShare,
      toggleHand,
      sendReaction,
      dismissReaction,
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
      hands,
      reactions,
      breakout,
      setBreakoutGroups,
      startBreakouts,
      endBreakouts,
      recording,
      canRecord,
      toggleRecording,
      whiteboard,
      invites,
      startCall,
      joinCall,
      declineCall,
      acceptCall,
      inviteToCall,
      cancelInvite,
      isCallLive,
      leaveCall,
      toggleMute,
      toggleShare,
      toggleHand,
      sendReaction,
      dismissReaction,
      muteParticipant,
      removeParticipant,
      answerJoinRequest,
      cancelAsk,
      clearMessages,
    ],
  );
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
