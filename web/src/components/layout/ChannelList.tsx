import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BellOff, ChevronDown, Hash, Lock, MoreHorizontal, PenLine, Plus } from 'lucide-react';
import { Floating } from '../common/Floating.tsx';
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
  /** The "+" on the section headers: a new channel or browsing (Channels), a new message (Direct messages). */
  onNewChannel?: () => void;
  onBrowse?: () => void;
  onNewDm?: () => void;
};

/** The foldable lists in the sidebar: favourites (when any), channels, then direct messages. Each row has a menu. */
export function ChannelList({
  channels,
  currentId,
  onSelect,
  presence = NOBODY,
  onNewChannel,
  onBrowse,
  onNewDm,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement | null>(null);
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
  const title = (k: keyof Collapsed, label: string, list: Channel[], add?: ReactNode) => {
    const unread = unreadTotal(list, currentId);
    return (
      <div className="s-sec-row">
        <button className="s-sec chan-group-title" aria-expanded={!collapsed[k]} onClick={() => toggle(k)}>
          <ChevronDown size={11} />
          <span>{label}</span>
          {unread > 0 ? (
            <span className="cnt">{unread}</span>
          ) : (
            collapsed[k] && <span className="cnt quiet">{list.length}</span>
          )}
        </button>
        {add}
      </div>
    );
  };
  const addChannels = (onNewChannel || onBrowse) && (
    <>
      <button
        ref={addButton}
        className="s-add"
        aria-label="New channel or browse channels"
        aria-haspopup="menu"
        aria-expanded={addOpen}
        data-testid="channels-add"
        onClick={() => setAddOpen(!addOpen)}
      >
        <Plus size={14} />
      </button>
      {addOpen && (
        <Floating anchor={addButton} onClose={() => setAddOpen(false)} className="cmenu" role="menu" label="Channels">
          {onNewChannel && (
            <button
              data-testid="menu-new-channel"
              onClick={() => {
                setAddOpen(false);
                onNewChannel();
              }}
            >
              <Plus size={15} />
              <span>New channel</span>
            </button>
          )}
          {onBrowse && (
            <button
              data-testid="menu-browse"
              onClick={() => {
                setAddOpen(false);
                onBrowse();
              }}
            >
              <Hash size={15} />
              <span>Browse channels</span>
            </button>
          )}
        </Floating>
      )}
    </>
  );
  const addDm = onNewDm && (
    <button className="s-add" aria-label="New direct message" data-testid="dms-new" onClick={onNewDm}>
      <PenLine size={13} />
    </button>
  );
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
          {title('rooms', 'Channels', rooms, addChannels)}
          {shown(rooms, 'rooms').map(roomRow)}
        </div>
      )}
      {dms.length > 0 && (
        <div className="chan-group">
          {title('dms', 'Direct messages', dms, addDm)}
          {shown(dms, 'dms').map(dmRow)}
        </div>
      )}
      {menuFor && <ChannelMenu channel={menuFor} anchor={menuAnchor} onClose={() => setMenuFor(null)} />}
    </nav>
  );
}
