/**
 * Dictation text: what the browser heard, tidied the way a typist would type it. Pure: no browser.
 * The recognition itself is driven in services/dictation.ts; the composer puts the words in the box.
 */

/** One recognition result as the browser gives it: alternatives (we read the first) and whether it is settled. */
export type HeardResult = { isFinal: boolean; 0?: { transcript: string } };

/** Splits a result list into the words that are settled (from `from` on) and the words still being guessed. */
export function heard(results: ArrayLike<HeardResult>, from = 0): { finals: string[]; interim: string } {
  const finals: string[] = [];
  let interim = '';
  for (let i = Math.max(0, from); i < results.length; i++) {
    const result = results[i];
    const words = result?.[0]?.transcript ?? '';
    if (!result) continue;
    if (result.isFinal) finals.push(words);
    else interim += words;
  }
  return { finals, interim };
}

/** Marks people say aloud. Whole words only, case ignored; the longest phrases first. */
const SPOKEN_MARKS: Array<[RegExp, string]> = [
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\bnew line\b/gi, '\n'],
  [/\bfull stop\b/gi, '.'],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation mark\b/gi, '!'],
  [/\bcomma\b/gi, ','],
];

/** "hello team comma see the file full stop new line thanks" → "hello team, see the file.\nthanks" */
export function spokenMarks(words: string): string {
  let out = words;
  for (const [re, mark] of SPOKEN_MARKS) out = out.replace(re, mark);
  return out
    .replace(/[ \t]+([,.?!])/g, '$1') // no space before a mark
    .replace(/([,.?!])(?=[A-Za-z0-9])/g, '$1 ') // one space after it
    .replace(/[ \t]*\n[ \t]*/g, '\n') // none around a line break
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const endsSentence = (text: string) => /(^|[.?!]\s*|\n\s*)$/.test(text);
const capital = (s: string) => s.replace(/^[a-z]/, (c) => c.toUpperCase());

/**
 * Adds a spoken piece to what is already there: a space between words, none after a line break or
 * before a mark, and a capital letter at the start of a sentence.
 */
export function joinSpeech(before: string, piece: string): string {
  const words = piece.trim();
  if (!words) return before;
  const cased = endsSentence(before) ? capital(words) : words;
  if (!before || /\s$/.test(before) || /^[,.?!]/.test(cased)) return before + cased;
  return `${before} ${cased}`;
}

export type Range = { start: number; end: number };

/**
 * Puts the dictated text in place of the span it last occupied, so the words someone typed before
 * or after it stay where they were. Returns the new text and where the spoken span now ends.
 */
export function spliceSpoken(text: string, range: Range, spoken: string): { text: string; range: Range } {
  const start = Math.max(0, Math.min(range.start, text.length));
  const end = Math.max(start, Math.min(range.end, text.length));
  return {
    text: text.slice(0, start) + spoken + text.slice(end),
    range: { start, end: start + spoken.length },
  };
}

/** The whole spoken span: what is settled, then (while still being guessed) the interim words. */
export function spokenText(committed: string, interim: string): string {
  return joinSpeech(committed, spokenMarks(interim));
}

/** What to tell the person for a recognition error code. Null when it is nothing to mention. */
export function dictationProblem(code: string | undefined): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was refused. Allow it in the browser’s site settings.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Dictation needs an internet connection.';
    case 'language-not-supported':
      return 'Dictation does not support this language here.';
    default:
      return `Dictation stopped${code ? ` (${code})` : ''}.`;
  }
}
