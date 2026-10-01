/**
 * A small first-in-first-out cache of object URLs. Used for thumbnails only: they are small,
 * shown again and again, and capped here. When the cache is full the oldest URL is released.
 */
export function createBlobCache(max: number) {
  const urls = new Map<string, string>();
  return {
    get: (key: string) => urls.get(key),
    set(key: string, url: string) {
      if (urls.size >= max) {
        const [oldestKey, oldestUrl] = urls.entries().next().value as [string, string];
        urls.delete(oldestKey);
        URL.revokeObjectURL(oldestUrl);
      }
      urls.set(key, url);
    },
  };
}
