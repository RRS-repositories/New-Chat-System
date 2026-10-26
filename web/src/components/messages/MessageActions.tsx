import { useRef, useState } from 'react';
import { Copy, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Reply, Smile, Trash2 } from 'lucide-react';
import { useToast } from '../../context/ToastProvider.tsx';
import type { Message } from '../../types/index.ts';
import { Floating } from '../common/Floating.tsx';
import { EmojiPicker } from './EmojiPicker.tsx';
import { quickEmojis, recordEmojiUse } from '../../utils/quickEmojis.ts';

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

/** The small bar that appears on a message: react, reply, thread, pin, and a menu with copy text and (for your own) edit and delete. */
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
  const toast = useToast();
  // Copy the message's text (as written, so links and formatting marks come along) to the clipboard.
  const copyText = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(m.content);
      toast({ text: 'Message copied' });
    } catch {
      toast({ text: 'Could not copy: the browser did not allow it' });
    }
  };
  const reactButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  // The three reactions this person uses most, one tap away; a pick anywhere counts towards them.
  const quick = quickEmojis();
  const react = (emoji: string) => {
    recordEmojiUse(emoji);
    onReact(emoji);
  };
  return (
    <div className={`hact${picking || menuOpen ? ' open' : ''}`} role="toolbar" aria-label="Message actions">
      {quick.map((emoji) => (
        <button
          key={emoji}
          className="hq"
          aria-label={`React ${emoji}`}
          title={`React ${emoji}`}
          data-testid="quick-react"
          onClick={() => react(emoji)}
        >
          {emoji}
        </button>
      ))}
      <button ref={reactButton} aria-label="React" title="More reactions" onClick={() => setPicking(!picking)}>
        <Smile size={15} />
      </button>
      {picking && <EmojiPicker anchor={reactButton} onPick={react} onClose={() => setPicking(false)} />}
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
      <button
        ref={moreButton}
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="msg-more"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && (
        <Floating anchor={moreButton} onClose={() => setMenuOpen(false)} className="cmenu" role="menu" label="More">
          {m.content.trim() !== '' && (
            <button role="menuitem" aria-label="Copy text" data-testid="msg-copy" onClick={() => void copyText()}>
              <Copy size={15} />
              <span>Copy text</span>
            </button>
          )}
          {own && (
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
          )}
          {(own || canModerate) && (
            <button
              role="menuitem"
              className="danger"
              aria-label="Delete"
              data-testid="msg-delete"
              onClick={() => {
                setMenuOpen(false);
                onDelete(); // the message asks "Delete …?" inline before anything happens
              }}
            >
              <Trash2 size={15} />
              <span>{own ? 'Delete message' : 'Delete their message'}</span>
            </button>
          )}
        </Floating>
      )}
    </div>
  );
}
