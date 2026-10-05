import { useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import type { Reaction } from '../../types/index.ts';
import { EmojiPicker } from './EmojiPicker.tsx';

type Props = {
  reactions: Reaction[];
  selfId: number;
  onToggle: (emoji: string) => void;
};

/** The row of reaction pills under a message. Yours are tinted; pressing one adds or removes yours. */
export function ReactionBar({ reactions, selfId, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  if (!reactions.length) return null;
  return (
    <div className="rxrow reaction-bar">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className={`rx reaction-pill${r.userIds.includes(selfId) ? ' me mine' : ''}`}
          onClick={() => onToggle(r.emoji)}
          title={`${r.count} ${r.count === 1 ? 'person' : 'people'}`}
        >
          <span className="e">{r.emoji}</span>
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
      <button ref={addButton} className="rx add" aria-label="Add reaction" onClick={() => setOpen(!open)}>
        <SmilePlus size={13} />
      </button>
      {open && <EmojiPicker anchor={addButton} onPick={onToggle} onClose={() => setOpen(false)} />}
    </div>
  );
}
