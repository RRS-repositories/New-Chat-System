/** Call state of this tab (pure). One call at a time per tab. */
export type CallPhase = 'idle' | 'ringing-in' | 'joining' | 'in-call';
export type IncomingCall = {
  callId: string;
  channelId: string;
  channelName: string;
  channelType: 'public' | 'private' | 'dm' | 'group_dm';
  fromId: number;
  fromName: string;
  /** Rung into a call by someone in it (not a call starting in one of this person's channels). */
  invited?: boolean;
  /** When the ring began (milliseconds), for the countdown. */
  at?: number;
};
export type EndStatus = 'ended' | 'missed' | 'declined';
export type CallUiState = {
  phase: CallPhase;
  /** The call this tab is joining or in. */
  callId: string | null;
  channelId: string | null;
  /** The host of the call this tab is in: only they can mute or remove others. */
  hostId: number | null;
  /** When the call began (milliseconds), for the timer. */
  since: number | null;
  incoming: IncomingCall | null;
  /** A call ringing in while this tab is already in a call (call waiting). */
  waiting: IncomingCall | null;
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
  | { type: 'joined'; callId: string; channelId: string; hostId?: number | null; since?: number | null }
  | { type: 'host'; callId: string; hostId: number }
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
  since: null,
  incoming: null,
  waiting: null,
  removedFrom: [],
  asking: null,
  error: null,
  notice: null,
};
// Out of any call. A call that was waiting behind the one just left now rings in the ordinary way.
const idle = (s: CallUiState, extra: Partial<CallUiState> = {}): CallUiState => ({
  ...s,
  phase: s.waiting ? 'ringing-in' : 'idle',
  callId: null,
  channelId: null,
  hostId: null,
  since: null,
  incoming: s.waiting,
  waiting: null,
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
      if (state.phase === 'idle') return { ...state, phase: 'ringing-in', incoming: a.call };
      // Already in a call (and not this one): it waits, shown as a card over the call.
      if (state.phase !== 'ringing-in' && !state.waiting && state.callId !== a.call.callId)
        return { ...state, waiting: a.call };
      return state;
    case 'dismissed':
      if (state.waiting?.callId === a.callId) return { ...state, waiting: null };
      return state.phase === 'ringing-in' && state.incoming?.callId === a.callId ? idle(state) : state;
    case 'ended': {
      let s = forgetCall(state, a.callId);
      if (s.waiting?.callId === a.callId) s = { ...s, waiting: null };
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
        since: null,
        incoming: null,
        waiting: state.waiting?.callId === a.callId ? null : state.waiting,
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
        since: a.since ?? Date.now(),
        incoming: null,
        error: null,
      };
    case 'host':
      return state.callId === a.callId && state.hostId !== a.hostId ? { ...state, hostId: a.hostId } : state;
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
