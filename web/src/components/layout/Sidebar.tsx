import { Hash, Plus, Search, Settings, ShieldBan } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Channel } from '../../types/index.ts';
import type { Presence } from '../../utils/presence.ts';
import { ChannelList } from './ChannelList.tsx';

type Props = {
  channels: Channel[];
  currentId: string | null;
  presence: Presence;
  userName: string;
  adminActive?: boolean;
  onSelect: (channel: Channel) => void;
  onNewChannel: () => void;
  onNewDm: () => void;
  onBrowse: () => void;
  onSearch: () => void;
  onSettings: () => void;
  /** Passed only for Management; without it the Admin row is not shown. */
  onAdmin?: () => void;
  onSignOut?: () => void;
};

function FootRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`chan-row${active ? ' active' : ''}`} onClick={onClick}>
      {icon}
      <span className="chan-name">{label}</span>
    </button>
  );
}

/** The left panel: who you are, your channels and people, and the actions at the bottom. */
export function Sidebar(props: Props) {
  const { channels, currentId, presence, userName, adminActive, onSelect, onSignOut, onSearch, onAdmin } = props;
  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
        <span className="sidebar-user">{userName}</span>
        <span className="row gap">
          <button className="icon-btn" aria-label="Search messages" title="Search" onClick={onSearch}>
            <Search size={16} />
          </button>
          {onSignOut && (
            <button className="link" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </span>
      </div>
      <ChannelList channels={channels} currentId={currentId} onSelect={onSelect} presence={presence} />
      <div className="sidebar-foot">
        <FootRow icon={<Plus size={14} />} label="New channel" onClick={props.onNewChannel} />
        <FootRow icon={<Plus size={14} />} label="New message" onClick={props.onNewDm} />
        <FootRow icon={<Hash size={14} />} label="Browse channels" onClick={props.onBrowse} />
        {onAdmin && <FootRow icon={<ShieldBan size={14} />} label="Admin" active={adminActive} onClick={onAdmin} />}
        <FootRow icon={<Settings size={14} />} label="Settings" onClick={props.onSettings} />
      </div>
    </div>
  );
}
