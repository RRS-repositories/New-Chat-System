import type { CSSProperties } from 'react';
import { initials } from '../../utils/format.ts';
import { hueOf } from '../../utils/hue.ts';
import type { PresenceState } from '../../utils/presence.ts';
import { PresenceDot } from './PresenceDot.tsx';

type Props = {
  name: string;
  /** sm 22px · md 28px · (default) 34px · lg 44px · xl 78px */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** The person's photo, when they have one; otherwise their initials on their own colour. */
  src?: string | null;
  /** Shows the presence dot on the corner. */
  presence?: PresenceState;
  /** A symbol instead of initials (for a channel: # or a lock). */
  glyph?: string;
};

/** One avatar for the whole app: messages, sidebar, panels, search, calls. */
export function Avatar({ name, size, src, presence, glyph }: Props) {
  const avatar = (
    <span className={`uav${size ? ` ${size}` : ''}`} style={{ '--h': hueOf(name) } as CSSProperties} aria-hidden="true">
      {src ? <img src={src} alt="" /> : (glyph ?? initials(name))}
    </span>
  );
  if (!presence) return avatar;
  return (
    <span className="dmav">
      {avatar}
      <PresenceDot state={presence} />
    </span>
  );
}
