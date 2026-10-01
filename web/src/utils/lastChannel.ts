import { STORAGE_KEYS } from '../config/constants.ts';

/** Remembers the channel a person last had open, so the app reopens it next time. Storage may be unavailable (private mode). */
export function rememberLastChannel(channelId: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.lastChannel, channelId);
  } catch {
    /* storage unavailable */
  }
}

export function readLastChannel(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.lastChannel);
  } catch {
    return null;
  }
}
