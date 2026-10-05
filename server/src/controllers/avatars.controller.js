import path from 'node:path';
import { createReadStream } from 'node:fs';
import multer from 'multer';
import { httpError, sendError, wrap } from '../middleware/errors.js';
import { getAvatar } from '../models/avatars.model.js';
import { AVATAR_MAX_BYTES, removeAvatar, saveAvatar } from '../services/files/avatar.service.js';

/** Profile photos: upload your own, remove it, and fetch anyone's (signed-in people only). */
export function createAvatarController({ db, emit, uploadsDir }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });

  // Everyone's open tabs swap the picture at once. A failed broadcast must not fail a saved photo.
  const tellEveryone = (userId, url) => {
    try {
      emit?.toAll?.('user_updated', { user_id: userId, avatar_url: url });
    } catch (e) {
      console.error('[chat] user_updated broadcast failed', e?.message || e);
    }
  };

  return {
    /** Reads the one uploaded picture into memory; multer's own errors are answered in our error shape. */
    receive: (req, res, next) =>
      upload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE')
          return sendError(res, httpError(400, 'file_too_large', 'A profile photo must be 2 MB or smaller'));
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
          return sendError(res, httpError(400, 'too_many_files', 'Send one picture'));
        return sendError(res, err);
      }),

    save: wrap(async (req, res) => {
      const url = await saveAvatar({ db, uploadsDir }, { userId: req.user.id, file: req.file });
      tellEveryone(req.user.id, url);
      res.json({ success: true, avatarUrl: url });
    }),

    remove: wrap(async (req, res) => {
      if (await removeAvatar({ db, uploadsDir }, { userId: req.user.id })) tellEveryone(req.user.id, null);
      res.json({ success: true, avatarUrl: null });
    }),

    /** The picture itself. Its address changes whenever the photo does, so browsers may keep it for a long time. */
    show: wrap(async (req, res) => {
      const userId = parseInt(req.params.id, 10);
      const avatar = Number.isInteger(userId) && userId > 0 ? await getAvatar(db, userId) : null;
      if (!avatar) throw httpError(404, 'not_found', 'No profile photo');
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(path.join(uploadsDir, avatar.path))
        .on('error', () => res.status(404).end())
        .pipe(res);
    }),
  };
}
