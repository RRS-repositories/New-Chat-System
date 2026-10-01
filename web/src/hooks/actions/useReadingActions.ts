import { useCallback, useRef, type MutableRefObject } from 'react';
import { createBlobCache } from '../../utils/blobCache.ts';
import type { ActionDeps } from './actionDeps.ts';

const THUMBNAIL_CACHE_SIZE = 300;

type Deps = ActionDeps & {
  setCurrentChannelId: (channelId: string | null) => void;
  markReadIfLooking: (channelId: string) => void;
};

/** Actions that load things to read: a channel's messages, older pages, a thread, pins, files and search. */
export function useReadingActions({ chatApi, dispatch, stateRef, setCurrentChannelId, markReadIfLooking }: Deps) {
  const fetchNewest = useCallback(
    async (channelId: string) => {
      const page = await chatApi.newestMessages(channelId);
      dispatch({
        type: 'messages_loaded',
        channelId,
        messages: page.messages,
        nextCursor: page.nextCursor,
        prepend: false,
      });
    },
    [chatApi, dispatch],
  );

  // Set by jumpTo just before the address changes, so the openChannel that the address change
  // triggers does not replace the window around the message with the newest page.
  const jumpedTo: MutableRefObject<string | null> = useRef(null);

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
      dispatch({
        type: 'messages_loaded',
        channelId,
        messages: page.messages,
        nextCursor: page.nextCursor,
        prepend: true,
      });
    },
    [chatApi, dispatch, stateRef],
  );

  /** Shows the messages around one message (from search or a pin) and highlights it. */
  const jumpTo = useCallback(
    async (channelId: string, messageId: string) => {
      jumpedTo.current = channelId;
      try {
        const page = await chatApi.messagesAround(channelId, messageId);
        dispatch({ type: 'bucket_unload', channelId });
        dispatch({
          type: 'messages_loaded',
          channelId,
          messages: page.messages,
          nextCursor: page.nextCursor,
          prepend: false,
          windowed: true,
        });
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
    async (channelId: string) => {
      dispatch({ type: 'pins_loaded', channelId, pins: await chatApi.pins(channelId) });
    },
    [chatApi, dispatch],
  );

  const highlight = useCallback((messageId: string) => dispatch({ type: 'highlight', messageId }), [dispatch]);
  const clearHighlight = useCallback(() => dispatch({ type: 'highlight', messageId: null }), [dispatch]);

  const thumbnails = useRef(createBlobCache(THUMBNAIL_CACHE_SIZE));
  /** A browser URL for a file or thumbnail. Thumbnails are cached; anything else the caller releases. */
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

  const loadChannelFiles = useCallback(
    (channelId: string, before: string | null = null) => chatApi.channelFiles(channelId, before),
    [chatApi],
  );
  const search = useCallback(
    (query: string, channelId: string | null = null, page = 1) => chatApi.search(query, channelId, page),
    [chatApi],
  );

  return {
    fetchNewest,
    openChannel,
    loadLatest,
    loadOlder,
    jumpTo,
    openThread,
    loadPins,
    highlight,
    clearHighlight,
    fetchBlob,
    loadChannelFiles,
    search,
  };
}
