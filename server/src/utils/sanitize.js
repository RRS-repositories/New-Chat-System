export const MAX_MESSAGE_LENGTH = 4000;

const fail = (code, message) => Object.assign(new Error(message), { code, status: 400 });

// Code is kept exactly as typed: a fenced block (``` … ```, or to the end of the message when it is
// never closed) and `inline code` on one line. Everything the chat shows is drawn as text, never as
// HTML, so keeping "<div>" inside code is safe.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]+`/g;

// Ordinary text: tags go and their text stays ("3 < 5" is prose, not a tag); runs of spaces become one.
const tidy = (text) =>
  text
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');

/** A message as it will be stored: plain text, tidied, with code left alone. Refuses empty and over-long messages. */
export function cleanMessageContent(raw) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  let out = '';
  let last = 0;
  for (const code of text.matchAll(CODE)) {
    out += tidy(text.slice(last, code.index)) + code[0];
    last = code.index + code[0].length;
  }
  out = (out + tidy(text.slice(last))).trim();
  if (!out) throw fail('empty', 'Message is empty');
  if (out.length > MAX_MESSAGE_LENGTH) throw fail('too_long', `Message is over ${MAX_MESSAGE_LENGTH} characters`);
  return out;
}
