import type {
  Channel,
  ChannelMember,
  ChannelNotifyPref,
  Message,
  Preferences,
  PresenceSnapshot,
} from '../types/index.ts';
import type { Presence } from '../utils/presence.ts';

/** windowed: the bucket holds a jump-to window rather than the newest page. */
export type Bucket = { items: Message[]; nextCursor: string | null; loaded: boolean; windowed?: boolean };
export type Thread = { root: Message; replies: Message[]; loaded: boolean };
export type State = {
  channels: Channel[];
  messagesByChannel: Record<string, Bucket>;
  typingByChannel: Record<string, Record<number, { name: string; until: number }>>;
  connected: boolean;
  threads: Record<string, Thread>;
  pinsByChannel: Record<string, Message[]>;
  membersByChannel: Record<string, ChannelMember[]>;
  replyTarget: Message | null;
  highlightId: string | null;
  /** ids already applied by message_added — own sends are echoed by the socket, so every add must be idempotent. */
  seen: Record<string, true>;
  /** The server said chat is not switched on for this user (403 / connect_error `chat_not_enabled`). */
  notEnabled: boolean;
  /** Who is online/away and their status (GET /users/online, then user_* socket events). */
  presence: Presence;
  /** Own preferences; defaults until loaded (and if the server cannot answer). */
  prefs: Preferences;
};
export type Action =
  | { type: 'channels_loaded'; channels: Channel[] }
  | { type: 'channel_upsert'; channel: Channel }
  | { type: 'channel_removed'; channelId: string }
  | {
      type: 'messages_loaded';
      channelId: string;
      messages: Message[];
      nextCursor: string | null;
      prepend: boolean;
      windowed?: boolean;
    }
  | { type: 'bucket_unload'; channelId: string }
  /** looking: the chat is being looked at (default true). When false the open channel counts unread like any other. */
  | { type: 'message_added'; message: Message; currentChannelId: string | null; selfId: number; looking?: boolean }
  | { type: 'message_edited'; channelId: string; messageId: string; content: string; editedAt: string | null }
  | { type: 'message_deleted'; channelId: string; messageId: string }
  | { type: 'typing'; channelId: string; userId: number; name: string; until: number }
  | { type: 'typing_expire'; now: number }
  | { type: 'read'; channelId: string }
  | { type: 'connected'; value: boolean }
  | { type: 'stale_all' }
  | { type: 'thread_loaded'; rootId: string; root: Message; replies: Message[] }
  | { type: 'pins_loaded'; channelId: string; pins: Message[] }
  | { type: 'members_loaded'; channelId: string; members: ChannelMember[] }
  | { type: 'message_pinned'; channelId: string; messageId: string; pinnedBy: number }
  | { type: 'message_unpinned'; channelId: string; messageId: string }
  | { type: 'reaction_added'; channelId: string; messageId: string; emoji: string; userId: number }
  | { type: 'reaction_removed'; channelId: string; messageId: string; emoji: string; userId: number }
  | { type: 'set_reply_target'; message: Message | null }
  | { type: 'mention_read'; channelId: string }
  | { type: 'highlight'; messageId: string | null }
  | { type: 'not_enabled' }
  | { type: 'channel_notify'; channelId: string; pref: ChannelNotifyPref }
  | { type: 'prefs_set'; prefs: Preferences }
  | { type: 'presence_loaded'; snapshot: PresenceSnapshot }
  | { type: 'user_online'; userId: number }
  | { type: 'user_offline'; userId: number }
  | { type: 'user_away'; userId: number; away: boolean }
  | { type: 'user_status'; userId: number; text: string; emoji: string };

