import { createContext, useContext } from 'react';
import type { CallSnapshot } from '../services/callManager.ts';
import type { CallUiState } from './callState.ts';

/** A live call in a channel, as far as this tab knows (from the server's answer and the call events). */
export type ActiveCall = { callId: string; participantIds: number[] };

export type CallContextValue = {
  call: CallUiState;
  /** Who is in this tab's call, and whether this person is muted or sharing. */
  snapshot: CallSnapshot;
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

export const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const value = useContext(CallContext);
  if (!value) throw new Error('useCall must be used inside <CallProvider>');
  return value;
}
