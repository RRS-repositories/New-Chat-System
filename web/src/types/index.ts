import type { Theme } from '../utils/theme.ts';
export type ChatUser = { id: number; fullName: string; role: string; email?: string };
export type Reaction = { emoji: string; count: number; userIds: number[] };
export type ChatFile = { id: string; filename: string; mimeType: string; sizeBytes: number; hasThumb: boolean };
export type Message = {
  id: string;
  channelId: string;
  userId: number;
  userName: string;
  content: string;
  type: 'message' | 'system' | 'join' | 'leave' | 'file' | 'call';
  createdAt: string;
  /** The message's exact position in its channel, for paging older or newer from it. */
  cursor?: string | null;
  editedAt: string | null;
  replyToId: string | null;
  threadId: string | null;
  replyTo: { id: string; userId: number | null; userName: string; content: string } | null;
  replyCount: number;
  pinned: boolean;
  reactions: Reaction[];
  files: ChatFile[];
  mentionsMe?: boolean;
};
export type Channel = {
  id: string;
  name: string;
  displayName: string;
  type: 'public' | 'private' | 'dm' | 'group_dm';
  purpose: string;
  header: string;
  unreadCount: number;
  mentionCount: number;
  lastMessageAt: string | null;
  dmUserId: number | null;
  dmUserName: string | null;
  memberCount: number;
  /** This user's level for the channel; `default` follows Preferences.desktopNotif. Filled with `default` when the server does not send it. */
  notifyPref: ChannelNotifyPref;
};
export type NotifyLevel = 'all' | 'mentions' | 'nothing';
export type ChannelNotifyPref = NotifyLevel | 'default';
/** GET/PATCH /api/chat/users/me/preferences */
export type Preferences = {
  desktopNotif: NotifyLevel;
  mobileNotif: NotifyLevel;
  soundEnabled: boolean;
  sendOnEnter: boolean;
  statusText: string;
  statusEmoji: string;
  /** The saved colour theme, or null when the person has never chosen one. */
  theme?: Theme | null;
};
export type UserStatus = { text: string; emoji: string };
/** GET /api/chat/users/online */
export type PresenceSnapshot = {
  online: number[];
  away: number[];
  statuses: Record<string, UserStatus>;
  /** Each person's profile photo address, for those who have one. */
  avatars?: Record<string, string>;
};
/** A public channel as listed by GET /api/chat/channels/browse (ordered by displayName). */
export type BrowseChannel = {
  id: string;
  name: string;
  displayName: string;
  purpose: string | null;
  memberCount: number;
  joined: boolean;
};
export type ChannelMember = { id: number; fullName: string; role: string; channelRole: 'owner' | 'admin' | 'member' };
export type SearchHit = {
  messageId: string;
  channelId: string;
  channelName: string;
  /** The sender, for their avatar. */
  userId?: number;
  userName: string;
  snippet: string;
  createdAt: string;
};
export type ChannelFileRow = ChatFile & {
  channelId: string;
  userName: string;
  createdAt: string | null;
  messageId: string | null;
};
export type RestrictionType = 'all' | 'dm' | 'call' | 'channel';
/** A row means `userName` is blocked from contacting `targetName` (GET /api/chat/admin/restrictions). */
export type Restriction = {
  id: string;
  userId: number;
  targetUserId: number;
  restriction: RestrictionType;
  reason: string;
  restrictedBy: number;
  createdAt: string;
  userName: string | null;
  targetName: string | null;
  restrictedByName: string | null;
};
export type RestrictionInput = {
  userId: number;
  targetUserId: number;
  restriction: RestrictionType;
  reason?: string;
  bothWays?: boolean;
};
export type UserOption = { id: number; fullName: string; role: string };
/** A person as listed by GET /api/chat/admin/users (Management only). */
export type AdminUser = {
  id: number;
  fullName: string;
  email: string;
  role: string;
  chatEnabled: boolean;
  online: boolean;
  blockedFrom: number;
  blockedBy: number;
};
export type AccessChange = {
  targetUserIds: number[];
  kind: 'dm' | 'call' | 'channel' | 'all';
  allowed: boolean;
  bothWays: boolean;
};
export type Session = { token: string; user: ChatUser };
/** Calls (HTTP, camelCase). Voice only; screen share rides on the same peer connections. */
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
export type Call = {
  id: string;
  channelId: string;
  initiatedBy: number;
  initiatedByName: string;
  type: 'voice';
  status: CallStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationSecs: number | null;
  createdAt: string;
};
export type CallParticipant = { userId: number; userName: string; isSharingScreen: boolean };
/** Someone the host removed who is asking to be let back into the call. */
export type JoinRequest = { userId: number; userName: string };
export type IceServerInfo = { urls: string | string[]; username?: string; credential?: string };
/** POST /channels/:id/calls (201) and POST /calls/:id/join. */
export type CallJoinResponse = {
  success: boolean;
  call: Call;
  participants: CallParticipant[];
  iceServers: IceServerInfo[];
  /** People waiting to be let back in. Filled for the host only. */
  joinRequests?: JoinRequest[];
  /** Who the host is right now (the starter, or a stand-in while the starter is out of the call). */
  hostId?: number | null;
  /** People with a hand raised. */
  hands?: number[];
};
