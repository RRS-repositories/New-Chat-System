// Profile photos: check what was uploaded, turn it into one small square JPEG, store it.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { httpError } from '../../middleware/errors.js';
import { avatarUrl, clearAvatar, setAvatar } from '../../models/avatars.model.js';
import { contentMatchesType } from '../../utils/fileSignature.js';
import { removeUpload } from './storage.js';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 256;
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FOLDER = 'avatars';

/**
 * Saves a person's profile photo and returns its address.
 * Whatever is sent is re-made here as a 256 by 256 JPEG, so nothing but a plain picture is ever
 * stored or served: no hidden data, no oversized image, no other file type under a picture's name.
 */
export async function saveAvatar({ db, uploadsDir }, { userId, file, now = new Date() }) {
  if (!file) throw httpError(400, 'no_file', 'Choose a picture');
  if (!AVATAR_TYPES.has(file.mimetype))
    throw httpError(400, 'file_type', 'A profile photo must be a JPEG, PNG or WebP picture');
  if (!contentMatchesType(file.mimetype, file.buffer))
    throw httpError(400, 'file_content', 'That file is not the picture it says it is');

  let jpeg;
  try {
    jpeg = await sharp(file.buffer, { animated: false })
      .rotate()
      .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw httpError(400, 'file_content', 'That picture could not be read');
  }

  const relPath = path.posix.join(FOLDER, `${userId}-${randomUUID()}.jpg`);
  await mkdir(path.join(uploadsDir, FOLDER), { recursive: true });
  await writeFile(path.join(uploadsDir, relPath), jpeg, { flag: 'wx' });
  let oldPath;
  try {
    oldPath = await setAvatar(db, userId, relPath, now);
  } catch (e) {
    await removeUpload(uploadsDir, relPath);
    throw e;
  }
  await removeUpload(uploadsDir, oldPath);
  return avatarUrl(userId, now);
}

/** Removes a person's profile photo. True when there was one. */
export async function removeAvatar({ db, uploadsDir }, { userId }) {
  const oldPath = await clearAvatar(db, userId);
  await removeUpload(uploadsDir, oldPath);
  return !!oldPath;
}
