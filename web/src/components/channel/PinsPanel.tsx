import { Pin, X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import { formatTime } from '../../utils/format.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { useCanModerate } from './MessagePanel.tsx';

type Props = {
  channelId: string;
  onClose: () => void;
  /** Go to a pinned message in the conversation. */
  onJump: (messageId: string) => void;
};

const PREVIEW_CHARS = 200;

/** The pinned messages of a conversation, in the right-hand panel. Pressing one jumps to it. */
export function PinsPanel({ channelId, onClose, onJump }: Props) {
  const { state, actions } = useChat();
  const pins = state.pinsByChannel[channelId] || [];
  const canModerate = useCanModerate(channelId);
  const channel = state.channels.find((c) => c.id === channelId);
  const where = channel ? (channel.type === 'dm' ? channel.dmUserName || '' : `#${channel.displayName}`) : '';
  return (
    <aside className="thread-panel" aria-label="Pinned messages">
      <header className="p-h">
        <h2>Pinned</h2>
        <span className="sub">{where}</span>
        <button className="p-x" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="p-b">
        {!pins.length && (
          <div className="p-empty">
            <Pin size={28} />
            Nothing pinned yet.
            <br />
            Hover a message and press the pin.
          </div>
        )}
        {pins.map((m) => (
          <div key={m.id} className="pinrow" data-testid="pin-row">
            <UserAvatar userId={m.userId} name={m.userName} size="md" />
            <button className="bd" onClick={() => onJump(m.id)} title="Go to this message">
              <b>{m.userName}</b>
              <time>{formatTime(m.createdAt)}</time>
              <p>
                {m.content.slice(0, PREVIEW_CHARS)}
                {m.content.length > PREVIEW_CHARS ? '…' : ''}
                {m.files.length ? ` 📎 ${m.files.length}` : ''}
              </p>
            </button>
            {canModerate && (
              <button
                className="unpin"
                aria-label="Unpin"
                title="Unpin"
                onClick={() => void actions.unpin(m.id).catch(() => {})}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
