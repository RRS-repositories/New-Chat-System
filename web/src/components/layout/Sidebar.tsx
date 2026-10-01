import { Hash, Plus, Search, Settings, ShieldBan } from 'lucide-react';
import { ChannelList } from './ChannelList.tsx';
import type { Channel } from '../../types/index.ts';
import type { Presence } from '../../utils/presence.ts';
/** `onRestrictions` is passed only for Management: without it the row is not shown. */
export function Sidebar({ channels, currentId, onSelect, onNewChannel, onNewDm, onBrowse, onSearch, onRestrictions, restrictionsActive, userName, onSignOut, presence, onSettings }:
  { channels: Channel[]; currentId: string | null; onSelect: (c: Channel) => void; onNewChannel: () => void; onNewDm: () => void; onBrowse?: () => void; onSearch?: () => void; onRestrictions?: () => void; restrictionsActive?: boolean; userName: string; onSignOut?: () => void; presence?: Presence; onSettings?: () => void }) {
  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
        <span className="sidebar-user">{userName}</span>
        <span className="row gap">
          {onSearch && <button className="icon-btn" aria-label="Search messages" title="Search" onClick={onSearch}><Search size={16} /></button>}
          {onSignOut && <button className="link" onClick={onSignOut}>Sign out</button>}
        </span>
      </div>
      <ChannelList channels={channels} currentId={currentId} onSelect={onSelect} presence={presence} />
      <div className="sidebar-foot">
        <button className="chan-row" onClick={onNewChannel}><Plus size={14} /><span className="chan-name">New channel</span></button>
        <button className="chan-row" onClick={onNewDm}><Plus size={14} /><span className="chan-name">New message</span></button>
        {onBrowse && <button className="chan-row" onClick={onBrowse}><Hash size={14} /><span className="chan-name">Browse channels</span></button>}
        {onRestrictions && <button className={`chan-row${restrictionsActive ? ' active' : ''}`} onClick={onRestrictions}><ShieldBan size={14} /><span className="chan-name">Admin</span></button>}
        {onSettings && <button className="chan-row" onClick={onSettings}><Settings size={14} /><span className="chan-name">Settings</span></button>}
      </div>
    </div>
  );
}
