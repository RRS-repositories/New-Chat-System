/** Call state of this tab (pure). One call at a time per tab. */
export type CallPhase = 'idle' | 'ringing-in' | 'joining' | 'in-call';
export type IncomingCall = { callId: string; channelId: string; channelName: string; channelType: 'public' | 'private' | 'dm' | 'group_dm'; fromId: number; fromName: string };
export type EndStatus = 'ended' | 'missed' | 'declined';
export type CallUiState = {
  phase: CallPhase;
  /** The call this tab is joining or in. */
  callId: string | null; channelId: string | null;
  incoming: IncomingCall | null;
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
  | { type: 'joined'; callId: string; channelId: string }
  | { type: 'failed'; error: string }
  | { type: 'left'; notice?: string | null }
  | { type: 'error'; error: string | null }
  | { type: 'notice'; notice: string | null };

export const initialCallState: CallUiState = { phase: 'idle', callId: null, channelId: null, incoming: null, error: null, notice: null };
const idle = (s: CallUiState, extra: Partial<CallUiState> = {}): CallUiState => ({ ...s, phase: 'idle', callId: null, channelId: null, incoming: null, ...extra });
const END_NOTICE: Record<EndStatus, string> = { ended: 'Call ended', missed: 'No answer', declined: 'Call declined' };

export function callReducer(s: CallUiState, a: CallAction): CallUiState {
  switch (a.type) {
    case 'incoming':
      return s.phase === 'idle' ? { ...s, phase: 'ringing-in', incoming: a.call } : s;
    case 'dismissed':
      return s.phase === 'ringing-in' && s.incoming?.callId === a.callId ? idle(s) : s;
    case 'ended':
      if (s.phase === 'ringing-in' && s.incoming?.callId === a.callId) return idle(s);
      if ((s.phase === 'in-call' || s.phase === 'joining') && s.callId === a.callId) return idle(s, { notice: END_NOTICE[a.status] || 'Call ended' });
      return s;
    case 'join_begin':
      return { ...s, phase: 'joining', callId: a.callId, channelId: a.channelId, incoming: null, error: null, notice: null };
    case 'joined':
      return { ...s, phase: 'in-call', callId: a.callId, channelId: a.channelId, incoming: null, error: null };
    case 'failed':
      return idle(s, { error: a.error });
    case 'left':
      return idle(s, { notice: a.notice ?? null });
    case 'error':
      return { ...s, error: a.error };
    case 'notice':
      return { ...s, notice: a.notice };
    default:
      return s;
  }
}
