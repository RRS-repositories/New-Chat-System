import { useEffect, useRef } from 'react';
export const EMOJI_SET = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🙏', '🔥', '😮', '😢', '👏', '🤔'];
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="emoji-picker" ref={box} role="dialog" aria-label="Pick a reaction">
      {EMOJI_SET.map((e) => (
        <button
          key={e}
          className="emoji-btn"
          onClick={() => {
            onPick(e);
            onClose();
          }}
          aria-label={`React ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
