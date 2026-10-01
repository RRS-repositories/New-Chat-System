import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['text/csv', 'csv'],
  ['text/plain', 'txt'],
  ['application/zip', 'zip'],
  ['application/x-zip-compressed', 'zip'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
]);
const THUMB_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export const THUMB_WIDTH = 200;

export function safeFilename(name) {
  const base =
    String(name || '')
      .split(/[\\/]/)
      .pop() || '';
  const clean = base
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(0, 120);
  return clean || 'file';
}

export async function saveUpload({ uploadsDir, channelId, filename, buffer }) {
  const relPath = path.posix.join(channelId, `${randomUUID()}-${safeFilename(filename)}`);
  const absPath = path.join(uploadsDir, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer, { flag: 'wx' });
  return { relPath, absPath };
}

export async function makeThumbnail({ uploadsDir, relPath, mime }) {
  if (!THUMB_MIME.has(mime)) return null;
  const thumbRel = path.posix.join('thumbs', `${randomUUID()}.jpg`);
  await mkdir(path.join(uploadsDir, 'thumbs'), { recursive: true });
  try {
    await sharp(path.join(uploadsDir, relPath), { animated: false })
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: false })
      .jpeg({ quality: 80 })
      .toFile(path.join(uploadsDir, thumbRel));
    return thumbRel;
  } catch (e) {
    console.error('[chat] thumbnail failed', e.message);
    return null;
  }
}

export async function removeUpload(uploadsDir, relPath) {
  if (!relPath) return;
  await unlink(path.join(uploadsDir, relPath)).catch(() => {});
}
