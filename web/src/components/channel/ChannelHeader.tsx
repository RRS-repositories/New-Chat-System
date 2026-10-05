import { Hash, Info, Lock, Menu, Phone, Pin, Users } from 'lucide-react';
import type { Channel, ChannelNotifyPref } from '../../types/index.ts';
import type { PresenceState } from '../../utils/presence.ts';
import { Avatar } from '../common/Avatar.tsx';
import { PresenceDot } from '../common/PresenceDot.tsx';
import { NotifyMenu } from './NotifyMenu.tsx';

type Props = {
  channel: Channel | null;
  onOpenSidebar: () => void;
  connected: boolean;
  pinCount?: number;
  /** Which side panel is open, to light its button. */
  openPanel?: 'pins' | 'details' | null;
  onOpenPins?: () => void;
  onOpenDetails?: () => void;
  dmPresence?: PresenceState;
  dmStatus?: { text: string; emoji: string };
  dmAvatar?: string | null;
  onSetNotify?: (pref: ChannelNotifyPref) => Promise<void>;
  /** Voice call button (any channel type); disabled while this tab is in a call. */
  onStartCall?: () => void;
  callDisabled?: boolean;
};

const PRESENCE_LABEL: Record<PresenceState, string> = { online: 'Online', away: 'Away', offline: 'Offline' };

/** The bar above a conversation: what it is, who is in it, and the call, notification, pins and details buttons. */
export function ChannelHeader({
  channel,
  onOpenSidebar,
  connected,
  pinCount = 0,
  openPanel = null,
  onOpenPins,
  onOpenDetails,
  dmPresence,
  dmStatus,
  dmAvatar,
  onSetNotify,
  onStartCall,
  callDisabled,
}: Props) {
  const isDm = channel?.type === 'dm';
  const title = channel ? (isDm ? channel.dmUserName || 'Direct message' : channel.displayName) : 'Chat';
  const statusLine = [dmStatus?.emoji, dmStatus?.text].filter(Boolean).join(' ');
  let subtitle = '';
  if (channel && isDm) subtitle = statusLine || (dmPresence ? PRESENCE_LABEL[dmPresence] : '');
  else if (channel) {
    const members = `${channel.memberCount} ${channel.memberCount === 1 ? 'member' : 'members'}`;
    subtitle = channel.purpose ? `${channel.purpose} · ${members}` : members;
  }
  return (
    <header className="m-head chan-head">
      <button className="hbtn only-mobile" aria-label="Channels" onClick={onOpenSidebar}>
        <Menu size={18} />
      </button>
      {channel && (
        <span className="ch-ic">
          {isDm ? (
            <Avatar name={title} src={dmAvatar} size="sm" />
          ) : channel.type === 'private' ? (
            <Lock size={16} />
          ) : channel.type === 'group_dm' ? (
            <Users size={16} />
          ) : (
            <Hash size={16} />
          )}
        </span>
      )}
      <div className="m-title">
        <div className="r1">
          {isDm && dmPresence && <PresenceDot state={dmPresence} />}
          <h1 className="chan-title">{title}</h1>
        </div>
        <div className="r2">{connected ? subtitle : <span className="offline">Reconnecting…</span>}</div>
      </div>
      <span className="m-acts head-actions">
        {channel && onStartCall && (
          <button
            className="hbtn"
            data-testid="call-start"
            aria-label="Start voice call"
            title={callDisabled ? 'You are in a call' : 'Start a call'}
            disabled={callDisabled}
            onClick={onStartCall}
          >
            <Phone size={18} />
          </button>
        )}
        {channel && onSetNotify && <NotifyMenu value={channel.notifyPref ?? 'default'} onChange={onSetNotify} />}
        {channel && onOpenPins && (
          <button
            className={`hbtn${openPanel === 'pins' ? ' on' : ''}`}
            aria-label="Pinned messages"
            title="Pinned"
            onClick={onOpenPins}
          >
            <Pin size={18} />
            {pinCount > 0 && <span className="mini-cnt pin-count">{pinCount}</span>}
          </button>
        )}
        {channel && onOpenDetails && (
          <button
            className={`hbtn${openPanel === 'details' ? ' on' : ''}`}
            aria-label="Channel details"
            title="Details"
            onClick={onOpenDetails}
          >
            <Info size={18} />
          </button>
        )}
      </span>
    </header>
  );
}
