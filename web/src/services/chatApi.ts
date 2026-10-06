// Every call the web app makes to the chat server, in one place. No state lives here.
import type { ApiClient } from './apiClient.ts';
import type {
  AccessChange,
  AdminUser,
  BrowseChannel,
  Channel,
  ChannelFileRow,
  ChannelMember,
  ChannelNotifyPref,
  Message,
  Preferences,
  PresenceSnapshot,
  Restriction,
  RestrictionInput,
  SearchHit,
  UserOption,
  UserStatus,
} from '../types/index.ts';
import type { Theme } from '../utils/theme.ts';

/** `hasNewer`: newer messages exist beyond this page (a page asked for with `after`, or a window around a message). */
export type MessagePage = { messages: Message[]; nextCursor: string | null; hasNewer?: boolean };
export type SearchPage = { hits: SearchHit[]; page: number; hasMore: boolean };
export type FilePage = { files: ChannelFileRow[]; nextCursor: string | null };
export type NewChannel = {
  displayName: string;
  type: 'public' | 'private' | 'group_dm';
  purpose?: string;
  memberIds?: number[];
};
export type SendOpts = { replyToId?: string | null; threadId?: string | null };
export type PreferencePatch = Partial<
  Pick<Preferences, 'desktopNotif' | 'mobileNotif' | 'soundEnabled' | 'sendOnEnter'>
> & { theme?: Theme };

type Deps = { api: ApiClient; getToken: () => string | null; onAuthError?: () => void };

const PAGE_SIZE = 50;
const id = encodeURIComponent;

