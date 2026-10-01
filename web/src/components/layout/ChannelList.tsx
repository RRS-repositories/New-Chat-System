import { useState, type ReactNode } from 'react';
import { BellOff, ChevronDown, ChevronRight, Hash, Lock } from 'lucide-react';
import { STORAGE_KEYS } from '../../config/constants.ts';
import type { Channel } from '../../types/index.ts';
import { presenceOf, type Presence } from '../../utils/presence.ts';
import { PresenceDot, StatusBadge } from '../common/PresenceDot.tsx';
const NOBODY: Presence = { online: {}, away: {}, statuses: {} };
type Collapsed = { rooms?: boolean; dms?: boolean };
const KEY = STORAGE_KEYS.collapsedSections;
const loadCollapsed = (): Collapsed => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
/** A collapsed section still shows the open channel and anything unread, so nothing is missed. */
export const visibleWhenCollapsed = (c: Channel, currentId: string | null) => c.id === currentId || c.unreadCount > 0 || c.mentionCount > 0;
export function ChannelList({ channels, currentId, onSelect, presence = NOBODY }: { channels: Channel[]; currentId: string | null; onSelect: (c: Channel) => void; presence?: Presence }) {
  const rooms = channels.filter((c) => c.type !== 'dm'); const dms = channels.filter((c) => c.type === 'dm');
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed);
  const toggle = (k: keyof Collapsed) => setCollapsed((prev) => { const next = { ...prev, [k]: !prev[k] }; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } return next; });
  const title = (k: keyof Collapsed, label: string, count: number) => (
    <button className="chan-group-title" aria-expanded={!collapsed[k]} onClick={() => toggle(k)}>
      {collapsed[k] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span>{label}</span>{collapsed[k] && <span className="muted">{count}</span>}
    </button>
  );
  const shown = (list: Channel[], k: keyof Collapsed) => (collapsed[k] ? list.filter((c) => visibleWhenCollapsed(c, currentId)) : list);
  const Row = ({ c, label, icon, extra }: { c: Channel; label: string; icon?: ReactNode; extra?: ReactNode }) => (
    <button className={`chan-row${c.id === currentId ? ' active' : ''}${c.unreadCount ? ' unread' : ''}`} onClick={() => onSelect(c)}>
      {icon}<span className="chan-name">{label}</span>{extra}
      {c.notifyPref === 'nothing' && <BellOff size={12} className="muted-icon" aria-label="Muted" />}
      {c.mentionCount > 0 ? <span className="badge mention" title="Mentions">{c.mentionCount}</span> : c.unreadCount > 0 && <span className="badge">{c.unreadCount}</span>}
    </button>
  );
  if (!channels.length) return <p className="muted pad">No channels yet</p>;
  return (
    <nav className="chan-list">
      {rooms.length > 0 && <div className="chan-group">{title('rooms', 'Channels', rooms.length)}
        {shown(rooms, 'rooms').map((c) => <Row key={c.id} c={c} label={c.displayName} icon={c.type === 'private' ? <Lock size={14} /> : <Hash size={14} />} />)}</div>}
      {dms.length > 0 && <div className="chan-group">{title('dms', 'Direct messages', dms.length)}
        {shown(dms, 'dms').map((c) => <Row key={c.id} c={c} label={c.dmUserName || 'Direct message'} icon={<PresenceDot state={presenceOf(presence, c.dmUserId)} />}
          extra={c.dmUserId != null ? <StatusBadge status={presence.statuses[c.dmUserId]} /> : null} />)}</div>}
    </nav>
  );
}
