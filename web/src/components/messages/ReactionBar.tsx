import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import type { Reaction } from '../../types/index.ts';
import { EmojiPicker } from './EmojiPicker.tsx';
export function ReactionBar({
  reactions,
  selfId,
  onToggle,
}: {
  reactions: Reaction[];
  selfId: number;
  onToggle: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!reactions.length && !open) return null;
  return (
    <div className="reaction-bar">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className={`reaction-pill${r.userIds.includes(selfId) ? ' mine' : ''}`}
          onClick={() => onToggle(r.emoji)}
          title={`${r.count} ${r.count === 1 ? 'person' : 'people'}`}
        >
          <span>{r.emoji}</span>
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
      <span className="picker-anchor">
        <button className="reaction-pill add" aria-label="Add reaction" onClick={() => setOpen(true)}>
          <SmilePlus size={12} />
        </button>
        {open && <EmojiPicker onPick={onToggle} onClose={() => setOpen(false)} />}
      </span>
    </div>
  );
}
