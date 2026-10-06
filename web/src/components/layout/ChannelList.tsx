import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BellOff, ChevronDown, Hash, Lock, MoreHorizontal } from 'lucide-react';
import { STORAGE_KEYS } from '../../config/constants.ts';
import type { Channel } from '../../types/index.ts';
import { presenceOf, type Presence } from '../../utils/presence.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { StatusBadge } from '../common/PresenceDot.tsx';
import { ChannelMenu } from './ChannelMenu.tsx';

const NOBODY: Presence = { online: {}, away: {}, statuses: {} };
type Collapsed = { favourites?: boolean; rooms?: boolean; dms?: boolean };
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

/** The foldable lists in the sidebar: favourites (when any), channels, then direct messages. Each row has a menu. */
export function ChannelList({ channels, currentId, onSelect, presence = NOBODY }: Props) {
  const favourites = channels.filter((c) => c.favourite);
  const rooms = channels.filter((c) => c.type !== 'dm' && !c.favourite);
  const dms = channels.filter((c) => c.type === 'dm' && !c.favourite);
  const [menuFor, setMenuFor] = useState<Channel | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const openMenu = (c: Channel, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    menuAnchor.current = e.currentTarget.closest('.s-row') as HTMLElement;
    setMenuFor(c);
  };
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
    <div
      key={c.id}
      className={`s-row${menuFor?.id === c.id ? ' menu-open' : ''}`}
      onContextMenu={(e) => openMenu(c, e)}
    >
      <button
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
      <button
        className="row-more"
        aria-label={`Options for ${label}`}
        aria-haspopup="menu"
        data-testid="chan-menu"
        onClick={(e) => openMenu(c, e)}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
  const dmRow = (c: Channel) =>
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
    );
  const roomRow = (c: Channel) =>
    row(c, c.displayName, c.type === 'private' ? <Lock className="hash" /> : <Hash className="hash" />);
  if (!channels.length) return <p className="s-empty chan-list">No channels yet</p>;
  return (
    <nav className="chan-list" aria-label="Conversations">
      {favourites.length > 0 && (
        <div className="chan-group" data-testid="favourites">
          {title('favourites', 'Favourites', favourites)}
          {shown(favourites, 'favourites').map((c) => (c.type === 'dm' ? dmRow(c) : roomRow(c)))}
        </div>
      )}
      {rooms.length > 0 && (
        <div className="chan-group">
          {title('rooms', 'Channels', rooms)}
          {shown(rooms, 'rooms').map(roomRow)}
        </div>
      )}
      {dms.length > 0 && (
        <div className="chan-group">
          {title('dms', 'Direct messages', dms)}
          {shown(dms, 'dms').map(dmRow)}
        </div>
      )}
      {menuFor && <ChannelMenu channel={menuFor} anchor={menuAnchor} onClose={() => setMenuFor(null)} />}
    </nav>
  );
}
