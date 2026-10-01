// Pure helpers for message search: the words to look for, the LIKE patterns, and the excerpt shown.

export const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 64;
const SNIPPET_CHARS = 160;
const LEAD_CHARS = 40;

/** The separate words of a query: trimmed, without duplicates (case ignored), at most MAX_TERMS. */
export function searchTerms(query) {
  const seen = new Set();
  const terms = [];
  for (const word of String(query || '').split(/\s+/)) {
    const term = word.slice(0, MAX_TERM_LENGTH);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** "contains this text" for LIKE/ILIKE, with the wildcard characters in the text itself made literal. */
export const likePattern = (term) => `%${String(term).replace(/[\\%_]/g, '\\$&')}%`;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termsRegExp(terms) {
  const parts = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return parts.length ? new RegExp(parts.join('|'), 'gi') : null;
}

/**
 * A short excerpt of `content` around the first place a search word appears, with every
 * appearance wrapped in <b>…</b> (the web app splits on exactly those markers).
 * Returns null when none of the words is in the text (the message matched some other way).
 */
export function excerpt(content, terms) {
  const text = String(content || '');
  const re = termsRegExp(terms);
  if (!re) return null;
  const first = re.exec(text);
  if (!first) return null;
  const matchEnd = first.index + first[0].length;
  let start = Math.max(0, first.index - LEAD_CHARS);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < first.index) start = space + 1;
  }
  let end = Math.min(text.length, Math.max(start + SNIPPET_CHARS, matchEnd));
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > matchEnd) end = space;
  }
  const marked = text.slice(start, end).replace(termsRegExp(terms), '<b>$&</b>');
  return `${start > 0 ? '… ' : ''}${marked}${end < text.length ? ' …' : ''}`;
}
