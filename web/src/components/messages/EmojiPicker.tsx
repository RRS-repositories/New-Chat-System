import type { RefObject } from 'react';
import { Floating } from '../common/Floating.tsx';

export const EMOJI_SET = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🙏', '🔥', '😮', '😢', '👏', '🤔'];

type Props = {
  /** The button that opened the picker. */
  anchor: RefObject<HTMLElement | null>;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** What picking does, for screen readers: "React" or "Insert". */
  verb?: string;
};

/** A small pill of emoji beside the button that opened it. */
export function EmojiPicker({ anchor, onPick, onClose, verb = 'React' }: Props) {
  return (
    <Floating anchor={anchor} onClose={onClose} className="epick" prefer="above" role="dialog" label="Pick an emoji">
      {EMOJI_SET.map((emoji) => (
        <button
          key={emoji}
          className="emoji-btn"
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
          aria-label={`${verb} ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </Floating>
  );
}