export const defaultPrefs: Preferences = {
  desktopNotif: 'mentions',
  mobileNotif: 'mentions',
  soundEnabled: true,
  sendOnEnter: true,
  statusText: '',
  statusEmoji: '',
};
export const initialState: State = {
  channels: [],
  messagesByChannel: {},
  typingByChannel: {},
  connected: false,
  threads: {},
  pinsByChannel: {},
  membersByChannel: {},
  replyTarget: null,
  highlightId: null,
  seen: {},
  notEnabled: false,
  presence: { online: {}, away: {}, statuses: {} },
  prefs: defaultPrefs,
};
/**
 * Only GET /channels carries the real notifyPref (missing → `default`). Channels
 * arriving any other way (create, DM, join, channel_updated) keep the level we
 * already hold; only channels_loaded and channel_notify change it.
 */
const withPref = (c: Channel): Channel => ({ ...c, notifyPref: c.notifyPref ?? 'default' });
const without = <T>(r: Record<number, T>, id: number): Record<number, T> => {
  if (!(id in r)) return r;
  const o = { ...r };
  delete o[id];
  return o;
};
const empty = (): Bucket => ({ items: [], nextCursor: null, loaded: false });
const byTime = (a: Message, b: Message) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
const mergeById = (a: Message[], b: Message[]) => {
  const m = new Map(a.map((x) => [x.id, x]));
  for (const x of b) m.set(x.id, x);
  return [...m.values()].sort(byTime);
};

/** Apply `fn` to one message wherever it is held: channel feed, thread root/replies, pins. */
function patchMessage(state: State, channelId: string, messageId: string, fn: (m: Message) => Message): State {
  const cur = state.messagesByChannel[channelId];
  const messagesByChannel = cur
    ? {
        ...state.messagesByChannel,
        [channelId]: { ...cur, items: cur.items.map((m) => (m.id === messageId ? fn(m) : m)) },
      }
    : state.messagesByChannel;
  const threads: State['threads'] = {};
  for (const [rid, t] of Object.entries(state.threads))
    threads[rid] = {
      ...t,
      root: t.root.id === messageId ? fn(t.root) : t.root,
      replies: t.replies.map((m) => (m.id === messageId ? fn(m) : m)),
    };
  const pins = state.pinsByChannel[channelId];
  const pinsByChannel = pins
    ? { ...state.pinsByChannel, [channelId]: pins.map((m) => (m.id === messageId ? fn(m) : m)) }
    : state.pinsByChannel;
  return { ...state, messagesByChannel, threads, pinsByChannel };
}

