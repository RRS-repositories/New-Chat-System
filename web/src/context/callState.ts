/** Call state of this tab (pure). One call at a time per tab. */
export type CallPhase = 'idle' | 'ringing-in' | 'joining' | 'in-call';
export type IncomingCall = {
  callId: string;
  channelId: string;
  channelName: string;
  channelType: 'public' | 'private' | 'dm' | 'group_dm';
  fromId: number;
  fromName: string;
};
export type EndStatus = 'ended' | 'missed' | 'declined';
export type CallUiState = {
  phase: CallPhase;
  /** The call this tab is joining or in. */
  callId: string | null;
  channelId: string | null;
  /** Who started the call this tab is in. Only that person can mute or remove others. */
  hostId: number | null;
  incoming: IncomingCall | null;
  /** Calls the host removed this person from: joining them again means asking the host first. */
  removedFrom: string[];
  /** The call this tab has asked to be let back into, while waiting for the host's answer. */
  asking: { callId: string; channelId: string } | null;
  /** Why the last attempt failed (shown inline). */
  error: string | null;
  /** A quiet one-line note after the call ends. */
  notice: string | null;
};
export type CallAction =
  | { type: 'incoming'; call: IncomingCall }
  | { type: 'dismissed'; callId: string }
  | { type: 'ended'; callId: string; status: EndStatus }
  | { type: 'join_begin'; callId: string | null; channelId: string }
  | { type: 'joined'; callId: string; channelId: string; hostId?: number | null }
  | { type: 'failed'; error: string }
  | { type: 'left'; notice?: string | null }
  | { type: 'removed'; callId: string }
  | { type: 'asking'; callId: string; channelId: string }
  | { type: 'ask_done'; callId: string; allowed: boolean; notice?: string | null; error?: string | null }
  | { type: 'error'; error: string | null }
  | { type: 'notice'; notice: string | null };

export const initialCallState: CallUiState = {
  phase: 'idle',
  callId: null,
  channelId: null,
  hostId: null,
  incoming: null,
  removedFrom: [],
  asking: null,
  error: null,
  notice: null,
};
const idle = (s: CallUiState, extra: Partial<CallUiState> = {}): CallUiState => ({
  ...s,
  phase: 'idle',
  callId: null,
  channelId: null,
  hostId: null,
  incoming: null,
  ...extra,
});
const END_NOTICE: Record<EndStatus, string> = { ended: 'Call ended', missed: 'No answer', declined: 'Call declined' };

/** A call that is over: nothing to wait for and nothing to remember about it. */
function forgetCall(s: CallUiState, callId: string): CallUiState {
  const waiting = s.asking?.callId === callId;
  if (!waiting && !s.removedFrom.includes(callId)) return s;
  return { ...s, asking: waiting ? null : s.asking, removedFrom: s.removedFrom.filter((id) => id !== callId) };
}

export function callReducer(state: CallUiState, a: CallAction): CallUiState {
  switch (a.type) {
    case 'incoming':
      return state.phase === 'idle' ? { ...state, phase: 'ringing-in', incoming: a.call } : state;
    case 'dismissed':
      return state.phase === 'ringing-in' && state.incoming?.callId === a.callId ? idle(state) : state;
    case 'ended': {
      const s = forgetCall(state, a.callId);
      if (s.phase === 'ringing-in' && s.incoming?.callId === a.callId) return idle(s);
      if ((s.phase === 'in-call' || s.phase === 'joining') && s.callId === a.callId)
        return idle(s, { notice: END_NOTICE[a.status] || 'Call ended' });
      return s;
    }
    case 'join_begin':
      return {
        ...state,
        phase: 'joining',
        callId: a.callId,
        channelId: a.channelId,
        hostId: null,
        incoming: null,
        asking: null,
        error: null,
        notice: null,
      };
    case 'joined':
      return {
        ...state,
        phase: 'in-call',
        callId: a.callId,
        channelId: a.channelId,
        hostId: a.hostId ?? null,
        incoming: null,
        error: null,
      };
    case 'failed':
      return idle(state, { error: a.error });
    case 'left':
      return idle(state, { notice: a.notice ?? null });
    case 'removed':
      return state.removedFrom.includes(a.callId) ? state : { ...state, removedFrom: [...state.removedFrom, a.callId] };
    case 'asking':
      return { ...state, asking: { callId: a.callId, channelId: a.channelId }, error: null, notice: null };
    case 'ask_done': {
      const waitingForIt = state.asking?.callId === a.callId;
      const removedFrom = a.allowed ? state.removedFrom.filter((id) => id !== a.callId) : state.removedFrom;
      if (!waitingForIt) return removedFrom === state.removedFrom ? state : { ...state, removedFrom };
      return { ...state, asking: null, removedFrom, notice: a.notice ?? state.notice, error: a.error ?? state.error };
    }
    case 'error':
      return { ...state, error: a.error };
    case 'notice':
      return { ...state, notice: a.notice };
    default:
      return state;
  }
}
