import { useCallback, useSyncExternalStore } from 'react';
import { avatarStore } from '../services/avatars.ts';

/**
 * The address of a person's profile photo for an <img>, or null when they have none (or it has not
 * loaded yet). Only this person's avatars redraw when their photo changes.
 */
export function useAvatarSrc(userId: number | null | undefined): string | null {
  const subscribe = useCallback((listener: () => void) => avatarStore.subscribe(userId, listener), [userId]);
  return useSyncExternalStore(subscribe, () => avatarStore.get(userId));
}
