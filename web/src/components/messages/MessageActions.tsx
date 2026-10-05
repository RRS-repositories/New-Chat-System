import { useRef, useState } from 'react';
import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Reply, Smile, Trash2 } from 'lucide-react';
import type { Message } from '../../types/index.ts';
import { Floating } from '../common/Floating.tsx';
import { EmojiPicker } from './EmojiPicker.tsx';

type Props = {
  m: Message;
  own: boolean;
  canModerate: boolean;
  inThread?: boolean;
  onReply: () => void;
  onThread: () => void;
  onPin: () => void;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** The small bar that appears on a message: react, reply, thread, pin, and (for your own) edit and delete. */
export function MessageActions({
  m,
  own,
  canModerate,
  inThread,
  onReply,
  onThread,
  onPin,
  onReact,
  onEdit,
  onDelete,
}: Props) {
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const reactButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  return (
    <div className={`hact${picking || menuOpen ? ' open' : ''}`} role="toolbar" aria-label="Message actions">
      <button ref={reactButton} aria-label="React" title="React" onClick={() => setPicking(!picking)}>
        <Smile size={15} />
      </button>
      {picking && <EmojiPicker anchor={reactButton} onPick={onReact} onClose={() => setPicking(false)} />}
      <button aria-label="Reply" title="Reply" onClick={onReply}>
        <Reply size={15} />
      </button>
      {!inThread && !m.threadId && (
        <button aria-label="Thread" title="Reply in thread" onClick={onThread}>
          <MessageSquare size={15} />
        </button>
      )}
      {canModerate && (
        <button aria-label={m.pinned ? 'Unpin' : 'Pin'} title={m.pinned ? 'Unpin' : 'Pin'} onClick={onPin}>
          {m.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      )}
      {own && (
        <button
          ref={moreButton}
          aria-label="More"
          title="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={15} />
        </button>
      )}
      {menuOpen && (
        <Floating anchor={moreButton} onClose={() => setMenuOpen(false)} className="cmenu" role="menu" label="More">
          <button
            role="menuitem"
            aria-label="Edit"
            onClick={() => {
              setMenuOpen(false);
              onEdit();
            }}
          >
            <Pencil size={15} />
            <span>Edit message</span>
          </button>
          <button
            role="menuitem"
            className="danger"
            aria-label="Delete"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={15} />
            <span>Delete message</span>
          </button>
        </Floating>
      )}
    </div>
  );
}
