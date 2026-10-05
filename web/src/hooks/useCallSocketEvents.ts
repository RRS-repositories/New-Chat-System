import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { ActiveCall } from '../context/callContext.ts';
import type { CallAction, CallUiState, EndStatus, IncomingCall } from '../context/callState.ts';
import type { CallApi } from '../services/callApi.ts';
import type { CallManager } from '../services/callManager.ts';
import type { BoardOp, Whiteboard } from '../services/whiteboard.ts';
import type { CallInvite, JoinRequest } from '../types/index.ts';
import type { Breakout } from '../utils/breakout.ts';
import { addJoinRequest, dropJoinRequest } from '../utils/joinRequests.ts';

const MAX_HELD_EVENTS = 500;

/** The working state of this tab's call that the event handlers and the actions share. */
export type CallSession = {
  manager: MutableRefObject<CallManager | null>;
  /** The call this tab is joining or in (set as soon as it is known, before React state catches up). */
  callId: MutableRefObject<string | null>;
  ui: MutableRefObject<CallUiState>;
  /** The connection id this tab joined the call on (a reconnect gets a new one, so it re-joins). */
  joinedSocket: MutableRefObject<string | null>;
  /** "I joined" events this tab caused itself (join or re-join), as opposed to another tab taking over. */
  expectOwnJoin: MutableRefObject<number>;
  rejoining: MutableRefObject<boolean>;
  /** While this tab's start request is in flight the call id is unknown: others' joins and signals wait here. */
  startBuffer: MutableRefObject<Array<{ callId: string; apply: () => void }>>;
  /** Counts start/join attempts, so a late answer from an abandoned attempt is ignored. */
  attempt: MutableRefObject<number>;
};

type Deps = {
  socket: Socket;
  callApi: CallApi;
  userId: number;
  session: CallSession;
  dispatch: Dispatch<CallAction>;
  /** Drops this tab's call locally (closes connections, releases the microphone). */
  teardown: () => void;
  setChannelCall: (channelId: string, update: (prev: ActiveCall | undefined) => ActiveCall | null) => void;
  /** Host only: the people waiting to be let back in. */
  setJoinRequests: Dispatch<SetStateAction<JoinRequest[]>>;
  /** A short note shown in the call panel. */
  setPanelNote: (note: string | null) => void;
  /** Who has a hand raised. */
  setHands: Dispatch<SetStateAction<number[]>>;
  /** Who is being rung into this tab's call. */
  setInvites: Dispatch<SetStateAction<CallInvite[]>>;
  /** Breakout groups changed. */
  setBreakout: (value: Breakout) => void;
  /** Who is recording the call (null: nobody). */
  setRecording: (value: { by: number; since: number } | null) => void;
  whiteboard: Whiteboard;
  /** Someone else came into this tab's call. */
  onPersonJoined: (name: string) => void;
  /** A reaction arrived: float it up the call screen. */
  showReaction: (userId: number, emoji: string) => void;
  /** Joins a call without asking the host (used once the host has let this person back in). */
  joinDirect: (callId: string, channelId: string, opts?: { switching?: boolean }) => Promise<void>;
};

