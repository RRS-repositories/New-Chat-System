/**
 * A counter for "which query is showing": `next()` starts a new one, and work
 * captured under an older value (`current()` at the time) can tell it is stale.
 */
export function generation() {
  let n = 0;
  return { next: () => ++n, current: () => n, isCurrent: (g: number) => g === n };
}

/**
 * Guards against out-of-order responses: each call gets an increasing ticket,
 * and only the newest call's promise yields its value (or error). An older one
 * resolves to `undefined` once a newer call exists, so a slow earlier response
 * can never overwrite a newer result.
 */
export function latestOnly<T>(): (p: Promise<T>) => Promise<T | undefined> {
  let newest = 0;
  return async (p) => {
    const ticket = ++newest;
    try {
      const v = await p;
      return ticket === newest ? v : undefined;
    } catch (e) {
      if (ticket !== newest) return undefined;
      throw e;
    }
  };
}
