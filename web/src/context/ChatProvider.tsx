import { useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { useAttention } from '../hooks/useAttention.ts';
import { useChatActions } from '../hooks/useChatActions.ts';
import { useChatSocketEvents } from '../hooks/useChatSocketEvents.ts';
import { useLatest } from '../hooks/useLatest.ts';
import { usePresence } from '../hooks/usePresence.ts';
import { useReadTracking } from '../hooks/useReadTracking.ts';
import type { ApiClient } from '../services/apiClient.ts';
import { createChatApi } from '../services/chatApi.ts';
import { restorePush } from '../services/push.ts';
import type { ChatUser } from '../types/index.ts';
import { ChatContext, type ChatContextValue } from './chatContext.ts';
import { chatReducer, initialState } from './chatReducer.ts';

type Props = {
  api: ApiClient;
  socket: Socket;
  user: ChatUser;
  getToken: () => string | null;
  currentChannelId: string | null;
  setCurrentChannelId: (channelId: string | null) => void;
  onAuthError?: () => void;
  children: ReactNode;
};

/**
 * Holds everything the chat screens share: channels, messages, presence and preferences, kept up
 * to date by the live connection, plus the actions screens use to change them.
 */
export function ChatProvider({
  api,
  socket,
  user,
  getToken,
  currentChannelId,
  setCurrentChannelId,
  onAuthError,
  children,
}: Props) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const stateRef = useLatest(state);
  const currentChannelRef = useLatest(currentChannelId);
  const channelsRef = useLatest(state.channels);
  const prefsRef = useLatest(state.prefs);
  const chatApi = useMemo(() => createChatApi({ api, getToken, onAuthError }), [api, getToken, onAuthError]);

  const { looking, lookingRef, notLookingSince } = useAttention();
  usePresence({ chatApi, socket, dispatch, looking, notLookingSince });
  useEffect(() => {
    void restorePush(api);
  }, [api]);

  const { markRead, markReadIfLooking, pendingRead } = useReadTracking({
    socket,
    dispatch,
    looking,
    lookingRef,
    currentChannelRef,
  });
  const { actions, loadChannels, fetchNewest, loadPins } = useChatActions({
    chatApi,
    socket,
    user,
    dispatch,
    stateRef,
    currentChannelRef,
    setCurrentChannelId,
    markRead,
    markReadIfLooking,
  });
  useChatSocketEvents({
    socket,
    chatApi,
    dispatch,
    user,
    onAuthError,
    loadChannels,
    fetchNewest,
    loadPins,
    lookingRef,
    currentChannelRef,
    channelsRef,
    prefsRef,
    pendingRead,
  });

  const value = useMemo<ChatContextValue>(
    () => ({ state, user, api, actions, currentChannelId, setCurrentChannelId }),
    [state, user, api, actions, currentChannelId, setCurrentChannelId],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
