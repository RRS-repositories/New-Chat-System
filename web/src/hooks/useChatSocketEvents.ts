import { useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { Action } from '../context/chatReducer.ts';
import type { ChatApi } from '../services/chatApi.ts';
import type { Channel, ChatUser, Message, Preferences } from '../types/index.ts';
import { mentionsUser } from '../utils/mentions.ts';
import { notificationContent, shouldNotify, showDesktopNotification } from '../utils/notify.ts';
import { playNotify } from '../utils/sound.ts';

const READ_DELAY_MS = 800; // a message has to stay on screen this long before it counts as read
const TYPING_SHOWN_MS = 5000;
const TYPING_SWEEP_MS = 1000;

type Deps = {
  socket: Socket;
  chatApi: ChatApi;
  dispatch: Dispatch<Action>;
  user: ChatUser;
  onAuthError?: () => void;
  loadChannels: () => Promise<void>;
  fetchNewest: (channelId: string) => Promise<void>;
  loadPins: (channelId: string) => Promise<void>;
  lookingRef: MutableRefObject<boolean>;
  currentChannelRef: MutableRefObject<string | null>;
  channelsRef: MutableRefObject<Channel[]>;
  prefsRef: MutableRefObject<Preferences>;
  pendingRead: MutableRefObject<string | null>;
};

/** Listens to the live connection and turns each event into a state change (and, for new messages, a notification). */
export function useChatSocketEvents(deps: Deps): void {
  const { socket, chatApi, dispatch, user, onAuthError, loadChannels, fetchNewest, loadPins } = deps;
  const { lookingRef, currentChannelRef, channelsRef, prefsRef, pendingRead } = deps;
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // On (re)connect everything held may be stale: the open channel is refetched now, the others
    // when next opened, so nothing sent while offline is missed. A failed refetch is swallowed
    // (e.g. chat switched off, which loadChannels already turns into the not-enabled screen).
    const onConnect = () => {
      dispatch({ type: 'connected', value: true });
      dispatch({ type: 'stale_all' });
      void loadChannels();
      if (currentChannelRef.current) fetchNewest(currentChannelRef.current).catch(() => {});
      chatApi
        .preferences()
        .then((preferences) => {
          if (preferences) dispatch({ type: 'prefs_set', prefs: { ...prefsRef.current, ...preferences } });
        })
        .catch(() => {});
    };
    const onDisconnect = () => dispatch({ type: 'connected', value: false });

    // "Chat not enabled" is not a sign-in problem (the session is fine, the feature is off for this
    // person): show that screen and stop the connection retrying.
    const showNotEnabled = () => {
      dispatch({ type: 'not_enabled' });
      socket.disconnect();
    };
    const onConnectError = (error: Error) => {
      if (error.message === 'chat_not_enabled') showNotEnabled();
      else if (/^token_/.test(error.message)) onAuthError?.();
    };
    const onSessionEnded = (payload?: { reason?: string }) => {
      if (payload?.reason === 'chat_not_enabled') showNotEnabled();
      else onAuthError?.();
    };

    /** Someone else's message in the open channel: read after a short delay if still looking, else when they look again. */
    const scheduleRead = (message: Message, looking: boolean) => {
      if (!looking) {
        pendingRead.current = message.channelId;
        return;
      }
      if (message.threadId) return;
      if (readTimer.current) clearTimeout(readTimer.current);
      readTimer.current = setTimeout(() => {
        const channelId = currentChannelRef.current;
        if (!channelId) return;
        if (lookingRef.current) socket.emit('mark_read', { channel_id: channelId });
        else pendingRead.current = channelId;
      }, READ_DELAY_MS);
    };

    const onNewMessage = (payload: { message: Message }) => {
      const fromSomeoneElse = payload.message.userId !== user.id;
      const message: Message = {
        ...payload.message,
        mentionsMe: fromSomeoneElse && mentionsUser(payload.message.content, user.fullName),
      };
      const looking = lookingRef.current;
      const inOpenChannel = message.channelId === currentChannelRef.current;
      dispatch({
        type: 'message_added',
        message,
        currentChannelId: currentChannelRef.current,
        selfId: user.id,
        looking,
      });
      if (inOpenChannel && fromSomeoneElse) scheduleRead(message, looking);

      const channel = channelsRef.current.find((c) => c.id === message.channelId);
      const viewing = looking && inOpenChannel;
      if (!shouldNotify({ message, channel, prefs: prefsRef.current, me: user.id, viewing })) return;
      if (prefsRef.current.soundEnabled) playNotify();
      const { title, body } = notificationContent(message, channel);
      void showDesktopNotification(title, body, message.channelId);
    };

    const handlers: Array<[string, (...args: any[]) => void]> = [
      ['connect', onConnect],
      ['disconnect', onDisconnect],
      ['connect_error', onConnectError],
      ['session_ended', onSessionEnded],
      ['new_message', onNewMessage],
      [
        'message_edited',
        (p: { message_id: string; channel_id: string; content: string; edited_at: string | null }) =>
          dispatch({
            type: 'message_edited',
            channelId: p.channel_id,
            messageId: p.message_id,
            content: p.content,
            editedAt: p.edited_at,
          }),
      ],
      [
        'message_deleted',
        (p: { message_id: string; channel_id: string }) =>
          dispatch({ type: 'message_deleted', channelId: p.channel_id, messageId: p.message_id }),
      ],
      [
        'typing',
        (p: { channel_id: string; user_id: number; user_name: string }) =>
          dispatch({
            type: 'typing',
            channelId: p.channel_id,
            userId: p.user_id,
            name: p.user_name,
            until: Date.now() + TYPING_SHOWN_MS,
          }),
      ],
      ['channel_updated', () => void loadChannels()],
      [
        'member_added',
        (p: { channel_id: string }) => {
          socket.emit('join_channel', { channel_id: p.channel_id });
          void loadChannels();
        },
      ],
      [
        'member_removed',
        (p: { channel_id: string; user_id: number }) => {
          if (p.user_id === user.id) dispatch({ type: 'channel_removed', channelId: p.channel_id });
        },
      ],
      // Someone archived a channel this person is in: it leaves their list.
      [
        'channel_archived',
        (p: { channel_id: string }) => dispatch({ type: 'channel_removed', channelId: p.channel_id }),
      ],
      [
        'message_pinned',
        (p: { message_id: string; channel_id: string; pinned_by: number }) => {
          dispatch({ type: 'message_pinned', channelId: p.channel_id, messageId: p.message_id, pinnedBy: p.pinned_by });
          if (p.channel_id === currentChannelRef.current) void loadPins(p.channel_id);
        },
      ],
      [
        'message_unpinned',
        (p: { message_id: string; channel_id: string }) =>
          dispatch({ type: 'message_unpinned', channelId: p.channel_id, messageId: p.message_id }),
      ],
      [
        'reaction_added',
        (p: { message_id: string; channel_id: string; emoji: string; user_id: number }) =>
          dispatch({
            type: 'reaction_added',
            channelId: p.channel_id,
            messageId: p.message_id,
            emoji: p.emoji,
            userId: p.user_id,
          }),
      ],
      [
        'reaction_removed',
        (p: { message_id: string; channel_id: string; emoji: string; user_id: number }) =>
          dispatch({
            type: 'reaction_removed',
            channelId: p.channel_id,
            messageId: p.message_id,
            emoji: p.emoji,
            userId: p.user_id,
          }),
      ],
      ['unread_update', (p: { channel_id: string }) => dispatch({ type: 'read', channelId: p.channel_id })],
    ];

    for (const [event, handler] of handlers) socket.on(event, handler);
    const typingSweep = setInterval(() => dispatch({ type: 'typing_expire', now: Date.now() }), TYPING_SWEEP_MS);
    if (socket.connected) onConnect();

    return () => {
      clearInterval(typingSweep);
      if (readTimer.current) clearTimeout(readTimer.current);
      for (const [event, handler] of handlers) socket.off(event, handler);
    };
  }, [
    socket,
    chatApi,
    dispatch,
    loadChannels,
    fetchNewest,
    loadPins,
    user.id,
    user.fullName,
    onAuthError,
    lookingRef,
    currentChannelRef,
    channelsRef,
    prefsRef,
    pendingRead,
  ]);
}
