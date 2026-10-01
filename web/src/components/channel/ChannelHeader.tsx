import { Menu, Hash, Lock, Pin, Info, Phone } from 'lucide-react';
import type { Channel, ChannelNotifyPref } from '../../types/index.ts';
import type { PresenceState } from '../../utils/presence.ts';
import { PresenceDot, StatusBadge } from '../common/PresenceDot.tsx';
import { NotifyMenu } from './NotifyMenu.tsx';
export function ChannelHeader({
  channel,
  onOpenSidebar,
  connected,
  pinCount = 0,
  onOpenPins,
  onOpenDetails,
  dmPresence,
  dmStatus,
  onSetNotify,
  onStartCall,
  callDisabled,
}: {
  channel: Channel | null;
  onOpenSidebar: () => void;
  connected: boolean;
  pinCount?: number;
  onOpenPins?: () => void;
  onOpenDetails?: () => void;
  dmPresence?: PresenceState;
  dmStatus?: { text: string; emoji: string };
  onSetNotify?: (pref: ChannelNotifyPref) => Promise<void>;
  /** Voice call button (any channel type); disabled while this tab is in a call. */
  onStartCall?: () => void;
  callDisabled?: boolean;
}) {
  const title = channel
    ? channel.type === 'dm'
      ? channel.dmUserName || 'Direct message'
      : channel.displayName
    : 'Chat';
  return (
    <header className="chan-head">
      <button className="icon-btn only-mobile" aria-label="Channels" onClick={onOpenSidebar}>
        <Menu size={18} />
      </button>
      {channel?.type === 'private' ? <Lock size={16} /> : channel && channel.type !== 'dm' ? <Hash size={16} /> : null}
      {channel?.type === 'dm' && dmPresence && <PresenceDot state={dmPresence} />}
      <h1 className="chan-title">{title}</h1>
      {channel?.type === 'dm' && (
        <span className="hide-narrow">
          <StatusBadge status={dmStatus} withText />
        </span>
      )}
      {channel && channel.type !== 'dm' && <span className="muted hide-narrow">{channel.memberCount} members</span>}
      {!connected && <span className="muted offline">Reconnecting…</span>}
      <span className="head-actions">
        {channel && onStartCall && (
          <button
            className="icon-btn"
            data-testid="call-start"
            aria-label="Start voice call"
            title={callDisabled ? 'You are in a call' : 'Start voice call'}
            disabled={callDisabled}
            onClick={onStartCall}
          >
            <Phone size={16} />
          </button>
        )}
        {channel && onSetNotify && <NotifyMenu value={channel.notifyPref ?? 'default'} onChange={onSetNotify} />}
        {channel && onOpenPins && (
          <button className="icon-btn" aria-label="Pinned messages" title="Pinned messages" onClick={onOpenPins}>
            <Pin size={16} />
            {pinCount > 0 && <span className="pin-count">{pinCount}</span>}
          </button>
        )}
        {channel && onOpenDetails && (
          <button className="icon-btn" aria-label="Channel details" title="Details" onClick={onOpenDetails}>
            <Info size={16} />
          </button>
        )}
      </span>
    </header>
  );
}
