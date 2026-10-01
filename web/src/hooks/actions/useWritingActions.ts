import { useCallback, useRef, type MutableRefObject } from 'react';
import type { SendOpts } from '../../services/chatApi.ts';
import type { Message } from '../../types/index.ts';
import type { ActionDeps } from './actionDeps.ts';

const TYPING_EVERY_MS = 3000; // tell the others "typing" at most this often

type Deps = ActionDeps & {
  currentChannelRef: MutableRefObject<string | null>;
  loadPins: (channelId: string) => Promise<void>;
};

/** Actions that change messages: send, upload, edit, delete, pin, react, and the "typing" signal. */
export function useWritingActions({ chatApi, socket, user, dispatch, stateRef, currentChannelRef, loadPins }: Deps) {
  /** A message this person just posted: show it and clear the "replying to" bar. */
  const showOwnMessage = useCallback(
    (message: Message) => {
      dispatch({ type: 'message_added', message, currentChannelId: currentChannelRef.current, selfId: user.id });
      dispatch({ type: 'set_reply_target', message: null });
    },
    [dispatch, currentChannelRef, user.id],
  );

  const send = useCallback(
    async (channelId: string, content: string, opts: SendOpts = {}) => {
      showOwnMessage(await chatApi.sendMessage(channelId, content, opts));
    },
    [chatApi, showOwnMessage],
  );

  const upload = useCallback(
    async (
      channelId: string,
      files: File[],
      content: string,
      replyToId: string | null = null,
      threadId: string | null = null,
    ) => {
      showOwnMessage(await chatApi.uploadFiles(channelId, files, content, { replyToId, threadId }));
    },
    [chatApi, showOwnMessage],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      const message = await chatApi.editMessage(messageId, content);
      dispatch({
        type: 'message_edited',
        channelId: message.channelId,
        messageId,
        content: message.content,
        editedAt: message.editedAt,
      });
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

  return { send, upload, edit, remove, pin, unpin, react, typing, reply };
}
