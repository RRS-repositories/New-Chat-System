import { useState, type ReactNode } from 'react';
import { BellOff, ChevronDown, Hash, Lock } from 'lucide-react';
import { STORAGE_KEYS } from '../../config/constants.ts';
import type { Channel } from '../../types/index.ts';
import { presenceOf, type Presence } from '../../utils/presence.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { StatusBadge } from '../common/PresenceDot.tsx';

const NOBODY: Presence = { online: {}, away: {}, statuses: {} };
type Collapsed = { rooms?: boolean; dms?: boolean };
const KEY = STORAGE_KEYS.collapsedSections;
const loadCollapsed = (): Collapsed => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
};
/** A collapsed section still shows the open channel and anything unread, so nothing is missed. */
export const visibleWhenCollapsed = (c: Channel, currentId: string | null) =>
  c.id === currentId || c.unreadCount > 0 || c.mentionCount > 0;
const unreadTotal = (list: Channel[], currentId: string | null) =>
  list.reduce((total, c) => total + (c.id === currentId ? 0 : c.unreadCount), 0);

type Props = {
  channels: Channel[];
  currentId: string | null;
  onSelect: (c: Channel) => void;
  presence?: Presence;
};

/** The two foldable lists in the sidebar: channels, then direct messages. */
export function ChannelList({ channels, currentId, onSelect, presence = NOBODY }: Props) {
  const rooms = channels.filter((c) => c.type !== 'dm');
  const dms = channels.filter((c) => c.type === 'dm');
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed);
  const toggle = (k: keyof Collapsed) =>
    setCollapsed((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  const title = (k: keyof Collapsed, label: string, list: Channel[]) => {
    const unread = unreadTotal(list, currentId);
    return (
      <button className="s-sec chan-group-title" aria-expanded={!collapsed[k]} onClick={() => toggle(k)}>
        <ChevronDown size={11} />
        <span>{label}</span>
        {unread > 0 ? (
          <span className="cnt">{unread}</span>
        ) : (
          collapsed[k] && <span className="cnt quiet">{list.length}</span>
        )}
      </button>
    );
  };
  const shown = (list: Channel[], k: keyof Collapsed) =>
    collapsed[k] ? list.filter((c) => visibleWhenCollapsed(c, currentId)) : list;
  const row = (c: Channel, label: string, icon: ReactNode, extra?: ReactNode) => (
    <button
      key={c.id}
      className={`s-item chan-row${c.id === currentId ? ' active' : ''}${c.unreadCount ? ' unread' : ''}`}
      onClick={() => onSelect(c)}
    >
      {icon}
      <span className="chan-name">{label}</span>
      {extra}
      {c.notifyPref === 'nothing' && <BellOff size={12} className="muted-icon" aria-label="Muted" />}
      {c.mentionCount > 0 ? (
        <span className="badge mention" title="Mentions">
          {c.mentionCount}
        </span>
      ) : (
        c.unreadCount > 0 && <span className="badge">{c.unreadCount}</span>
      )}
    </button>
  );
  if (!channels.length) return <p className="s-empty chan-list">No channels yet</p>;
  return (
    <nav className="chan-list" aria-label="Conversations">
      {rooms.length > 0 && (
        <div className="chan-group">
          {title('rooms', 'Channels', rooms)}
          {shown(rooms, 'rooms').map((c) =>
            row(c, c.displayName, c.type === 'private' ? <Lock className="hash" /> : <Hash className="hash" />),
          )}
        </div>
      )}
      {dms.length > 0 && (
        <div className="chan-group">
          {title('dms', 'Direct messages', dms)}
          {shown(dms, 'dms').map((c) =>
            row(
              c,
              c.dmUserName || 'Direct message',
              <UserAvatar
                userId={c.dmUserId}
                name={c.dmUserName || '?'}
                size="sm"
                presence={presenceOf(presence, c.dmUserId)}
              />,
              c.dmUserId != null ? <StatusBadge status={presence.statuses[c.dmUserId]} /> : null,
            ),
          )}
        </div>
      )}
    </nav>
  );
}
