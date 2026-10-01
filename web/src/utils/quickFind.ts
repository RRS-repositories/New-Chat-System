/** Finds people and channels by name for the search panel. Pure: no server call. */

export const QUICK_FIND_LIMIT = 5;

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * 0 = no match. Otherwise higher is better: every word typed must appear in the name;
 * a name where a word starts with what was typed ("ann" in "Ann Agent") beats one that only
 * contains it ("ann" in "Joanne").
 */
export function nameScore(name: string, query: string): number {
  const typed = words(query);
  if (!typed.length) return 0;
  const lower = name.toLowerCase();
  const parts = words(name);
  let score = 1;
  for (const term of typed) {
    if (!lower.includes(term)) return 0;
    if (parts.some((part) => part.startsWith(term))) score += 1;
  }
  return score;
}

/** The best few items whose name matches, best first; ties keep alphabetical order. */
export function quickFind<T>(items: T[], nameOf: (item: T) => string, query: string, limit = QUICK_FIND_LIMIT): T[] {
  return items
    .map((item) => ({ item, name: nameOf(item), score: nameScore(nameOf(item), query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => entry.item);
}
