// Does a file's content match the type it claims to be?
//
// The type a browser reports for an upload is only a label chosen by the sender. Checking the
// first bytes stops, for example, a program renamed to "photo.jpg" being stored and passed on
// as a picture. Each allowed type has a known beginning.

const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

const isZip = (buf) => startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]);
/** Text: no NUL byte in the first 8 KB (a binary file almost always has one). */
const isText = (buf) => !buf.subarray(0, 8192).includes(0);

const isMp3 = (buf) =>
  startsWith(buf, ascii('ID3')) || (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
const isWav = (buf) => startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WAVE'), 8);

const CHECKS = {
  'image/jpeg': (buf) => startsWith(buf, [0xff, 0xd8, 0xff]),
  'image/png': (buf) => startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/gif': (buf) => startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a')),
  'image/webp': (buf) => startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8),
  'image/svg+xml': (buf) => isText(buf) && /<svg[\s>]/i.test(buf.subarray(0, 8192).toString('utf8')),
  'application/pdf': (buf) => startsWith(buf, ascii('%PDF-')),
  // Word, Excel and PowerPoint files are zip archives.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': isZip,
  'application/zip': isZip,
  'application/x-zip-compressed': isZip,
  'text/csv': isText,
  'text/plain': isText,
  'video/mp4': (buf) => startsWith(buf, ascii('ftyp'), 4),
  'video/webm': (buf) => startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]),
  // Sound. MP3: an ID3 tag, or straight into a frame (0xFF then the top three bits of the next byte set).
  'audio/mpeg': isMp3,
  'audio/mp3': isMp3,
  'audio/wav': isWav,
  'audio/x-wav': isWav,
  'audio/wave': isWav,
  'audio/vnd.wave': isWav,
  // M4A is an MP4 container, like the video.
  'audio/mp4': (buf) => startsWith(buf, ascii('ftyp'), 4),
  'audio/x-m4a': (buf) => startsWith(buf, ascii('ftyp'), 4),
  // Raw AAC (ADTS): 0xFFF sync.
  'audio/aac': (buf) => buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0,
  'audio/ogg': (buf) => startsWith(buf, ascii('OggS')),
  'audio/webm': (buf) => startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]),
};

/** True when the content begins the way a file of this type does. A type with no check is refused. */
export function contentMatchesType(mimeType, buffer) {
  const check = CHECKS[mimeType];
  if (!check || !Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  return check(buffer);
}

/** Every type that has a content check (kept in step with the upload allowlist by a test). */
export const CHECKED_TYPES = Object.keys(CHECKS);
