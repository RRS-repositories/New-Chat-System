import { useMemo, type MutableRefObject } from 'react';
import type { ChatActions } from '../context/chatContext.ts';
import type { ActionDeps } from './actions/actionDeps.ts';
import { useChannelActions } from './actions/useChannelActions.ts';
import { usePeopleActions } from './actions/usePeopleActions.ts';
import { useReadingActions } from './actions/useReadingActions.ts';
import { useWritingActions } from './actions/useWritingActions.ts';

type Deps = ActionDeps & {
  currentChannelRef: MutableRefObject<string | null>;
  setCurrentChannelId: (channelId: string | null) => void;
  markRead: (channelId: string) => void;
  markReadIfLooking: (channelId: string) => void;
};

/**
 * Gathers every action a screen can call into one object. Each group lives in its own file under
 * `hooks/actions/`. Also returns the three loaders the live-event handler needs.
 */
export function useChatActions(deps: Deps) {
  const { chatApi, markRead, markReadIfLooking, setCurrentChannelId, currentChannelRef } = deps;
  const channels = useChannelActions(deps);
  const reading = useReadingActions({ ...deps, setCurrentChannelId, markReadIfLooking });
  const { fetchNewest, ...readingActions } = reading;
  const writing = useWritingActions({ ...deps, currentChannelRef, loadPins: reading.loadPins });
  const people = usePeopleActions(deps);

  const actions = useMemo<ChatActions>(
    () => ({
      ...channels,
      ...readingActions,
      ...writing,
      ...people,
      markRead,
      // Admin (Management only): passed straight through to the server.
      listRestrictions: chatApi.restrictions,
      addRestriction: chatApi.addRestriction,
      removeRestriction: chatApi.removeRestriction,
      adminUsers: chatApi.adminUsers,
      userRestrictions: chatApi.restrictionsForUser,
      setAccess: chatApi.setAccess,
    }),
    // Every action is a stable callback; list them so the object only changes when one of them does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      chatApi,
      markRead,
      ...Object.values(channels),
      ...Object.values(readingActions),
      ...Object.values(writing),
      ...Object.values(people),
    ],
  );

  return { actions, loadChannels: channels.loadChannels, fetchNewest, loadPins: reading.loadPins };
}
