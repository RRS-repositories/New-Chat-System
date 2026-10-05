import { createContext, useContext } from 'react';
import type { CallSnapshot } from '../services/callManager.ts';
import type { JoinRequest } from '../types/index.ts';
import type { CallUiState } from './callState.ts';

/** A live call in a channel, as far as this tab knows (from the server's answer and the call events). */
/** One reaction floating up the call screen. */
export type CallReaction = { id: number; userId: number; emoji: string };

export type ActiveCall = { callId: string; participantIds: number[] };

export type CallContextValue = {
  call: CallUiState;
  /** Who is in this tab's call, and whether this person is muted or sharing. */
  snapshot: CallSnapshot;
  activeByChannel: Record<string, ActiveCall>;
  /** This tab is joining or in a call. */
  busy: boolean;
  /** Something in the call panel failed (sharing, or a host action). */
  panelError: string | null;
  /** A short note in the call panel, e.g. "the host muted you". */
  panelNote: string | null;
  /** This person started the call and is in it: they can mute and remove others. */
  isHost: boolean;
  /** Host only: people the host removed who are asking to come back. */
  joinRequests: JoinRequest[];
  /** People in the call with a hand raised. */
  hands: number[];
  /** Reactions on their way up the screen. Each is removed when its animation ends. */
  reactions: CallReaction[];
  startCall: (channelId: string) => Promise<void>;
  joinCall: (callId: string, channelId: string) => Promise<void>;
  declineCall: (callId: string) => void;
  leaveCall: () => void;
  toggleMute: () => void;
  toggleShare: () => Promise<void>;
  /** Raise or lower this person's hand. */
  toggleHand: () => void;
  sendReaction: (emoji: string) => void;
  dismissReaction: (id: number) => void;
  /** Host only. Muting cannot be undone by the host: the person unmutes themselves. */
  muteParticipant: (userId: number) => Promise<void>;
  removeParticipant: (userId: number) => Promise<void>;
  answerJoinRequest: (userId: number, accept: boolean) => Promise<void>;
  /** Stop waiting for the host to let this person back in. */
  cancelAsk: () => void;
  clearMessages: () => void;
};

export const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const value = useContext(CallContext);
  if (!value) throw new Error('useCall must be used inside <CallProvider>');
  return value;
}
