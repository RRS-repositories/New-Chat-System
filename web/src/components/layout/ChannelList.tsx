import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BellOff, CheckCheck, ChevronDown, Hash, Lock, MoreHorizontal, PenLine, Phone, Plus } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import { unreadRows } from '../../utils/sidebarFilter.ts';
import { useCall } from '../../context/callContext.ts';
import {
  applyOrder,
  byLatest,
  loadDmsRecent,
  loadOrder,
  moveId,
  recentDms,
  saveDmsRecent,
  saveOrder,
  type Order,
  type Section,
} from '../../utils/sidebarOrder.ts';
import { Floating } from '../common/Floating.tsx';
import { STORAGE_KEYS } from '../../config/constants.ts';
import type { Channel } from '../../types/index.ts';
import { presenceOf, type Presence } from '../../utils/presence.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { StatusBadge } from '../common/PresenceDot.tsx';
import { ChannelMenu } from './ChannelMenu.tsx';
import { shortName } from '../../utils/format.ts';

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
  /** The sidebar's filter box has text: every section opens and every direct message shows. */
  filtering?: boolean;
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
  filtering = false,
}: Props) {
  // "Mark all read" on a section header: every unread row in it is marked read.
  const { actions } = useChat();
  const markAllRead = (list: Channel[]) => {
    for (const c of unreadRows(list, currentId)) actions.markRead(c.id);
  };
  const [addOpen, setAddOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement | null>(null);
  // The rows in the order this person dragged them into (kept in the browser).
  const [order, setOrder] = useState<Order>(loadOrder);
  const favourites = applyOrder(
    channels.filter((c) => c.favourite),
    order.favourites,
  );
  const rooms = applyOrder(
    channels.filter((c) => c.type !== 'dm' && !c.favourite),
    order.rooms,
  );
  // Direct messages are not arranged by hand: newest first, so whoever just wrote is at the top.
  const allDms = byLatest(
    channels.filter((c) => c.type === 'dm' && !c.favourite),
    currentId,
  );
  // Direct messages: everyone, or only the recent ones (unread, open, favourite, or active lately).
  const [dmsRecent, setDmsRecent] = useState<boolean>(loadDmsRecent);
  const dms = dmsRecent && !filtering ? recentDms(allDms, currentId) : allDms;
  const hiddenDms = allDms.length - dms.length;
  const toggleRecent = () => {
    saveDmsRecent(!dmsRecent);
    setDmsRecent(!dmsRecent);
  };
  // Dragging a row: on drop it lands below the target when moved down, above it when moved up.
  const dragging = useRef<{ section: Section; id: string } | null>(null);
  const dropOn = (section: Section, list: Channel[], targetId: string) => {
    const d = dragging.current;
    dragging.current = null;
    if (!d || d.section !== section) return;
    const next = {
      ...order,
      [section]: moveId(
        list.map((c) => c.id),
        d.id,
        targetId,
      ),
    };
    saveOrder(next);
    setOrder(next);
  };
  const sectionOf = (c: Channel): Section => (c.favourite ? 'favourites' : c.type === 'dm' ? 'dms' : 'rooms');
  const listOf = (s: Section) => (s === 'favourites' ? favourites : s === 'rooms' ? rooms : allDms);
  // Which conversations have a call ringing or going on: a phone icon on their row.
  const { activeByChannel } = useCall();
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
    const pending = unreadRows(list, currentId).length;
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
        {pending > 0 && (
          <button
            className="s-add on"
            aria-label={`Mark all ${label.toLowerCase()} as read`}
            title={`Mark all ${label.toLowerCase()} as read (${pending})`}
            data-testid={`read-all-${k}`}
            onClick={() => markAllRead(list)}
          >
            <CheckCheck size={13} />
          </button>
        )}
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
    collapsed[k] && !filtering ? list.filter((c) => visibleWhenCollapsed(c, currentId)) : list;
  const row = (c: Channel, label: string, icon: ReactNode, extra?: ReactNode) => (
    <div
      key={c.id}
      className={`s-row${menuFor?.id === c.id ? ' menu-open' : ''}`}
      onContextMenu={(e) => openMenu(c, e)}
      draggable={sectionOf(c) !== 'dms'}
      data-testid={sectionOf(c) !== 'dms' ? 'chan-draggable' : 'chan-row-fixed'}
      onDragStart={(e) => {
        if (sectionOf(c) === 'dms') return;
        dragging.current = { section: sectionOf(c), id: c.id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', c.id);
      }}
      onDragOver={(e) => {
        if (dragging.current?.section === sectionOf(c)) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const s = sectionOf(c);
        dropOn(s, listOf(s), c.id);
      }}
      onDragEnd={() => {
        dragging.current = null;
      }}
    >
      <button
        className={`s-item chan-row${c.id === currentId ? ' active' : ''}${c.unreadCount ? ' unread' : ''}`}
        onClick={() => onSelect(c)}
      >
        {icon}
        <span className="chan-name">{label}</span>
        {extra}
        {activeByChannel[c.id] && (
          <Phone size={12} className="call-icon" aria-label="Call in progress" data-testid="row-call" />
        )}
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
      c.dmUserName ? shortName(c.dmUserName) : 'Direct message',
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
      {allDms.length > 0 && (
        <div className="chan-group">
          {title(
            'dms',
            'Direct messages',
            dms,
            <>
              <button
                className={`s-add s-text${dmsRecent ? ' on' : ''}`}
                aria-pressed={dmsRecent}
                title={
                  dmsRecent
                    ? 'Showing recent conversations only. Click to show everyone.'
                    : 'Show recent conversations only'
                }
                data-testid="dms-recent"
                onClick={toggleRecent}
              >
                {dmsRecent ? 'Recent' : 'All'}
              </button>
              {addDm}
            </>,
          )}
          {shown(dms, 'dms').map(dmRow)}
          {dmsRecent && hiddenDms > 0 && !collapsed.dms && (
            <button className="s-item s-more" data-testid="dms-show-all" onClick={toggleRecent}>
              Show all · {hiddenDms} more
            </button>
          )}
        </div>
      )}
      {menuFor && <ChannelMenu channel={menuFor} anchor={menuAnchor} onClose={() => setMenuFor(null)} />}
    </nav>
  );
}