export function chatReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'channels_loaded':
      return { ...state, channels: action.channels.map((c) => withPref(c)) };
    case 'channel_upsert': {
      const exists = state.channels.some((c) => c.id === action.channel.id);
      return {
        ...state,
        channels: exists
          ? state.channels.map((c) =>
              c.id === action.channel.id ? { ...c, ...action.channel, notifyPref: c.notifyPref } : c,
            )
          : [...state.channels, withPref(action.channel)],
      };
    }
    case 'channel_removed':
      return { ...state, channels: state.channels.filter((c) => c.id !== action.channelId) };
    case 'messages_loaded': {
      const cur = state.messagesByChannel[action.channelId] || empty();
      if (action.prepend) {
        return {
          ...state,
          messagesByChannel: {
            ...state.messagesByChannel,
            [action.channelId]: {
              items: mergeById(action.messages, cur.items),
              nextCursor: action.nextCursor,
              loaded: true,
              windowed: cur.windowed,
            },
          },
        };
      }
      // A fresh newest page: if it shares no message with what we hold, more
      // arrived than one page while we were away — replace, so there is no hole
      // that "scroll up" could never fill. If it overlaps, merge and keep history.
      const have = new Set(cur.items.map((m) => m.id));
      const overlaps = cur.items.length === 0 || action.messages.some((m) => have.has(m.id));
      const items = overlaps ? mergeById(cur.items, action.messages) : [...action.messages].sort(byTime);
      const nextCursor = overlaps && cur.loaded ? cur.nextCursor : action.nextCursor;
      return {
        ...state,
        messagesByChannel: {
          ...state.messagesByChannel,
          [action.channelId]: { items, nextCursor, loaded: true, windowed: !!action.windowed },
        },
      };
    }
    case 'bucket_unload': {
      const cur = state.messagesByChannel[action.channelId];
      if (!cur) return state;
      return {
        ...state,
        messagesByChannel: { ...state.messagesByChannel, [action.channelId]: { ...cur, loaded: false } },
      };
    }
    case 'stale_all': {
      const out: Record<string, Bucket> = {};
      for (const [cid, b] of Object.entries(state.messagesByChannel)) out[cid] = { ...b, loaded: false };
      return { ...state, messagesByChannel: out };
    }
    case 'message_added': {
      const { message: m } = action;
      if (state.seen[m.id]) return state;
      const bump = (m.channelId !== action.currentChannelId || action.looking === false) && m.userId !== action.selfId;
      const bumpMention = bump && !!m.mentionsMe;
      let next: State = {
        ...state,
        seen: { ...state.seen, [m.id]: true },
        channels: state.channels.map((c) =>
          c.id === m.channelId
            ? {
                ...c,
                lastMessageAt: m.createdAt,
                unreadCount: bump ? c.unreadCount + 1 : c.unreadCount,
                mentionCount: bumpMention ? (c.mentionCount || 0) + 1 : c.mentionCount || 0,
              }
            : c,
        ),
      };
      if (m.threadId) {
        const t = next.threads[m.threadId];
        if (t && !t.replies.some((x) => x.id === m.id))
          next = {
            ...next,
            threads: { ...next.threads, [m.threadId]: { ...t, replies: [...t.replies, m].sort(byTime) } },
          };
        return patchMessage(next, m.channelId, m.threadId, (root) => ({ ...root, replyCount: root.replyCount + 1 }));
      }
      const cur = next.messagesByChannel[m.channelId] || empty();
      const items = cur.items.some((x) => x.id === m.id) ? cur.items : [...cur.items, m].sort(byTime);
      return { ...next, messagesByChannel: { ...next.messagesByChannel, [m.channelId]: { ...cur, items } } };
    }
    case 'message_edited':
      return patchMessage(state, action.channelId, action.messageId, (m) => ({
        ...m,
        content: action.content,
        editedAt: action.editedAt,
      }));
    case 'message_deleted': {
      const cur = state.messagesByChannel[action.channelId];
      const messagesByChannel = cur
        ? {
            ...state.messagesByChannel,
            [action.channelId]: { ...cur, items: cur.items.filter((x) => x.id !== action.messageId) },
          }
        : state.messagesByChannel;
      const threads: State['threads'] = {};
      for (const [rid, t] of Object.entries(state.threads))
        if (rid !== action.messageId)
          threads[rid] = { ...t, replies: t.replies.filter((m) => m.id !== action.messageId) };
      const pins = state.pinsByChannel[action.channelId];
      const pinsByChannel = pins
        ? { ...state.pinsByChannel, [action.channelId]: pins.filter((m) => m.id !== action.messageId) }
        : state.pinsByChannel;
      return { ...state, messagesByChannel, threads, pinsByChannel };
    }
    case 'typing':
      return {
        ...state,
        typingByChannel: {
          ...state.typingByChannel,
          [action.channelId]: {
            ...(state.typingByChannel[action.channelId] || {}),
            [action.userId]: { name: action.name, until: action.until },
          },
        },
      };
    case 'typing_expire': {
      const out: State['typingByChannel'] = {};
      for (const [cid, users] of Object.entries(state.typingByChannel)) {
        const kept = Object.fromEntries(Object.entries(users).filter(([, v]) => v.until > action.now));
        if (Object.keys(kept).length) out[cid] = kept as any;
      }
      return { ...state, typingByChannel: out };
    }
    case 'read':
      return {
        ...state,
        channels: state.channels.map((c) =>
          c.id === action.channelId ? { ...c, unreadCount: 0, mentionCount: 0 } : c,
        ),
      };
    case 'mention_read':
      return {
        ...state,
        channels: state.channels.map((c) => (c.id === action.channelId ? { ...c, mentionCount: 0 } : c)),
      };
    case 'connected':
      return { ...state, connected: action.value };
    case 'thread_loaded':
      return {
        ...state,
        threads: { ...state.threads, [action.rootId]: { root: action.root, replies: action.replies, loaded: true } },
      };
    case 'pins_loaded':
      return { ...state, pinsByChannel: { ...state.pinsByChannel, [action.channelId]: action.pins } };
    case 'members_loaded':
      return { ...state, membersByChannel: { ...state.membersByChannel, [action.channelId]: action.members } };
    case 'message_pinned':
      return patchMessage(state, action.channelId, action.messageId, (m) => ({ ...m, pinned: true }));
    case 'message_unpinned': {
      const s2 = patchMessage(state, action.channelId, action.messageId, (m) => ({ ...m, pinned: false }));
      return {
        ...s2,
        pinsByChannel: {
          ...s2.pinsByChannel,
          [action.channelId]: (s2.pinsByChannel[action.channelId] || []).filter((m) => m.id !== action.messageId),
        },
      };
    }
    case 'reaction_added':
      return patchMessage(state, action.channelId, action.messageId, (m) => {
        const r = m.reactions.find((x) => x.emoji === action.emoji);
        if (r?.userIds.includes(action.userId)) return m;
        const reactions = r
          ? m.reactions.map((x) =>
              x.emoji === action.emoji ? { ...x, count: x.count + 1, userIds: [...x.userIds, action.userId] } : x,
            )
          : [...m.reactions, { emoji: action.emoji, count: 1, userIds: [action.userId] }];
        return { ...m, reactions };
      });
    case 'reaction_removed':
      return patchMessage(state, action.channelId, action.messageId, (m) => ({
        ...m,
        reactions: m.reactions
          .map((x) =>
            x.emoji === action.emoji && x.userIds.includes(action.userId)
              ? { ...x, count: x.count - 1, userIds: x.userIds.filter((u) => u !== action.userId) }
              : x,
          )
          .filter((x) => x.count > 0),
      }));
    case 'set_reply_target':
      return { ...state, replyTarget: action.message };
    case 'highlight':
      return { ...state, highlightId: action.messageId };
    case 'not_enabled':
      return { ...state, notEnabled: true };
    case 'channel_notify':
      return {
        ...state,
        channels: state.channels.map((c) => (c.id === action.channelId ? { ...c, notifyPref: action.pref } : c)),
      };
    case 'prefs_set':
      return { ...state, prefs: action.prefs };
    case 'presence_loaded': {
      const online: Presence['online'] = {};
      const away: Presence['away'] = {};
      const statuses: Presence['statuses'] = {};
      for (const id of action.snapshot.online || []) online[id] = true;
      for (const id of action.snapshot.away || []) away[id] = true;
      for (const [id, st] of Object.entries(action.snapshot.statuses || {}))
        if (st && (st.text || st.emoji)) statuses[Number(id)] = { text: st.text || '', emoji: st.emoji || '' };
      return { ...state, presence: { online, away, statuses } };
    }
    case 'user_online':
      return state.presence.online[action.userId]
        ? state
        : { ...state, presence: { ...state.presence, online: { ...state.presence.online, [action.userId]: true } } };
    case 'user_offline':
      return {
        ...state,
        presence: {
          ...state.presence,
          online: without(state.presence.online, action.userId),
          away: without(state.presence.away, action.userId),
        },
      };
    case 'user_away':
      return {
        ...state,
        presence: {
          ...state.presence,
          away: action.away
            ? { ...state.presence.away, [action.userId]: true }
            : without(state.presence.away, action.userId),
        },
      };
    case 'user_status':
      return {
        ...state,
        presence: {
          ...state.presence,
          statuses:
            action.text || action.emoji
              ? { ...state.presence.statuses, [action.userId]: { text: action.text, emoji: action.emoji } }
              : without(state.presence.statuses, action.userId),
        },
      };
    default:
      return state;
  }
}
