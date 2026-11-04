/**
 * Emoji inside message text. Two rules (the owner, 4 Nov 2026: "its still very small"):
 *  - a message that is nothing but emoji (up to JUMBO_MAX of them) is shown big;
 *  - an emoji among words is shown a little larger than the words, so it can be made out.
 * Everything here works on graphemes, so a flag, a skin tone or a family counts as one emoji.
 */
export const JUMBO_MAX = 8;
/** Up to this many emoji alone in a message are shown at the largest size; more of them a step smaller. */
export const JUMBO_FEW = 3;

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** The graphemes of a string. Without Intl.Segmenter (very old browsers) each code point is one. */
export function graphemes(text: string): string[] {
  return segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];
}

/** True for one grapheme that is an emoji (a pictograph or a flag half), not a plain digit or #. */
export const isEmoji = (grapheme: string): boolean => EMOJI.test(grapheme);

/**
 * How many emoji a message is made of when it is made of nothing else (spaces between them are
 * fine). 0 when it has any other character, or more than JUMBO_MAX emoji.
 */
export function emojiOnlyCount(text: string): number {
  const parts = graphemes(text.trim()).filter((g) => g.trim() !== '');
  if (!parts.length || parts.length > JUMBO_MAX) return 0;
  return parts.every(isEmoji) ? parts.length : 0;
}

/** Text split into alternating runs: `{ emoji: false }` for words, `{ emoji: true }` for emoji. */
export function splitEmoji(text: string): { text: string; emoji: boolean }[] {
  const out: { text: string; emoji: boolean }[] = [];
  for (const g of graphemes(text)) {
    const emoji = isEmoji(g);
    const last = out[out.length - 1];
    if (last && last.emoji === emoji) last.text += g;
    else out.push({ text: g, emoji });
  }
  return out;
}
