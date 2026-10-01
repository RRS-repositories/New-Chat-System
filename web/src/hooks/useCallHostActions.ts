import { useCallback, useState, type MutableRefObject } from 'react';
import { ApiError } from '../services/apiClient.ts';
import type { CallApi } from '../services/callApi.ts';
import type { JoinRequest } from '../types/index.ts';
import { callErrorText } from '../utils/callErrors.ts';
import { dropJoinRequest } from '../utils/joinRequests.ts';

type Deps = {
  callApi: CallApi;
  /** The call this tab is in. */
  callId: MutableRefObject<string | null>;
  /** Shows a refusal in the call panel. */
  setPanelError: (message: string | null) => void;
};

/**
 * What the host of a call can do: mute someone, remove someone, and answer the people asking to
 * come back. The server decides who the host is; these only send the request and show a refusal.
 */
export function useCallHostActions({ callApi, callId, setPanelError }: Deps) {
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);

  /** Runs one host action on this tab's call; a refusal is shown in the call panel. */
  const asHost = useCallback(
    async (run: (id: string) => Promise<unknown>, onRefused?: (code: string) => void) => {
      const id = callId.current;
      if (!id) return;
      setPanelError(null);
      try {
        await run(id);
      } catch (e) {
        if (callId.current !== id) return;
        if (e instanceof ApiError) onRefused?.(e.code);
        setPanelError(callErrorText(e));
      }
    },
    [callId, setPanelError],
  );

  const muteParticipant = useCallback(
    (userId: number) => asHost((id) => callApi.hostMute(id, userId)),
    [asHost, callApi],
  );

  const removeParticipant = useCallback(
    (userId: number) => asHost((id) => callApi.hostRemove(id, userId)),
    [asHost, callApi],
  );

  const answerJoinRequest = useCallback(
    (userId: number, accept: boolean) => {
      const answered = () => setJoinRequests((list) => dropJoinRequest(list, userId));
      return asHost(
        async (id) => {
          await callApi.answerJoinRequest(id, userId, accept);
          answered();
        },
        (code) => {
          if (code === 'no_request') answered(); // they stopped waiting in the meantime
        },
      );
    },
    [asHost, callApi],
  );

  return { joinRequests, setJoinRequests, muteParticipant, removeParticipant, answerJoinRequest };
}