/** Listens for call events from the server and keeps this tab's call, and the per-channel "live call" list, in step. */
export function useCallSocketEvents({
  socket,
  callApi,
  userId,
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
}: Deps): void {
  useEffect(() => {
    const { manager, callId, ui, joinedSocket, expectOwnJoin, rejoining, startBuffer, attempt } = session;
    const isMyCall = (id: string) => !!id && callId.current === id && !!manager.current;
    const startInFlight = () => !!manager.current && !callId.current;
    const hold = (id: string, apply: () => void) => {
      if (startBuffer.current.length < MAX_HELD_EVENTS) startBuffer.current.push({ callId: id, apply });
    };
    const dropOut = (notice: string) => {
      attempt.current++;
      teardown();
      dispatch({ type: 'left', notice });
    };

    const onStarted = (p: {
      call_id: string;
      channel_id: string;
      channel_name: string;
      channel_type: IncomingCall['channelType'];
      initiated_by: number;
      initiated_by_name: string;
    }) => {
      const callerId = Number(p.initiated_by);
      setChannelCall(p.channel_id, () => ({ callId: p.call_id, participantIds: [callerId] }));
      if (callerId === userId) return; // my own call (maybe from another tab): never ring
      dispatch({
        type: 'incoming',
        call: {
          callId: p.call_id,
          channelId: p.channel_id,
          channelName: p.channel_name || '',
          channelType: p.channel_type,
          fromId: callerId,
          fromName: p.initiated_by_name || 'Someone',
          at: Date.now(),
        },
      });
    };

    const onJoined = (p: { call_id: string; channel_id: string; user_id: number; user_name: string }) => {
      const joinerId = Number(p.user_id);
      setChannelCall(p.channel_id, (prev) => ({
        callId: p.call_id,
        participantIds: [...new Set([...(prev?.callId === p.call_id ? prev.participantIds : []), joinerId])],
      }));
      if (joinerId === userId) {
        if (ui.current.phase === 'ringing-in') dispatch({ type: 'dismissed', callId: p.call_id }); // answered in another tab
        if (!isMyCall(p.call_id)) return;
        if (expectOwnJoin.current > 0) {
          expectOwnJoin.current--;
          return;
        }
        // Another tab of mine took the call over: this tab drops out quietly (no leave — I am still in the call there).
        dropOut('The call continued in another tab');
        return;
      }
      if (isMyCall(p.call_id)) {
        setJoinRequests((list) => dropJoinRequest(list, joinerId)); // they are in: no longer waiting
        setInvites((list) => list.filter((i) => i.userId !== joinerId)); // nor ringing
        // A re-join (their connection dropped and came back) is not news.
        const alreadyHere = manager.current!.snapshot().participants.some((x) => x.userId === joinerId);
        manager.current!.addParticipant(joinerId, p.user_name || '');
        if (!alreadyHere && ui.current.phase === 'in-call') onPersonJoined(p.user_name || 'Someone');
      } else if (startInFlight()) hold(p.call_id, () => manager.current?.addParticipant(joinerId, p.user_name || ''));
    };

    const onLeft = (p: { call_id: string; channel_id: string; user_id: number }) => {
      const leaverId = Number(p.user_id);
      setChannelCall(p.channel_id, (prev) =>
        prev?.callId === p.call_id
          ? { ...prev, participantIds: prev.participantIds.filter((id) => id !== leaverId) }
          : (prev ?? null),
      );
      if (!isMyCall(p.call_id)) return;
      if (leaverId !== userId) {
        manager.current!.removeParticipant(leaverId);
        return;
      }
      if (!rejoining.current) dropOut('You were disconnected from the call');
    };

    const onEnded = (p: { call_id: string; channel_id: string; status: EndStatus }) => {
      setChannelCall(p.channel_id, (prev) => (prev && prev.callId !== p.call_id ? prev : null));
      if (isMyCall(p.call_id) || callId.current === p.call_id) {
        attempt.current++;
        teardown();
      }
      dispatch({ type: 'ended', callId: p.call_id, status: p.status });
    };

    const onDismissed = (p: { call_id: string }) => dispatch({ type: 'dismissed', callId: p.call_id });

    // Someone in a call is ringing me into it.
    const onInvited = (p: { call_id: string; channel_id: string; from_user_id: number; from_user_name?: string }) => {
      if (isMyCall(p.call_id)) return;
      dispatch({
        type: 'incoming',
        call: {
          callId: p.call_id,
          channelId: p.channel_id,
          channelName: '',
          channelType: 'private',
          fromId: Number(p.from_user_id),
          fromName: p.from_user_name || 'Someone',
          invited: true,
          at: Date.now(),
        },
      });
    };
    const onInvitePending = (p: { call_id: string; user_id: number; user_name?: string }) => {
      if (!isMyCall(p.call_id)) return;
      const who = Number(p.user_id);
      setInvites((list) =>
        list.some((i) => i.userId === who) ? list : [...list, { userId: who, userName: p.user_name || 'Someone' }],
      );
    };
    // A ring is over: nobody answered, it was refused, or it was taken back.
    const onInviteEnded = (p: { call_id: string; user_id: number }) => {
      const who = Number(p.user_id);
      if (who === userId) dispatch({ type: 'dismissed', callId: p.call_id });
      if (isMyCall(p.call_id)) setInvites((list) => list.filter((i) => i.userId !== who));
    };
    // The person I was ringing is in a call and brought me into it.
    const onMerge = (p: { join_call_id: string; channel_id: string }) => {
      if (!p.join_call_id || isMyCall(p.join_call_id)) return;
      void joinDirect(p.join_call_id, p.channel_id, { switching: true });
    };

    // The host rearranged, opened or closed the breakout groups.
    const onBreakout = (p: { call_id: string; active: boolean; groups: Breakout['groups'] }) => {
      if (isMyCall(p.call_id))
        setBreakout({ active: p.active === true, groups: Array.isArray(p.groups) ? p.groups : [] });
    };

    // Recording started or stopped: everyone in the call is told.
    const onRecording = (p: { call_id: string; on: boolean; by: number }) => {
      if (isMyCall(p.call_id)) setRecording(p.on ? { by: Number(p.by), since: Date.now() } : null);
    };

    // Someone drew on the whiteboard, took a stroke back, or the host wiped it.
    const onBoard = (p: { call_id: string; from_user_id: number | null; op: BoardOp }) => {
      if (isMyCall(p.call_id)) whiteboard.applyRemote(p.op, p.from_user_id == null ? null : Number(p.from_user_id));
    };

    const onReaction = (p: { call_id: string; from_user_id: number; emoji: string }) => {
      if (isMyCall(p.call_id) && typeof p.emoji === 'string') showReaction(Number(p.from_user_id), p.emoji);
    };
    const onHand = (p: { call_id: string; user_id: number; up: boolean }) => {
      if (!isMyCall(p.call_id)) return;
      const who = Number(p.user_id);
      setHands((list) => (p.up ? (list.includes(who) ? list : [...list, who]) : list.filter((id) => id !== who)));
    };
    const onHostChanged = (p: { call_id: string; host_user_id: number }) =>
      dispatch({ type: 'host', callId: p.call_id, hostId: Number(p.host_user_id) });

    // The host muted me. I can unmute myself; the host cannot.
    const onMutedByHost = (p: { call_id: string; by_user_name?: string }) => {
      if (!isMyCall(p.call_id)) return;
      manager.current!.setMuted(true);
      setPanelNote(`${p.by_user_name || 'The host'} muted you. You can unmute yourself.`);
    };

    // The host removed me. Every tab of mine learns it, so Join becomes "Ask to join" everywhere.
    const onRemoved = (p: { call_id: string }) => {
      dispatch({ type: 'removed', callId: p.call_id });
      if (isMyCall(p.call_id) || callId.current === p.call_id) dropOut('The host removed you from the call');
    };

    const onJoinRequest = (p: { call_id: string; user_id: number; user_name?: string }) => {
      if (!isMyCall(p.call_id)) return;
      setJoinRequests((list) =>
        addJoinRequest(list, { userId: Number(p.user_id), userName: p.user_name || 'Someone' }),
      );
    };

    const onJoinRequestCancelled = (p: { call_id: string; user_id: number }) => {
      if (isMyCall(p.call_id)) setJoinRequests((list) => dropJoinRequest(list, Number(p.user_id)));
    };

    // The host answered my request to come back.
    const onJoinAnswer = (p: { call_id: string; channel_id: string; accepted: boolean; reason?: string }) => {
      const waitingHere = ui.current.asking?.callId === p.call_id;
      if (p.accepted) {
        dispatch({ type: 'ask_done', callId: p.call_id, allowed: true });
        if (waitingHere && ui.current.phase === 'idle') void joinDirect(p.call_id, p.channel_id);
        return;
      }
      const notice =
        p.reason === 'host_left'
          ? 'The host left the call, so nobody can let you back in'
          : 'The host did not let you back in';
      dispatch({ type: 'ask_done', callId: p.call_id, allowed: false, notice });
    };

    const onShare = (on: boolean) => (p: { call_id: string; user_id: number }) => {
      const sharerId = Number(p.user_id);
      if (isMyCall(p.call_id) && sharerId !== userId) manager.current!.setRemoteSharing(sharerId, on);
    };

    const onSignal = (p: { call_id: string; from_user_id: number; signal_data: any }) => {
      const fromId = Number(p.from_user_id);
      if (isMyCall(p.call_id)) manager.current!.handleSignal(fromId, p.signal_data);
      else if (startInFlight()) hold(p.call_id, () => manager.current?.handleSignal(fromId, p.signal_data));
    };

    // A reconnect gives this tab a new connection id: re-join so the call follows it (the server waits 10 s).
    const onConnect = () => {
      const current = manager.current;
      const id = callId.current;
      const socketId = socket.id;
      if (!current || !id || ui.current.phase !== 'in-call' || !socketId || socketId === joinedSocket.current) return;
      rejoining.current = true;
      expectOwnJoin.current++;
      current
        .rejoin(async () => {
          const answer = await callApi.join(id, socketId);
          return { participants: answer.participants, iceServers: answer.iceServers };
        })
        .then(() => {
          if (manager.current === current) joinedSocket.current = socketId;
        })
        .catch(() => {
          if (manager.current === current) dropOut('The call ended while you were disconnected');
        })
        .finally(() => {
          rejoining.current = false;
        });
    };

    const handlers: Array<[string, (...args: any[]) => void]> = [
      ['call_started', onStarted],
      ['call_participant_joined', onJoined],
      ['call_participant_left', onLeft],
      ['call_ended', onEnded],
      ['call_dismissed', onDismissed],
      ['call_invited', onInvited],
      ['call_invite_pending', onInvitePending],
      ['call_invite_ended', onInviteEnded],
      ['call_merge', onMerge],
      ['call_bo_state', onBreakout],
      ['call_rec_changed', onRecording],
      ['call_wb', onBoard],
      ['call_reaction', onReaction],
      ['call_hand_changed', onHand],
      ['call_host_changed', onHostChanged],
      ['call_muted_by_host', onMutedByHost],
      ['call_removed', onRemoved],
      ['call_join_request', onJoinRequest],
      ['call_join_request_cancelled', onJoinRequestCancelled],
      ['call_join_answer', onJoinAnswer],
      ['call_screen_share_started', onShare(true)],
      ['call_screen_share_stopped', onShare(false)],
      ['webrtc_signal', onSignal],
      ['connect', onConnect],
    ];
    for (const [event, handler] of handlers) socket.on(event, handler);
    return () => {
      for (const [event, handler] of handlers) socket.off(event, handler);
    };
  }, [
    socket,
    callApi,
    userId,
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
  ]);
}
