/**
 * The three reactions offered on every message's hover bar: the ones this person uses most on
 * this device, topped up with the usual ones. Counts live in the browser.
 */
export const DEFAULT_QUICK = ['👍', '❤️', '😂'];
export const QUICK_COUNT = 3;
const KEY = 'chat.emojiUse';

type Counts = Record<string, number>;

function readCounts(): Counts {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Remembers that this emoji was used as a reaction. */
export function recordEmojiUse(emoji: string): void {
  if (!emoji) return;
  const counts = readCounts();
  counts[emoji] = (counts[emoji] || 0) + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(counts));
  } catch {
    /* private mode: the choice is not kept */
  }
}

/** The quick reactions from a set of counts: most used first, the defaults filling the rest. */
export function pickQuick(counts: Counts, defaults: string[] = DEFAULT_QUICK, n = QUICK_COUNT): string[] {
  const used = Object.entries(counts)
    .filter(([e, c]) => e && c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([e]) => e);
  const out: string[] = [];
  for (const e of [...used, ...defaults]) {
    if (!out.includes(e)) out.push(e);
    if (out.length === n) break;
  }
  return out;
}

/** The quick reactions for this device. */
export function quickEmojis(): string[] {
  return pickQuick(readCounts());
}
