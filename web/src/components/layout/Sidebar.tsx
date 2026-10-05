import { Hash, MessageCircle, PenLine, Plus, Search, Settings, Shield } from 'lucide-react';
import type { ReactNode } from 'react';
import { APP_TITLE, ORG_NAME } from '../../config/constants.ts';
import type { Channel, UserStatus } from '../../types/index.ts';
import type { Presence, PresenceState } from '../../utils/presence.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { ChannelList } from './ChannelList.tsx';

type Props = {
  channels: Channel[];
  currentId: string | null;
  presence: Presence;
  userId: number;
  userName: string;
  /** The signed-in person's own presence and status, shown on their card at the bottom. */
  ownPresence: PresenceState;
  ownStatus?: UserStatus;
  adminActive?: boolean;
  onSelect: (channel: Channel) => void;
  onNewChannel: () => void;
  onNewDm: () => void;
  onBrowse: () => void;
  onSearch: () => void;
  onSettings: () => void;
  /** Passed only for Management; without it the Admin row is not shown. */
  onAdmin?: () => void;
};

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const PRESENCE_LABEL: Record<PresenceState, string> = { online: 'Online', away: 'Away', offline: 'Offline' };

type FootRowProps = { icon: ReactNode; label: string; active?: boolean; onClick: () => void };

function FootRow({ icon, label, active, onClick }: FootRowProps) {
  return (
    <button className={`s-bitem chan-row${active ? ' active' : ''}`} onClick={onClick}>
      {icon}
      <span className="chan-name">{label}</span>
    </button>
  );
}

/** The left panel: the brand, search, your channels and people, the actions, and your own card (which opens Settings). */
export function Sidebar(props: Props) {
  const {
    channels,
    currentId,
    presence,
    userId,
    userName,
    ownPresence,
    ownStatus,
    adminActive,
    onSelect,
    onSearch,
    onAdmin,
  } = props;
  const statusLine = [ownStatus?.emoji, ownStatus?.text].filter(Boolean).join(' ');
  return (
    <div className="sidebar-inner">
      <div className="s-brand sidebar-head">
        <span className="s-logo">
          <MessageCircle size={17} strokeWidth={2.2} />
        </span>
        <span className="bn">
          <b>{APP_TITLE}</b>
          <span>{ORG_NAME}</span>
        </span>
        <button className="s-ic" aria-label="New message" title="New message" onClick={props.onNewDm}>
          <PenLine size={17} />
        </button>
      </div>
      <div className="s-search">
        <button aria-label="Search messages" title="Search" onClick={onSearch}>
          <Search size={14} />
          <span>Search</span>
          <span className="kbd">{isApple ? '⌘K' : 'Ctrl K'}</span>
        </button>
      </div>
      <ChannelList channels={channels} currentId={currentId} onSelect={onSelect} presence={presence} />
      <div className="s-bot sidebar-foot">
        <FootRow icon={<Plus size={15} />} label="New channel" onClick={props.onNewChannel} />
        <FootRow icon={<PenLine size={15} />} label="New message" onClick={props.onNewDm} />
        <FootRow icon={<Hash size={15} />} label="Browse channels" onClick={props.onBrowse} />
        {onAdmin && <FootRow icon={<Shield size={15} />} label="Admin" active={adminActive} onClick={onAdmin} />}
        <button className="s-me" aria-label="Settings" title="Settings" onClick={props.onSettings}>
          <UserAvatar userId={userId} name={userName} presence={ownPresence} />
          <span className="nm">
            <b className="sidebar-user">{userName}</b>
            <span>{statusLine || `${PRESENCE_LABEL[ownPresence]} · tap for settings`}</span>
          </span>
          <span className="gear">
            <Settings size={15} />
          </span>
        </button>
      </div>
    </div>
  );
}
