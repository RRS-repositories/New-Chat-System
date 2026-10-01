import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChatActions } from '../context/chatContext.ts';
import type { Action, State } from '../context/chatReducer.ts';
import { ApiError } from '../services/apiClient.ts';
import type { ChatApi, NewChannel, PreferencePatch, SendOpts } from '../services/chatApi.ts';
import type { Channel, ChannelNotifyPref, ChatUser, Message, Preferences } from '../types/index.ts';
import { createBlobCache } from '../utils/blobCache.ts';
import { withSelfSorted } from '../utils/restrictions.ts';

const TYPING_EVERY_MS = 3000; // tell the others "typing" at most this often
const THUMBNAIL_CACHE_SIZE = 300;

type Deps = {
  chatApi: ChatApi;
  socket: Socket;
  user: ChatUser;
  dispatch: Dispatch<Action>;
  stateRef: MutableRefObject<State>;
  currentChannelRef: MutableRefObject<string | null>;
  setCurrentChannelId: (channelId: string | null) => void;
  markRead: (channelId: string) => void;
  markReadIfLooking: (channelId: string) => void;
};

/**
 * Builds the actions screens call. Each one talks to the server through `chatApi` and records the
 * result in the shared state. Also returns the three loaders the live-event handler needs.
 */
export function useChatActions(deps: Deps) {
  const { chatApi, socket, user, dispatch, stateRef, currentChannelRef, setCurrentChannelId, markRead, markReadIfLooking } = deps;

  // ── Channels ──────────────────────────────────────────────────────────────

  // Someone not switched on for chat is refused on every call: show the "not enabled" screen
  // instead of treating it as a sign-in problem.
  const loadChannels = useCallback(async () => {
    try {
      dispatch({ type: 'channels_loaded', channels: await chatApi.channels() });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'chat_not_enabled') dispatch({ type: 'not_enabled' });
      else throw e;
    }
  }, [chatApi, dispatch]);

  /** Adds a channel the person has just created, opened or joined, and listens to it. */
  const addChannel = useCallback(
    (channel: Channel) => {
      dispatch({ type: 'channel_upsert', channel });
      socket.emit('join_channel', { channel_id: channel.id });
      return channel;
    },
    [dispatch, socket],
  );
  const createChannel = useCallback(async (input: NewChannel) => addChannel(await chatApi.createChannel(input)), [chatApi, addChannel]);
  const openDm = useCallback(async (userId: number) => addChannel(await chatApi.openDm(userId)), [chatApi, addChannel]);
  const joinChannel = useCallback(async (channelId: string) => addChannel(await chatApi.joinChannel(channelId)), [chatApi, addChannel]);
  const browseChannels = useCallback(() => chatApi.browseChannels(), [chatApi]);

  const loadMembers = useCallback(
    async (channelId: string) => dispatch({ type: 'members_loaded', channelId, members: await chatApi.members(channelId) }),
    [chatApi, dispatch],
  );

  const setChannelNotify = useCallback(
    async (channelId: string, pref: ChannelNotifyPref) => {
      const before = stateRef.current.channels.find((c) => c.id === channelId)?.notifyPref ?? 'default';
      dispatch({ type: 'channel_notify', channelId, pref });
      try {
        await chatApi.setChannelNotify(channelId, pref);
      } catch (e) {
        dispatch({ type: 'channel_notify', channelId, pref: before });
        throw e;
      }
    },
    [chatApi, dispatch, stateRef],
  );

  // ── Reading messages ──────────────────────────────────────────────────────

  const fetchNewest = useCallback(
    async (channelId: string) => {
      const page = await chatApi.newestMessages(channelId);
      dispatch({ type: 'messages_loaded', channelId, messages: page.messages, nextCursor: page.nextCursor, prepend: false });
    },
    [chatApi, dispatch],
  );

  // Set by jumpTo just before the address changes, so the openChannel that the address change
  // triggers does not replace the window around the message with the newest page.
  const jumpedTo = useRef<string | null>(null);

  const openChannel = useCallback(
    async (channelId: string) => {
      setCurrentChannelId(channelId);
      if (jumpedTo.current === channelId) {
        jumpedTo.current = null;
        markReadIfLooking(channelId);
        return;
      }
      const bucket = stateRef.current.messagesByChannel[channelId];
      if (!bucket?.loaded || bucket.windowed) {
        if (bucket?.windowed) dispatch({ type: 'bucket_unload', channelId });
        await fetchNewest(channelId);
      }
      markReadIfLooking(channelId);
    },
    [fetchNewest, markReadIfLooking, setCurrentChannelId, dispatch, stateRef],
  );

  const loadLatest = useCallback(
    async (channelId: string) => {
      dispatch({ type: 'bucket_unload', channelId });
      await fetchNewest(channelId);
    },
    [fetchNewest, dispatch],
  );

  const loadOlder = useCallback(
    async (channelId: string) => {
      const cursor = stateRef.current.messagesByChannel[channelId]?.nextCursor;
      if (!cursor) return;
      const page = await chatApi.olderMessages(channelId, cursor);
      dispatch({ type: 'messages_loaded', channelId, messages: page.messages, nextCursor: page.nextCursor, prepend: true });
    },
    [chatApi, dispatch, stateRef],
  );

  const jumpTo = useCallback(
    async (channelId: string, messageId: string) => {
      jumpedTo.current = channelId;
      try {
        const page = await chatApi.messagesAround(channelId, messageId);
        dispatch({ type: 'bucket_unload', channelId });
        dispatch({ type: 'messages_loaded', channelId, messages: page.messages, nextCursor: page.nextCursor, prepend: false, windowed: true });
        setCurrentChannelId(channelId);
        dispatch({ type: 'highlight', messageId });
      } catch (e) {
        jumpedTo.current = null;
        throw e;
      }
    },
    [chatApi, dispatch, setCurrentChannelId],
  );

  const openThread = useCallback(
    async (rootId: string) => {
      const thread = await chatApi.thread(rootId);
      dispatch({ type: 'thread_loaded', rootId, root: thread.root, replies: thread.replies });
    },
    [chatApi, dispatch],
  );

  const loadPins = useCallback(
    async (channelId: string) => dispatch({ type: 'pins_loaded', channelId, pins: await chatApi.pins(channelId) }),
    [chatApi, dispatch],
  );

  // ── Writing messages ──────────────────────────────────────────────────────

  /** A message this person just posted: show it and clear the "replying to" bar. */
  const showOwnMessage = useCallback(
    (message: Message) => {
      dispatch({ type: 'message_added', message, currentChannelId: currentChannelRef.current, selfId: user.id });
      dispatch({ type: 'set_reply_target', message: null });
    },
    [dispatch, currentChannelRef, user.id],
  );

  const send = useCallback(
    async (channelId: string, content: string, opts: SendOpts = {}) => showOwnMessage(await chatApi.sendMessage(channelId, content, opts)),
    [chatApi, showOwnMessage],
  );

  const upload = useCallback(
    async (channelId: string, files: File[], content: string, replyToId: string | null = null, threadId: string | null = null) =>
      showOwnMessage(await chatApi.uploadFiles(channelId, files, content, { replyToId, threadId })),
    [chatApi, showOwnMessage],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      const message = await chatApi.editMessage(messageId, content);
      dispatch({ type: 'message_edited', channelId: message.channelId, messageId, content: message.content, editedAt: message.editedAt });
    },
    [chatApi, dispatch],
  );

  /** Looks a message up in everything currently loaded (channel pages and open threads). */
  const findMessage = useCallback(
    (messageId: string): Message | undefined => {
      const { messagesByChannel, threads } = stateRef.current;
      const inChannels = Object.values(messagesByChannel).flatMap((bucket) => bucket.items);
      const inThreads = Object.values(threads).flatMap((thread) => [thread.root, ...thread.replies]);
      return inChannels.concat(inThreads).find((m) => m.id === messageId);
    },
    [stateRef],
  );

  const remove = useCallback(
    async (messageId: string) => {
      const found = findMessage(messageId);
      await chatApi.deleteMessage(messageId);
      if (found) dispatch({ type: 'message_deleted', channelId: found.channelId, messageId });
    },
    [chatApi, dispatch, findMessage],
  );

  const pin = useCallback(
    async (messageId: string) => {
      const message = await chatApi.pin(messageId);
      dispatch({ type: 'message_pinned', channelId: message.channelId, messageId, pinnedBy: user.id });
      void loadPins(message.channelId);
    },
    [chatApi, dispatch, user.id, loadPins],
  );

  const unpin = useCallback(
    async (messageId: string) => {
      const message = await chatApi.unpin(messageId);
      dispatch({ type: 'message_unpinned', channelId: message.channelId, messageId });
    },
    [chatApi, dispatch],
  );

  /** Adds the reaction, or takes it away if this person already gave it. */
  const react = useCallback(
    async (messageId: string, emoji: string) => {
      const found = findMessage(messageId);
      const alreadyMine = found?.reactions.find((r) => r.emoji === emoji)?.userIds.includes(user.id);
      if (alreadyMine) await chatApi.removeReaction(messageId, emoji);
      else await chatApi.addReaction(messageId, emoji);
      if (!found) return;
      const type = alreadyMine ? 'reaction_removed' : 'reaction_added';
      dispatch({ type, channelId: found.channelId, messageId, emoji, userId: user.id });
    },
    [chatApi, dispatch, user.id, findMessage],
  );

  const lastTyping = useRef(0);
  const typing = useCallback(
    (channelId: string) => {
      const now = Date.now();
      if (now - lastTyping.current < TYPING_EVERY_MS) return;
      lastTyping.current = now;
      socket.emit('typing', { channel_id: channelId });
    },
    [socket],
  );

  const reply = useCallback((message: Message | null) => dispatch({ type: 'set_reply_target', message }), [dispatch]);
  const highlight = useCallback((messageId: string) => dispatch({ type: 'highlight', messageId }), [dispatch]);
  const clearHighlight = useCallback(() => dispatch({ type: 'highlight', messageId: null }), [dispatch]);

  // ── Files and search ──────────────────────────────────────────────────────

  const thumbnails = useRef(createBlobCache(THUMBNAIL_CACHE_SIZE));
  const fetchBlob = useCallback(
    async (path: string) => {
      const cacheable = path.endsWith('/thumb');
      const cached = cacheable ? thumbnails.current.get(path) : undefined;
      if (cached) return cached;
      const url = URL.createObjectURL(await chatApi.fileBlob(path));
      if (cacheable) thumbnails.current.set(path, url);
      return url;
    },
    [chatApi],
  );
  const loadChannelFiles = useCallback((channelId: string, before: string | null = null) => chatApi.channelFiles(channelId, before), [chatApi]);
  const search = useCallback((query: string, channelId: string | null = null, page = 1) => chatApi.search(query, channelId, page), [chatApi]);

  // ── People, preferences, admin ────────────────────────────────────────────

  const listUsers = useCallback(() => chatApi.users(), [chatApi]);
  const allUsers = useCallback(
    async () => withSelfSorted(await chatApi.users(), { id: user.id, fullName: user.fullName, role: user.role }),
    [chatApi, user.id, user.fullName, user.role],
  );

  const updatePrefs = useCallback(
    async (patch: PreferencePatch) => {
      const before = stateRef.current.prefs;
      dispatch({ type: 'prefs_set', prefs: { ...before, ...patch } });
      try {
        const saved = await chatApi.updatePreferences(patch);
        dispatch({ type: 'prefs_set', prefs: { ...stateRef.current.prefs, ...saved } });
      } catch (e) {
        const undo = Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof Preferences]]));
        dispatch({ type: 'prefs_set', prefs: { ...stateRef.current.prefs, ...undo } });
        throw e;
      }
    },
    [chatApi, dispatch, stateRef],
  );

  const setStatus = useCallback(
    async (text: string, emoji: string) => {
      const status = (await chatApi.setStatus(text, emoji)) || { text, emoji };
      dispatch({ type: 'prefs_set', prefs: { ...stateRef.current.prefs, statusText: status.text, statusEmoji: status.emoji } });
      dispatch({ type: 'user_status', userId: user.id, text: status.text, emoji: status.emoji });
    },
    [chatApi, dispatch, stateRef, user.id],
  );

  const actions = useMemo<ChatActions>(
    () => ({
      loadChannels,
      openChannel,
      loadOlder,
      loadLatest,
      send,
      edit,
      remove,
      createChannel,
      openDm,
      browseChannels,
      joinChannel,
      typing,
      markRead,
      reply,
      openThread,
      loadPins,
      loadMembers,
      pin,
      unpin,
      react,
      upload,
      search,
      jumpTo,
      clearHighlight,
      highlight,
      loadChannelFiles,
      fetchBlob,
      listUsers,
      allUsers,
      listRestrictions: chatApi.restrictions,
      addRestriction: chatApi.addRestriction,
      removeRestriction: chatApi.removeRestriction,
      adminUsers: chatApi.adminUsers,
      userRestrictions: chatApi.restrictionsForUser,
      setAccess: chatApi.setAccess,
      updatePrefs,
      setStatus,
      setChannelNotify,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatApi, loadChannels, openChannel, loadOlder, loadLatest, send, edit, remove, createChannel, openDm, browseChannels, joinChannel, typing, markRead, reply, openThread, loadPins, loadMembers, pin, unpin, react, upload, search, jumpTo, clearHighlight, highlight, loadChannelFiles, fetchBlob, listUsers, allUsers, updatePrefs, setStatus, setChannelNotify],
  );

  return { actions, loadChannels, fetchNewest, loadPins };
}
