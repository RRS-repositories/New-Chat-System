import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { ApiError, type ApiClient } from '../services/apiClient.ts';
import type { BrowseChannel, Channel, ChannelFileRow, ChannelMember, ChannelNotifyPref, ChatUser, Message, Preferences, Restriction, RestrictionInput, SearchHit, UserOption, UserStatus, AdminUser, AccessChange } from '../types/index.ts';
import { withSelfSorted } from '../utils/restrictions.ts';
import { chatReducer, initialState, type State } from './chatReducer.ts';
import { mentionsUser } from '../utils/mentions.ts';
import { playNotify } from '../utils/sound.ts';
import { notificationContent, shouldNotify, showDesktopNotification } from '../utils/notify.ts';
import { restorePush } from '../services/push.ts';
import { useAttention } from '../hooks/useAttention.ts';
import { usePresence } from '../hooks/usePresence.ts';

export type SendOpts = { replyToId?: string | null; threadId?: string | null };
type Actions = {
  loadChannels: () => Promise<void>;
  openChannel: (id: string) => Promise<void>;
  loadOlder: (id: string) => Promise<void>;
  loadLatest: (id: string) => Promise<void>;
  send: (id: string, content: string, opts?: SendOpts) => Promise<void>;
  edit: (messageId: string, content: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  createChannel: (input: { displayName: string; type: 'public' | 'private' | 'group_dm'; purpose?: string; memberIds?: number[] }) => Promise<Channel>;
  openDm: (userId: number) => Promise<Channel>;
  browseChannels: () => Promise<BrowseChannel[]>;
  joinChannel: (id: string) => Promise<Channel>;
  typing: (id: string) => void;
  markRead: (id: string) => void;
  reply: (message: Message | null) => void;
  openThread: (rootId: string) => Promise<void>;
  loadPins: (channelId: string) => Promise<void>;
  loadMembers: (channelId: string) => Promise<void>;
  pin: (messageId: string) => Promise<void>;
  unpin: (messageId: string) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  upload: (channelId: string, files: File[], content: string, replyToId?: string | null, threadId?: string | null) => Promise<void>;
  search: (q: string, channelId?: string | null, page?: number) => Promise<{ hits: SearchHit[]; page: number; hasMore: boolean }>;
  jumpTo: (channelId: string, messageId: string) => Promise<void>;
  clearHighlight: () => void;
  highlight: (messageId: string) => void;
  loadChannelFiles: (channelId: string, before?: string | null) => Promise<{ files: ChannelFileRow[]; nextCursor: string | null }>;
  fetchBlob: (path: string) => Promise<string>;
  listRestrictions: () => Promise<Restriction[]>;
  addRestriction: (input: RestrictionInput) => Promise<Restriction[]>;
  removeRestriction: (id: string) => Promise<void>;
  allUsers: () => Promise<UserOption[]>;
  adminUsers: () => Promise<AdminUser[]>;
  userRestrictions: (userId: number) => Promise<Restriction[]>;
  setAccess: (userId: number, change: AccessChange) => Promise<Restriction[]>;
  /** Optimistic; rolls the changed keys back and rethrows when the server refuses. */
  updatePrefs: (patch: Partial<Pick<Preferences, 'desktopNotif' | 'mobileNotif' | 'soundEnabled' | 'sendOnEnter'>>) => Promise<void>;
  setStatus: (text: string, emoji: string) => Promise<void>;
  /** Optimistic per-channel level; rolls back and rethrows on failure. */
  setChannelNotify: (channelId: string, pref: ChannelNotifyPref) => Promise<void>;
};
type Ctx = { state: State; user: ChatUser; api: ApiClient; actions: Actions; currentChannelId: string | null; setCurrentChannelId: (id: string | null) => void };
const ChatContext = createContext<Ctx | null>(null);

type Props = {
  api: ApiClient; socket: Socket; user: ChatUser; getToken: () => string | null;
  currentChannelId: string | null; setCurrentChannelId: (id: string | null) => void; onAuthError?: () => void; children: ReactNode;
};

export function ChatProvider({ api, socket, user, getToken, currentChannelId, setCurrentChannelId, onAuthError, children }: Props) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const channelsRef = useRef(state.channels); channelsRef.current = state.channels;
  const prefsRef = useRef(state.prefs); prefsRef.current = state.prefs;
  const { looking, lookingRef, notLookingSince } = useAttention();
  usePresence({ api, socket, dispatch, looking, notLookingSince });
  useEffect(() => { void restorePush(api); }, [api]);
  const current = useRef<string | null>(currentChannelId); current.current = currentChannelId;
  const buckets = useRef(state.messagesByChannel); buckets.current = state.messagesByChannel;
  const threadsRef = useRef(state.threads); threadsRef.current = state.threads;

  // A user without chat access gets 403 chat_not_enabled on every call: show
  // the "not enabled" screen instead of treating it as a sign-in problem.
  const loadChannels = useCallback(async () => {
    try {
      const r = await api.get<{ channels: Channel[] }>('/api/chat/channels');
      dispatch({ type: 'channels_loaded', channels: r.channels });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'chat_not_enabled') { dispatch({ type: 'not_enabled' }); return; }
      throw e;
    }
  }, [api]);

  const fetchNewest = useCallback(async (id: string) => {
    const r = await api.get<{ messages: Message[]; nextCursor: string | null }>(`/api/chat/channels/${id}/messages?limit=50`);
    dispatch({ type: 'messages_loaded', channelId: id, messages: r.messages, nextCursor: r.nextCursor, prepend: false });
  }, [api]);

  const markRead = useCallback((id: string) => {
    dispatch({ type: 'read', channelId: id });
    socket.emit('mark_read', { channel_id: id });
  }, [socket]);
  // While nobody is looking (tab hidden or window unfocused) the open channel is not marked read; it is when they look again.
  const pendingRead = useRef<string | null>(null);
  const markReadIfLooking = useCallback((id: string) => {
    if (lookingRef.current) { pendingRead.current = null; markRead(id); } else pendingRead.current = id;
  }, [markRead, lookingRef]);
  useEffect(() => {
    if (!looking) return;
    const id = pendingRead.current; pendingRead.current = null;
    if (id && id === current.current) markRead(id);
  }, [looking, markRead]);

  // Set by jumpTo just before the route changes, so the openChannel that the
  // route change triggers does not race the jump window with the newest page.
  const jumpedTo = useRef<string | null>(null);
  const openChannel = useCallback(async (id: string) => {
    setCurrentChannelId(id);
    if (jumpedTo.current === id) { jumpedTo.current = null; markReadIfLooking(id); return; }
    const b = buckets.current[id];
    if (!b?.loaded || b.windowed) { if (b?.windowed) dispatch({ type: 'bucket_unload', channelId: id }); await fetchNewest(id); }
    markReadIfLooking(id);
  }, [fetchNewest, markReadIfLooking, setCurrentChannelId]);
  const loadLatest = useCallback(async (id: string) => {
    dispatch({ type: 'bucket_unload', channelId: id });
    await fetchNewest(id);
  }, [fetchNewest]);

  const loadOlder = useCallback(async (id: string) => {
    const cur = buckets.current[id]; if (!cur?.nextCursor) return;
    const r = await api.get<{ messages: Message[]; nextCursor: string | null }>(`/api/chat/channels/${id}/messages?limit=50&before=${encodeURIComponent(cur.nextCursor)}`);
    dispatch({ type: 'messages_loaded', channelId: id, messages: r.messages, nextCursor: r.nextCursor, prepend: true });
  }, [api]);

  const send = useCallback(async (id: string, content: string, opts: SendOpts = {}) => {
    const r = await api.post<{ message: Message }>(`/api/chat/channels/${id}/messages`, { content, replyToId: opts.replyToId ?? null, threadId: opts.threadId ?? null });
    dispatch({ type: 'message_added', message: r.message, currentChannelId: current.current, selfId: user.id });
    dispatch({ type: 'set_reply_target', message: null });
  }, [api, user.id]);

  const edit = useCallback(async (messageId: string, content: string) => {
    const r = await api.patch<{ message: Message }>(`/api/chat/messages/${messageId}`, { content });
    dispatch({ type: 'message_edited', channelId: r.message.channelId, messageId, content: r.message.content, editedAt: r.message.editedAt });
  }, [api]);

  const findMessage = useCallback((messageId: string): Message | undefined =>
    Object.values(buckets.current).flatMap((b) => b.items).concat(Object.values(threadsRef.current).flatMap((t) => [t.root, ...t.replies])).find((m) => m.id === messageId), []);

  const remove = useCallback(async (messageId: string) => {
    const found = findMessage(messageId);
    await api.del(`/api/chat/messages/${messageId}`);
    if (found) dispatch({ type: 'message_deleted', channelId: found.channelId, messageId });
  }, [api, findMessage]);

  const createChannel = useCallback(async (input: Parameters<Actions['createChannel']>[0]) => {
    const r = await api.post<{ channel: Channel }>('/api/chat/channels', input);
    dispatch({ type: 'channel_upsert', channel: r.channel });
    socket.emit('join_channel', { channel_id: r.channel.id });
    return r.channel;
  }, [api, socket]);

  const openDm = useCallback(async (userId: number) => {
    const r = await api.post<{ channel: Channel }>('/api/chat/channels/dm', { userId });
    dispatch({ type: 'channel_upsert', channel: r.channel });
    socket.emit('join_channel', { channel_id: r.channel.id });
    return r.channel;
  }, [api, socket]);

  const browseChannels = useCallback(async () => {
    const r = await api.get<{ channels: BrowseChannel[] }>('/api/chat/channels/browse');
    return r.channels;
  }, [api]);

  const joinChannel = useCallback(async (id: string) => {
    const r = await api.post<{ channel: Channel }>(`/api/chat/channels/${encodeURIComponent(id)}/join`);
    dispatch({ type: 'channel_upsert', channel: r.channel });
    socket.emit('join_channel', { channel_id: r.channel.id });
    return r.channel;
  }, [api, socket]);

  const lastTyping = useRef(0);
  const typing = useCallback((id: string) => {
    const now = Date.now(); if (now - lastTyping.current < 3000) return;
    lastTyping.current = now; socket.emit('typing', { channel_id: id });
  }, [socket]);

  const reply = useCallback((message: Message | null) => dispatch({ type: 'set_reply_target', message }), []);
  const openThread = useCallback(async (rootId: string) => {
    const r = await api.get<{ root: Message; replies: Message[] }>(`/api/chat/messages/${rootId}/thread`);
    dispatch({ type: 'thread_loaded', rootId, root: r.root, replies: r.replies });
  }, [api]);
  const loadPins = useCallback(async (channelId: string) => {
    const r = await api.get<{ pins: Message[] }>(`/api/chat/channels/${channelId}/pins`);
    dispatch({ type: 'pins_loaded', channelId, pins: r.pins });
  }, [api]);
  const loadMembers = useCallback(async (channelId: string) => {
    const r = await api.get<{ members: ChannelMember[] }>(`/api/chat/channels/${channelId}`);
    dispatch({ type: 'members_loaded', channelId, members: r.members });
  }, [api]);
  const pin = useCallback(async (messageId: string) => {
    const r = await api.post<{ message: Message }>(`/api/chat/messages/${messageId}/pin`);
    dispatch({ type: 'message_pinned', channelId: r.message.channelId, messageId, pinnedBy: user.id });
    void loadPins(r.message.channelId);
  }, [api, user.id, loadPins]);
  const unpin = useCallback(async (messageId: string) => {
    const r = await api.del<{ message: Message }>(`/api/chat/messages/${messageId}/pin`);
    dispatch({ type: 'message_unpinned', channelId: r.message.channelId, messageId });
  }, [api]);
  const react = useCallback(async (messageId: string, emoji: string) => {
    const found = findMessage(messageId);
    const mine = found?.reactions.find((r) => r.emoji === emoji)?.userIds.includes(user.id);
    if (mine) { await api.del(`/api/chat/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`); if (found) dispatch({ type: 'reaction_removed', channelId: found.channelId, messageId, emoji, userId: user.id }); }
    else { await api.post(`/api/chat/messages/${messageId}/reactions`, { emoji }); if (found) dispatch({ type: 'reaction_added', channelId: found.channelId, messageId, emoji, userId: user.id }); }
  }, [api, user.id, findMessage]);
  const upload = useCallback(async (channelId: string, files: File[], content: string, replyToId: string | null = null, threadId: string | null = null) => {
    const fd = new FormData(); for (const f of files) fd.append('files', f, f.name);
    if (content.trim()) fd.append('content', content); if (replyToId) fd.append('replyToId', replyToId); if (threadId) fd.append('threadId', threadId);
    const res = await fetch(`/api/chat/channels/${channelId}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${getToken() ?? ''}` }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { onAuthError?.(); throw new Error('Not signed in'); }
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    dispatch({ type: 'message_added', message: data.message, currentChannelId: current.current, selfId: user.id });
    dispatch({ type: 'set_reply_target', message: null });
  }, [getToken, user.id, onAuthError]);
  const search = useCallback((q: string, channelId: string | null = null, page = 1) =>
    api.get<{ hits: SearchHit[]; page: number; hasMore: boolean }>(`/api/chat/search?q=${encodeURIComponent(q)}${channelId ? `&channelId=${channelId}` : ''}&page=${page}`), [api]);
  const jumpTo = useCallback(async (channelId: string, messageId: string) => {
    jumpedTo.current = channelId;
    try {
      const r = await api.get<{ messages: Message[]; nextCursor: string | null }>(`/api/chat/channels/${channelId}/messages?around=${messageId}`);
      dispatch({ type: 'bucket_unload', channelId });
      dispatch({ type: 'messages_loaded', channelId, messages: r.messages, nextCursor: r.nextCursor, prepend: false, windowed: true });
      setCurrentChannelId(channelId); dispatch({ type: 'highlight', messageId });
    } catch (e) { jumpedTo.current = null; throw e; }
  }, [api, setCurrentChannelId]);
  const clearHighlight = useCallback(() => dispatch({ type: 'highlight', messageId: null }), []);
  const highlight = useCallback((messageId: string) => dispatch({ type: 'highlight', messageId }), []);
  const loadChannelFiles = useCallback((channelId: string, before: string | null = null) =>
    api.get<{ files: ChannelFileRow[]; nextCursor: string | null }>(`/api/chat/channels/${channelId}/files${before ? `?before=${encodeURIComponent(before)}` : ''}`), [api]);
  // Only thumbnails are cached (small, re-rendered often, capped); downloads,
  // full images and videos are returned fresh and the caller releases them.
  const THUMB_CACHE_MAX = 300;
  const blobCache = useRef(new Map<string, string>());
  const fetchBlob = useCallback(async (path: string) => {
    const cacheable = path.endsWith('/thumb');
    const hit = cacheable ? blobCache.current.get(path) : undefined; if (hit) return hit;
    const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
    if (res.status === 401) { onAuthError?.(); throw new Error('Not signed in'); }
    if (!res.ok) throw new Error('Could not load file');
    const url = URL.createObjectURL(await res.blob());
    if (cacheable) {
      if (blobCache.current.size >= THUMB_CACHE_MAX) { const [oldKey, oldUrl] = blobCache.current.entries().next().value as [string, string]; blobCache.current.delete(oldKey); URL.revokeObjectURL(oldUrl); }
      blobCache.current.set(path, url);
    }
    return url;
  }, [getToken, onAuthError]);

  // Management-only admin calls (the server answers 403 forbidden otherwise).
  const listRestrictions = useCallback(async () => (await api.get<{ restrictions: Restriction[] }>('/api/chat/admin/restrictions')).restrictions, [api]);
  const addRestriction = useCallback(async (input: RestrictionInput) => (await api.post<{ restrictions: Restriction[] }>('/api/chat/admin/restrictions', input)).restrictions, [api]);
  const adminUsers = useCallback(async () => (await api.get<{ users: AdminUser[] }>('/api/chat/admin/users')).users, [api]);
  const userRestrictions = useCallback(async (id: number) => (await api.get<{ restrictions: Restriction[] }>(`/api/chat/admin/restrictions/user/${id}`)).restrictions, [api]);
  const setAccess = useCallback(async (id: number, change: AccessChange) => (await api.put<{ restrictions: Restriction[] }>(`/api/chat/admin/users/${id}/access`, change)).restrictions, [api]);
  const removeRestriction = useCallback(async (id: string) => { await api.del(`/api/chat/admin/restrictions/${encodeURIComponent(id)}`); }, [api]);
  // GET /api/chat/users excludes the caller and anyone the caller is restricted
  // from; the admin pickers add the caller back (see the page footer).
  const updatePrefs = useCallback(async (patch: Parameters<Actions['updatePrefs']>[0]) => {
    const before = prefsRef.current;
    dispatch({ type: 'prefs_set', prefs: { ...before, ...patch } });
    try {
      const r = await api.patch<{ preferences: Preferences }>('/api/chat/users/me/preferences', patch);
      dispatch({ type: 'prefs_set', prefs: { ...prefsRef.current, ...r.preferences } });
    } catch (e) {
      const undo = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Preferences]]));
      dispatch({ type: 'prefs_set', prefs: { ...prefsRef.current, ...undo } });
      throw e;
    }
  }, [api]);
  const setStatus = useCallback(async (text: string, emoji: string) => {
    const r = await api.patch<{ status: UserStatus }>('/api/chat/users/me/status', { statusText: text, statusEmoji: emoji });
    const st = r.status || { text, emoji };
    dispatch({ type: 'prefs_set', prefs: { ...prefsRef.current, statusText: st.text, statusEmoji: st.emoji } });
    dispatch({ type: 'user_status', userId: user.id, text: st.text, emoji: st.emoji });
  }, [api, user.id]);
  const setChannelNotify = useCallback(async (channelId: string, pref: ChannelNotifyPref) => {
    const before = channelsRef.current.find((c) => c.id === channelId)?.notifyPref ?? 'default';
    dispatch({ type: 'channel_notify', channelId, pref });
    try { await api.patch(`/api/chat/channels/${encodeURIComponent(channelId)}/notify`, { pref }); }
    catch (e) { dispatch({ type: 'channel_notify', channelId, pref: before }); throw e; }
  }, [api]);
  const allUsers = useCallback(async () => withSelfSorted((await api.get<{ users: UserOption[] }>('/api/chat/users')).users, { id: user.id, fullName: user.fullName, role: user.role }), [api, user.id, user.fullName, user.role]);

  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // On (re)connect every bucket is stale: the open channel is refetched now,
    // the others when next opened, so nothing sent while offline is missed.
    // That refetch may fail (e.g. 403 chat_not_enabled, which loadChannels
    // already turns into the not-enabled screen): swallow it, not unhandled.
    const onConnect = () => {
      dispatch({ type: 'connected', value: true }); dispatch({ type: 'stale_all' }); void loadChannels(); if (current.current) fetchNewest(current.current).catch(() => {});
      // Preferences are optional: until the server has them, the defaults apply.
      api.get<{ preferences: Preferences }>('/api/chat/users/me/preferences').then((r) => { if (r?.preferences) dispatch({ type: 'prefs_set', prefs: { ...prefsRef.current, ...r.preferences } }); }).catch(() => {});
    };
    const onDisconnect = () => dispatch({ type: 'connected', value: false });
    // chat_not_enabled is not an auth error (the session is fine, the feature is
    // off for this user): show the screen and stop the socket retrying.
    const notEnabled = () => { dispatch({ type: 'not_enabled' }); socket.disconnect(); };
    const onConnectError = (e: Error) => { if (e.message === 'chat_not_enabled') notEnabled(); else if (/^token_/.test(e.message)) onAuthError?.(); };
    const onSessionEnded = (p?: { reason?: string }) => { if (p?.reason === 'chat_not_enabled') notEnabled(); else onAuthError?.(); };
    const onNew = (p: { message: Message }) => {
      const m: Message = { ...p.message, mentionsMe: p.message.userId !== user.id && mentionsUser(p.message.content, user.fullName) };
      const looking = lookingRef.current;
      dispatch({ type: 'message_added', message: m, currentChannelId: current.current, selfId: user.id, looking });
      if (m.channelId === current.current && m.userId !== user.id) {
        if (!looking) pendingRead.current = m.channelId;
        else if (!m.threadId) {
          if (readTimer.current) clearTimeout(readTimer.current);
          readTimer.current = setTimeout(() => {
            const id = current.current; if (!id) return;
            if (lookingRef.current) socket.emit('mark_read', { channel_id: id }); else pendingRead.current = id;
          }, 800);
        }
      }
      const channel = channelsRef.current.find((c) => c.id === m.channelId);
      const viewing = looking && m.channelId === current.current;
      if (shouldNotify({ message: m, channel, prefs: prefsRef.current, me: user.id, viewing })) {
        if (prefsRef.current.soundEnabled) playNotify();
        const { title, body } = notificationContent(m, channel);
        void showDesktopNotification(title, body, m.channelId);
      }
    };
    const onEdited = (p: { message_id: string; channel_id: string; content: string; edited_at: string | null }) => dispatch({ type: 'message_edited', channelId: p.channel_id, messageId: p.message_id, content: p.content, editedAt: p.edited_at });
    const onDeleted = (p: { message_id: string; channel_id: string }) => dispatch({ type: 'message_deleted', channelId: p.channel_id, messageId: p.message_id });
    const onTyping = (p: { channel_id: string; user_id: number; user_name: string }) => dispatch({ type: 'typing', channelId: p.channel_id, userId: p.user_id, name: p.user_name, until: Date.now() + 5000 });
    const onChannel = () => void loadChannels();
    const onMemberAdded = (p: { channel_id: string }) => { socket.emit('join_channel', { channel_id: p.channel_id }); void loadChannels(); };
    const onMemberRemoved = (p: { channel_id: string; user_id: number }) => { if (p.user_id === user.id) dispatch({ type: 'channel_removed', channelId: p.channel_id }); };
    const onPinned = (p: { message_id: string; channel_id: string; pinned_by: number }) => { dispatch({ type: 'message_pinned', channelId: p.channel_id, messageId: p.message_id, pinnedBy: p.pinned_by }); if (p.channel_id === current.current) void loadPins(p.channel_id); };
    const onUnpinned = (p: { message_id: string; channel_id: string }) => dispatch({ type: 'message_unpinned', channelId: p.channel_id, messageId: p.message_id });
    const onReactionAdded = (p: { message_id: string; channel_id: string; emoji: string; user_id: number }) => dispatch({ type: 'reaction_added', channelId: p.channel_id, messageId: p.message_id, emoji: p.emoji, userId: p.user_id });
    const onReactionRemoved = (p: { message_id: string; channel_id: string; emoji: string; user_id: number }) => dispatch({ type: 'reaction_removed', channelId: p.channel_id, messageId: p.message_id, emoji: p.emoji, userId: p.user_id });
    const onUnread = (p: { channel_id: string }) => dispatch({ type: 'read', channelId: p.channel_id });
    const handlers: Array<[string, (...a: any[]) => void]> = [
      ['connect', onConnect], ['disconnect', onDisconnect], ['connect_error', onConnectError], ['session_ended', onSessionEnded],
      ['new_message', onNew], ['message_edited', onEdited], ['message_deleted', onDeleted], ['typing', onTyping],
      ['channel_updated', onChannel], ['member_added', onMemberAdded], ['member_removed', onMemberRemoved],
      ['message_pinned', onPinned], ['message_unpinned', onUnpinned], ['reaction_added', onReactionAdded], ['reaction_removed', onReactionRemoved], ['unread_update', onUnread],
    ];
    for (const [ev, fn] of handlers) socket.on(ev, fn);
    const t = setInterval(() => dispatch({ type: 'typing_expire', now: Date.now() }), 1000);
    if (socket.connected) onConnect();
    return () => {
      clearInterval(t); if (readTimer.current) clearTimeout(readTimer.current);
      for (const [ev, fn] of handlers) socket.off(ev, fn);
    };
  }, [socket, api, loadChannels, fetchNewest, loadPins, user.id, user.fullName, onAuthError, lookingRef]);

  const actions = useMemo<Actions>(() => ({ loadChannels, openChannel, loadOlder, loadLatest, send, edit, remove, createChannel, openDm, browseChannels, joinChannel, typing, markRead, reply, openThread, loadPins, loadMembers, pin, unpin, react, upload, search, jumpTo, clearHighlight, highlight, loadChannelFiles, fetchBlob, listRestrictions, addRestriction, removeRestriction, adminUsers, userRestrictions, setAccess, allUsers, updatePrefs, setStatus, setChannelNotify }),
    [loadChannels, openChannel, loadOlder, loadLatest, send, edit, remove, createChannel, openDm, browseChannels, joinChannel, typing, markRead, reply, openThread, loadPins, loadMembers, pin, unpin, react, upload, search, jumpTo, clearHighlight, highlight, loadChannelFiles, fetchBlob, listRestrictions, addRestriction, removeRestriction, adminUsers, userRestrictions, setAccess, allUsers, updatePrefs, setStatus, setChannelNotify]);
  const value = useMemo<Ctx>(() => ({ state, user, api, actions, currentChannelId, setCurrentChannelId }), [state, user, api, actions, currentChannelId, setCurrentChannelId]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): Ctx {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
