import { useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { useAttention } from '../hooks/useAttention.ts';
import { useChatActions } from '../hooks/useChatActions.ts';
import { useChatSocketEvents } from '../hooks/useChatSocketEvents.ts';
import { useLatest } from '../hooks/useLatest.ts';
import { usePresence } from '../hooks/usePresence.ts';
import { useReadTracking } from '../hooks/useReadTracking.ts';
import type { ApiClient } from '../services/apiClient.ts';
import { createChatApi } from '../services/chatApi.ts';
import { avatarStore } from '../services/avatars.ts';
import { restorePush } from '../services/push.ts';
import { paths } from '../config/routes.ts';
import type { ChatUser } from '../types/index.ts';
import { ChatContext, type ChatContextValue } from './chatContext.ts';
import { chatReducer, initialState } from './chatReducer.ts';
import { useToast } from './ToastProvider.tsx';

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
  // Profile photos need the sign-in token to fetch; they are let go of on sign-out.
  useEffect(() => {
    avatarStore.configure(chatApi.fileBlob);
    return () => {
      avatarStore.configure(null);
      avatarStore.reset();
    };
  }, [chatApi]);

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
  // A message elsewhere while the chat is being looked at: a toast with "Open" (the desktop
  // notification is for when it is not being looked at).
  const toast = useToast();
  const navigate = useNavigate();
  const onNotice = useLatest(
    ({
      message,
      title,
      body,
    }: {
      message: { channelId: string; userName: string; userId: number };
      title: string;
      body: string;
    }) => {
      toast({
        avatar: { name: message.userName || '?', userId: message.userId },
        text: <b>{title}</b>,
        detail: body,
        ms: 5200,
        actions: [{ label: 'Open', kind: 'ok', onClick: () => navigate(paths.channel(message.channelId)) }],
      });
    },
  );
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
    onNotice,
  });

  const value = useMemo<ChatContextValue>(
    () => ({ state, user, api, actions, currentChannelId, setCurrentChannelId }),
    [state, user, api, actions, currentChannelId, setCurrentChannelId],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
