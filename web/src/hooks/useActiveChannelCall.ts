import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { ActiveCall } from '../context/callContext.ts';
import type { CallApi } from '../services/callApi.ts';

type SetChannelCall = (channelId: string, update: (prev: ActiveCall | undefined) => ActiveCall | null) => void;

/** Asks the server whether the open channel has a live call (for the "Call in progress — Join" banner), again on every reconnect. */
export function useActiveChannelCall(deps: {
  callApi: CallApi;
  socket: Socket;
  channelId: string | null;
  setChannelCall: SetChannelCall;
}): void {
  const { callApi, socket, channelId, setChannelCall } = deps;
  useEffect(() => {
    if (!channelId) return;
    let live = true;
    const load = () =>
      callApi
        .active(channelId)
        .then((r) => {
          if (!live) return;
          const participantIds = (r.participants || []).map((p) => p.userId);
          setChannelCall(channelId, () => (r.call ? { callId: r.call.id, participantIds } : null));
        })
        .catch(() => {});
    void load();
    socket.on('connect', load);
    return () => {
      live = false;
      socket.off('connect', load);
    };
  }, [callApi, socket, channelId, setChannelCall]);
}
