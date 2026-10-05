import { useAvatarSrc } from '../../hooks/useAvatarSrc.ts';
import type { PresenceState } from '../../utils/presence.ts';
import { Avatar } from './Avatar.tsx';

type Props = {
  userId: number | null | undefined;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  presence?: PresenceState;
};

/** A person's avatar: their profile photo when they have one, otherwise their initials on their own colour. */
export function UserAvatar({ userId, name, size, presence }: Props) {
  const src = useAvatarSrc(userId);
  return <Avatar name={name} size={size} src={src} presence={presence} />;
}
