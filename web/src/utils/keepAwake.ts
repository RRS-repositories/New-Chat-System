/**
 * Asks the browser not to freeze or put this tab to sleep while the chat is open in it.
 *
 * Chromium browsers (Edge, Chrome) freeze background tabs and Edge puts them to sleep; a frozen page
 * cannot answer the server's pings, so after a minute the person shows Offline although the chat is
 * open and they are only working in another app. A page that holds a Web Lock is not frozen, so one
 * shared lock is held for as long as the page lives. Nothing else depends on it: where Web Locks do
 * not exist (older browsers) the chat works as before.
 */
export const PRESENCE_LOCK = 'chat-presence';
const held = new WeakSet<object>();

export function holdPresenceLock(
  locks: Pick<LockManager, 'request'> | null | undefined = typeof navigator !== 'undefined'
    ? navigator.locks
    : undefined,
): boolean {
  if (!locks || typeof locks.request !== 'function') return false;
  if (held.has(locks)) return true;
  try {
    held.add(locks);
    void locks.request(PRESENCE_LOCK, { mode: 'shared' }, () => new Promise<void>(() => {})).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
