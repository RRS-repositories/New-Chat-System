import { useEffect, type Dispatch, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { ActiveCall } from '../context/callContext.ts';
import type { CallAction, CallUiState, EndStatus, IncomingCall } from '../context/callState.ts';
import type { CallApi } from '../services/callApi.ts';
import type { CallManager } from '../services/callManager.ts';

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
      if (isMyCall(p.call_id)) manager.current!.addParticipant(joinerId, p.user_name || '');
      else if (startInFlight()) hold(p.call_id, () => manager.current?.addParticipant(joinerId, p.user_name || ''));
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
      ['call_screen_share_started', onShare(true)],
      ['call_screen_share_stopped', onShare(false)],
      ['webrtc_signal', onSignal],
      ['connect', onConnect],
    ];
    for (const [event, handler] of handlers) socket.on(event, handler);
    return () => {
      for (const [event, handler] of handlers) socket.off(event, handler);
    };
  }, [socket, callApi, userId, session, dispatch, teardown, setChannelCall]);
}
