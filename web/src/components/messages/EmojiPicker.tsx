import type { RefObject } from 'react';
import { EMOJI_SET } from '../../utils/emojiSet.ts';
import { Floating } from '../common/Floating.tsx';

export { EMOJI_SET };

type Props = {
  /** The button that opened the picker. */
  anchor: RefObject<HTMLElement | null>;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** What picking does, for screen readers: "React" or "Insert". */
  verb?: string;
};

/** A grid of big emoji beside the button that opened it; it scrolls when there are more than fit. */
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
