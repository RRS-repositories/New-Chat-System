import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { Action } from '../context/chatReducer.ts';

type Deps = {
  socket: Socket;
  dispatch: Dispatch<Action>;
  /** Is the person looking at the chat right now (tab visible and focused)? */
  looking: boolean;
  lookingRef: MutableRefObject<boolean>;
  /** The channel on screen. */
  currentChannelRef: MutableRefObject<string | null>;
};

/**
 * Marks channels read — but only while someone is actually looking. A channel that is open in a
 * tab nobody is looking at stays unread; it is marked read when they look again.
 */
export function useReadTracking({ socket, dispatch, looking, lookingRef, currentChannelRef }: Deps) {
  const pendingRead = useRef<string | null>(null);

  const markRead = useCallback(
    (channelId: string) => {
      dispatch({ type: 'read', channelId });
      socket.emit('mark_read', { channel_id: channelId });
    },
    [dispatch, socket],
  );

  const markReadIfLooking = useCallback(
    (channelId: string) => {
      if (lookingRef.current) {
        pendingRead.current = null;
        markRead(channelId);
      } else {
        pendingRead.current = channelId;
      }
    },
    [markRead, lookingRef],
  );

  useEffect(() => {
    if (!looking) return;
    const channelId = pendingRead.current;
    pendingRead.current = null;
    if (channelId && channelId === currentChannelRef.current) markRead(channelId);
  }, [looking, markRead, currentChannelRef]);

  return { markRead, markReadIfLooking, pendingRead };
}
