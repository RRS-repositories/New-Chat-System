import { useCallback } from 'react';
import { ApiError } from '../../services/apiClient.ts';
import type { NewChannel } from '../../services/chatApi.ts';
import type { Channel, ChannelNotifyPref } from '../../types/index.ts';
import type { ActionDeps } from './actionDeps.ts';

/** Actions on channels: listing, creating, joining, members and the per-channel notification level. */
export function useChannelActions({ chatApi, socket, user, dispatch, stateRef }: ActionDeps) {
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

  /** Adds a channel the person has just created, opened or joined, and starts listening to it. */
  const addChannel = useCallback(
    (channel: Channel) => {
      dispatch({ type: 'channel_upsert', channel });
      socket.emit('join_channel', { channel_id: channel.id });
      return channel;
    },
    [dispatch, socket],
  );

  const createChannel = useCallback(
    async (input: NewChannel) => addChannel(await chatApi.createChannel(input)),
    [chatApi, addChannel],
  );
  const openDm = useCallback(async (userId: number) => addChannel(await chatApi.openDm(userId)), [chatApi, addChannel]);
  const joinChannel = useCallback(
    async (channelId: string) => addChannel(await chatApi.joinChannel(channelId)),
    [chatApi, addChannel],
  );
  const browseChannels = useCallback(() => chatApi.browseChannels(), [chatApi]);

  const loadMembers = useCallback(
    async (channelId: string) => {
      dispatch({ type: 'members_loaded', channelId, members: await chatApi.members(channelId) });
    },
    [chatApi, dispatch],
  );

  const addMembers = useCallback(
    async (channelId: string, userIds: number[]) => {
      await chatApi.addMembers(channelId, userIds);
      await loadMembers(channelId);
    },
    [chatApi, loadMembers],
  );

  const setFavourite = useCallback(
    async (channelId: string, on: boolean) => {
      dispatch({ type: 'channel_favourite', channelId, on });
      try {
        await chatApi.setFavourite(channelId, on);
      } catch (e) {
        dispatch({ type: 'channel_favourite', channelId, on: !on });
        throw e;
      }
    },
    [chatApi, dispatch],
  );

  const markUnread = useCallback(
    async (channelId: string) => {
      const { unreadCount } = await chatApi.markUnread(channelId);
      dispatch({ type: 'unread_set', channelId, unreadCount, mentionCount: 0 });
    },
    [chatApi, dispatch],
  );

  /** Shown at once; put back and rethrown if the server refuses. */
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

  const renameChannel = useCallback(
    async (channelId: string, change: { displayName?: string; purpose?: string }) => {
      dispatch({ type: 'channel_upsert', channel: await chatApi.updateChannel(channelId, change) });
    },
    [chatApi, dispatch],
  );

  /** The channel goes from this person's list at once; the server tells the others. */
  const leaveChannel = useCallback(
    async (channelId: string) => {
      await chatApi.leaveChannel(channelId, user.id);
      dispatch({ type: 'channel_removed', channelId });
    },
    [chatApi, dispatch, user.id],
  );

  const archiveChannel = useCallback(
    async (channelId: string) => {
      await chatApi.archiveChannel(channelId);
      dispatch({ type: 'channel_removed', channelId });
    },
    [chatApi, dispatch],
  );

  /** Management or IT: the channel and everything in it, gone for good. */
  const deleteChannel = useCallback(
    async (channelId: string) => {
      await chatApi.deleteChannel(channelId);
      dispatch({ type: 'channel_removed', channelId });
    },
    [chatApi, dispatch],
  );

  return {
    loadChannels,
    createChannel,
    openDm,
    joinChannel,
    browseChannels,
    loadMembers,
    addMembers,
    setFavourite,
    markUnread,
    setChannelNotify,
    renameChannel,
    leaveChannel,
    archiveChannel,
    deleteChannel,
  };
}