export function createChatApi({ api, getToken, onAuthError }: Deps) {
  /** Requests the JSON client cannot make (file upload, binary download) carry the token themselves. */
  const authHeader = () => ({ Authorization: `Bearer ${getToken() ?? ''}` });
  const signedOut = () => {
    onAuthError?.();
    return new Error('Not signed in');
  };

  return {
    // Channels
    channels: async () => (await api.get<{ channels: Channel[] }>('/api/chat/channels')).channels,
    createChannel: async (input: NewChannel) =>
      (await api.post<{ channel: Channel }>('/api/chat/channels', input)).channel,
    openDm: async (userId: number) =>
      (await api.post<{ channel: Channel }>('/api/chat/channels/dm', { userId })).channel,
    browseChannels: async () => (await api.get<{ channels: BrowseChannel[] }>('/api/chat/channels/browse')).channels,
    joinChannel: async (channelId: string) =>
      (await api.post<{ channel: Channel }>(`/api/chat/channels/${id(channelId)}/join`)).channel,
    /** Change the shown name and/or the purpose (channel owner or admin, or Management). */
    updateChannel: async (channelId: string, change: { displayName?: string; purpose?: string }) =>
      (await api.patch<{ channel: Channel }>(`/api/chat/channels/${channelId}`, change)).channel,
    /** Hide the channel for everyone; its messages are kept. */
    archiveChannel: (channelId: string) => api.post(`/api/chat/channels/${channelId}/archive`),
    addMembers: (channelId: string, userIds: number[]) =>
      api.post<{ added: number }>(`/api/chat/channels/${id(channelId)}/members`, { userIds }),
    leaveChannel: (channelId: string, userId: number) => api.del(`/api/chat/channels/${channelId}/members/${userId}`),
    members: async (channelId: string) =>
      (await api.get<{ members: ChannelMember[] }>(`/api/chat/channels/${channelId}`)).members,
    setFavourite: (channelId: string, on: boolean) =>
      api.patch<{ favourite: boolean }>(`/api/chat/channels/${id(channelId)}/favourite`, { on }),
    markUnread: (channelId: string) => api.post<{ unreadCount: number }>(`/api/chat/channels/${id(channelId)}/unread`),
    setChannelNotify: (channelId: string, pref: ChannelNotifyPref) =>
      api.patch(`/api/chat/channels/${id(channelId)}/notify`, { pref }),

    // Messages
    newestMessages: (channelId: string) =>
      api.get<MessagePage>(`/api/chat/channels/${channelId}/messages?limit=${PAGE_SIZE}`),
    olderMessages: (channelId: string, before: string) =>
      api.get<MessagePage>(`/api/chat/channels/${channelId}/messages?limit=${PAGE_SIZE}&before=${id(before)}`),
    newerMessages: (channelId: string, after: string) =>
      api.get<MessagePage>(`/api/chat/channels/${channelId}/messages?limit=${PAGE_SIZE}&after=${id(after)}`),
    messagesAround: (channelId: string, messageId: string) =>
      api.get<MessagePage>(`/api/chat/channels/${channelId}/messages?around=${messageId}`),
    sendMessage: async (channelId: string, content: string, opts: SendOpts = {}) =>
      (
        await api.post<{ message: Message }>(`/api/chat/channels/${channelId}/messages`, {
          content,
          replyToId: opts.replyToId ?? null,
          threadId: opts.threadId ?? null,
        })
      ).message,
    editMessage: async (messageId: string, content: string) =>
      (await api.patch<{ message: Message }>(`/api/chat/messages/${messageId}`, { content })).message,
    deleteMessage: (messageId: string) => api.del(`/api/chat/messages/${messageId}`),
    thread: (rootId: string) => api.get<{ root: Message; replies: Message[] }>(`/api/chat/messages/${rootId}/thread`),

    // Pins and reactions
    pins: async (channelId: string) =>
      (await api.get<{ pins: Message[] }>(`/api/chat/channels/${channelId}/pins`)).pins,
    pin: async (messageId: string) =>
      (await api.post<{ message: Message }>(`/api/chat/messages/${messageId}/pin`)).message,
    unpin: async (messageId: string) =>
      (await api.del<{ message: Message }>(`/api/chat/messages/${messageId}/pin`)).message,
    addReaction: (messageId: string, emoji: string) => api.post(`/api/chat/messages/${messageId}/reactions`, { emoji }),
    removeReaction: (messageId: string, emoji: string) =>
      api.del(`/api/chat/messages/${messageId}/reactions/${id(emoji)}`),

    // Files
    async uploadFiles(channelId: string, files: File[], content: string, opts: SendOpts = {}): Promise<Message> {
      const form = new FormData();
      for (const file of files) form.append('files', file, file.name);
      if (content.trim()) form.append('content', content);
      if (opts.replyToId) form.append('replyToId', opts.replyToId);
      if (opts.threadId) form.append('threadId', opts.threadId);
      const res = await fetch(`/api/chat/channels/${channelId}/upload`, {
        method: 'POST',
        headers: authHeader(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw signedOut();
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      return data.message;
    },
    channelFiles: (channelId: string, before: string | null = null) =>
      api.get<FilePage>(`/api/chat/channels/${channelId}/files${before ? `?before=${id(before)}` : ''}`),
    /** Downloads a file or thumbnail (they need the session token, so a plain link will not do). */
    async fileBlob(path: string): Promise<Blob> {
      const res = await fetch(path, { headers: authHeader() });
      if (res.status === 401) throw signedOut();
      if (!res.ok) throw new Error('Could not load file');
      return res.blob();
    },

    /** Saves a profile photo (already cut square and shrunk in the browser) and returns its address. */
    async uploadAvatar(picture: Blob): Promise<string> {
      const form = new FormData();
      form.append('file', picture, 'avatar.jpg');
      const res = await fetch('/api/chat/users/me/avatar', { method: 'POST', headers: authHeader(), body: form });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw signedOut();
      if (!res.ok) throw new Error(data.message || 'Could not save your photo');
      return data.avatarUrl;
    },
    removeAvatar: () => api.del('/api/chat/users/me/avatar'),

    // Search
    search: (query: string, channelId: string | null = null, page = 1) =>
      api.get<SearchPage>(`/api/chat/search?q=${id(query)}${channelId ? `&channelId=${channelId}` : ''}&page=${page}`),

    // People and preferences
    presence: () => api.get<PresenceSnapshot>('/api/chat/users/online'),
    users: async () => (await api.get<{ users: UserOption[] }>('/api/chat/users')).users,
    preferences: async () =>
      (await api.get<{ preferences: Preferences }>('/api/chat/users/me/preferences')).preferences,
    updatePreferences: async (patch: PreferencePatch) =>
      (await api.patch<{ preferences: Preferences }>('/api/chat/users/me/preferences', patch)).preferences,
    setStatus: async (text: string, emoji: string) =>
      (await api.patch<{ status: UserStatus }>('/api/chat/users/me/status', { statusText: text, statusEmoji: emoji }))
        .status,

    // Admin (Management only; the server refuses everyone else)
    /** Management or IT: set a person's password (the CRM does it). Resolves to the CRM's message. */
    setUserPassword: async (userId: number, password: string, confirmPassword: string) =>
      (await api.put<{ message: string }>(`/api/chat/admin/users/${userId}/password`, { password, confirmPassword }))
        .message,
    /** The admin people list; `gate` says whether the chat.beta permission is being enforced. */
    adminUsers: async (deactivated = false) => {
      const r = await api.get<{ users: AdminUser[]; gate?: boolean }>(
        `/api/chat/admin/users${deactivated ? '?deactivated=1' : ''}`,
      );
      return { users: r.users, gate: r.gate !== false };
    },
    /** Management: switch a person off (signed out everywhere, no sign-in until switched on) or on again. */
    deactivateUser: (userId: number) => api.post(`/api/chat/admin/users/${userId}/deactivate`),
    reactivateUser: (userId: number) => api.post(`/api/chat/admin/users/${userId}/reactivate`),
    restrictions: async () =>
      (await api.get<{ restrictions: Restriction[] }>('/api/chat/admin/restrictions')).restrictions,
    restrictionsForUser: async (userId: number) =>
      (await api.get<{ restrictions: Restriction[] }>(`/api/chat/admin/restrictions/user/${userId}`)).restrictions,
    addRestriction: async (input: RestrictionInput) =>
      (await api.post<{ restrictions: Restriction[] }>('/api/chat/admin/restrictions', input)).restrictions,
    removeRestriction: async (restrictionId: string) => {
      await api.del(`/api/chat/admin/restrictions/${id(restrictionId)}`);
    },
    setAccess: async (userId: number, change: AccessChange) =>
      (await api.put<{ restrictions: Restriction[] }>(`/api/chat/admin/users/${userId}/access`, change)).restrictions,
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;
