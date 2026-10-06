import { createContext, useContext } from 'react';
import type { ApiClient } from '../services/apiClient.ts';
import type { FilePage, NewChannel, PreferencePatch, SearchPage, SendOpts } from '../services/chatApi.ts';
import type {
  AccessChange,
  AdminUser,
  BrowseChannel,
  Channel,
  ChannelNotifyPref,
  ChatUser,
  Message,
  Restriction,
  RestrictionInput,
  UserOption,
} from '../types/index.ts';
import type { State } from './chatReducer.ts';

/** Everything a screen can ask the chat to do. Screens never call the server themselves. */
export type ChatActions = {
  loadChannels: () => Promise<void>;
  openChannel: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  /** In a window into older history: the next newer page. */
  loadNewer: (channelId: string) => Promise<void>;
  /** Let go of the oldest messages of a channel that has grown past the cap. */
  trimChannel: (channelId: string) => void;
  loadLatest: (channelId: string) => Promise<void>;
  send: (channelId: string, content: string, opts?: SendOpts) => Promise<void>;
  edit: (messageId: string, content: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  createChannel: (input: NewChannel) => Promise<Channel>;
  openDm: (userId: number) => Promise<Channel>;
  browseChannels: () => Promise<BrowseChannel[]>;
  joinChannel: (channelId: string) => Promise<Channel>;
  renameChannel: (channelId: string, change: { displayName?: string; purpose?: string }) => Promise<void>;
  /** Adds people to a channel (anyone in it may). */
  addMembers: (channelId: string, userIds: number[]) => Promise<void>;
  leaveChannel: (channelId: string) => Promise<void>;
  /** Hides the channel for everyone; its messages are kept. */
  archiveChannel: (channelId: string) => Promise<void>;
  typing: (channelId: string) => void;
  markRead: (channelId: string) => void;
  reply: (message: Message | null) => void;
  openThread: (rootId: string) => Promise<void>;
  loadPins: (channelId: string) => Promise<void>;
  loadMembers: (channelId: string) => Promise<void>;
  pin: (messageId: string) => Promise<void>;
  unpin: (messageId: string) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  upload: (
    channelId: string,
    files: File[],
    content: string,
    replyToId?: string | null,
    threadId?: string | null,
  ) => Promise<void>;
  search: (query: string, channelId?: string | null, page?: number) => Promise<SearchPage>;
  jumpTo: (channelId: string, messageId: string) => Promise<void>;
  clearHighlight: () => void;
  highlight: (messageId: string) => void;
  loadChannelFiles: (channelId: string, before?: string | null) => Promise<FilePage>;
  /** A browser URL for a file or thumbnail. Thumbnails are cached; anything else the caller releases. */
  fetchBlob: (path: string) => Promise<string>;
  /** The people the signed-in person can pick from (never includes themselves). */
  listUsers: () => Promise<UserOption[]>;
  /** The same list with the signed-in person added back, sorted by name (admin pickers). */
  allUsers: () => Promise<UserOption[]>;
  listRestrictions: () => Promise<Restriction[]>;
  addRestriction: (input: RestrictionInput) => Promise<Restriction[]>;
  removeRestriction: (restrictionId: string) => Promise<void>;
  adminUsers: (deactivated?: boolean) => Promise<AdminUser[]>;
  /** Management: switch a person off (signed out everywhere, no sign-in until switched on) or on again. */
  deactivateUser: (userId: number) => Promise<void>;
  reactivateUser: (userId: number) => Promise<void>;
  userRestrictions: (userId: number) => Promise<Restriction[]>;
  setAccess: (userId: number, change: AccessChange) => Promise<Restriction[]>;
  /** Management or IT: set a person's password. Resolves to the CRM's message. */
  setUserPassword: (userId: number, password: string, confirmPassword: string) => Promise<string>;
  /** Shown at once; the changed settings are put back and the error rethrown if the server refuses. */
  updatePrefs: (patch: PreferencePatch) => Promise<void>;
  setStatus: (text: string, emoji: string) => Promise<void>;
  /** Saves a picture (already cut square and shrunk) as the signed-in person's profile photo. */
  setProfilePhoto: (picture: Blob) => Promise<void>;
  removeProfilePhoto: () => Promise<void>;
  /** Star or unstar a conversation for yourself (shown at once; put back on failure). */
  setFavourite: (channelId: string, on: boolean) => Promise<void>;
  /** Mark a conversation unread again (the newest message from someone else). */
  markUnread: (channelId: string) => Promise<void>;
  /** Shown at once; put back and rethrown on failure. */
  setChannelNotify: (channelId: string, pref: ChannelNotifyPref) => Promise<void>;
};

export type ChatContextValue = {
  state: State;
  user: ChatUser;
  api: ApiClient;
  actions: ChatActions;
  currentChannelId: string | null;
  setCurrentChannelId: (channelId: string | null) => void;
};

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat must be used inside <ChatProvider>');
  return value;
}
