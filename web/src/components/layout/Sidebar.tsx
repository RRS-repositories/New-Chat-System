import { MessageCircle, PenLine, Search, Settings } from 'lucide-react';
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
  onSelect: (channel: Channel) => void;
  onNewChannel: () => void;
  onNewDm: () => void;
  onBrowse: () => void;
  onSearch: () => void;
  onSettings: () => void;
};

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const PRESENCE_LABEL: Record<PresenceState, string> = { online: 'Online', away: 'Away', offline: 'Offline' };

/** The left panel: the brand, search, your channels and people, the actions, and your own card (which opens Settings). */
export function Sidebar(props: Props) {
  const { channels, currentId, presence, userId, userName, ownPresence, ownStatus, onSelect, onSearch } = props;
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
      <ChannelList
        channels={channels}
        currentId={currentId}
        onSelect={onSelect}
        presence={presence}
        onNewChannel={props.onNewChannel}
        onBrowse={props.onBrowse}
        onNewDm={props.onNewDm}
      />
      <div className="s-bot sidebar-foot">
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
