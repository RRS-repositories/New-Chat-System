import { ApiError } from '../services/apiClient.ts';
import { CallError } from '../services/callManager.ts';

const SERVER_MESSAGES: Record<string, string> = {
  call_in_progress: 'A call is already in progress in this channel',
  call_full: 'This call is full',
  restricted: 'You cannot call this person',
  call_ended: 'This call has ended',
  not_found: 'This call has ended',
  bad_socket: 'Not connected — try again in a moment',
  not_host: 'Only the person who started the call can do that',
  no_request: 'That person is no longer waiting',
};

/** What to tell the person when starting or joining a call fails. */
export function callErrorText(error: unknown): string {
  if (error instanceof CallError) return error.message;
  if (error instanceof ApiError) return SERVER_MESSAGES[error.code] ?? error.message;
  return (error as any)?.message || 'Could not join the call';
}
