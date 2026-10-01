export const MAX_MESSAGE_LENGTH = 4000;

const fail = (code, message) => Object.assign(new Error(message), { code, status: 400 });

// Plain text only. Tags go, their text stays; "3 < 5" is prose, not a tag.
export function cleanMessageContent(raw) {
  let s = String(raw ?? '').replace(/\r\n?/g, '\n');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  s = s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (!s) throw fail('empty', 'Message is empty');
  if (s.length > MAX_MESSAGE_LENGTH) throw fail('too_long', `Message is over ${MAX_MESSAGE_LENGTH} characters`);
  return s;
}
