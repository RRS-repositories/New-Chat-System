import path from 'node:path';
import { createReadStream } from 'node:fs';
import multer from 'multer';
import { httpError, sendError, wrap } from '../middleware/errors.js';
import { getFile, listChannelFiles } from '../models/files.model.js';
import { assertMember } from '../services/channels.service.js';
import { assertCanPost, announceMessage } from '../services/messages.service.js';
import { MAX_FILE_BYTES } from '../services/files/storage.js';
import { checkUploads, postFiles } from '../services/files/upload.service.js';
import { contentDisposition } from '../utils/filenames.js';
import { cleanMessageContent } from '../utils/sanitize.js';

const MAX_FILES = 5;

export function createFileController({ db, emit, uploadsDir, notifier = null }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } });

  /** The file's record, after checking it exists and the caller is in its channel. */
  const fileForMember = async (fileId, userId, { needsThumb = false } = {}) => {
    const file = await getFile(db, fileId);
    if (!file || (needsThumb && !file.thumbnailPath))
      throw httpError(404, 'not_found', needsThumb ? 'No thumbnail' : 'File not found');
    await assertMember(db, file.channelId, userId);
    return file;
  };
  const stream = (res, relPath) =>
    createReadStream(path.join(uploadsDir, relPath))
      .on('error', () => res.status(404).end())
      .pipe(res);

  return {
    /** Reads the uploaded files into memory; multer's own errors are answered in our error shape. */
    receive: (req, res, next) =>
      upload.array('files', MAX_FILES)(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE')
          return sendError(res, httpError(400, 'file_too_large', 'Files must be 20 MB or smaller'));
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
          return sendError(res, httpError(400, 'too_many_files', 'Up to 5 files per message'));
        return sendError(res, err);
      }),

    upload: wrap(async (req, res) => {
      const channelId = req.params.id;
      await assertCanPost(db, { channelId, userId: req.user.id });
      const files = req.files || [];
      checkUploads(files);
      const caption = req.body?.content && String(req.body.content).trim() ? cleanMessageContent(req.body.content) : '';
      const message = await postFiles(
        { db, uploadsDir },
        {
          channelId,
          userId: req.user.id,
          files,
          content: caption,
          replyToId: req.body?.replyToId || null,
          threadId: req.body?.threadId || null,
        },
      );
      announceMessage({ emit, notifier }, { message, channelId, sender: req.user });
      res.status(201).json({ success: true, message });
    }),

    download: wrap(async (req, res) => {
      const file = await fileForMember(req.params.id, req.user.id);
      // An SVG is never served as an image: it can carry script.
      res.setHeader('Content-Type', file.mimeType === 'image/svg+xml' ? 'application/octet-stream' : file.mimeType);
      res.setHeader('Content-Disposition', contentDisposition(file.filename));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      stream(res, file.filePath);
    }),

    thumbnail: wrap(async (req, res) => {
      const file = await fileForMember(req.params.id, req.user.id, { needsThumb: true });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      stream(res, file.thumbnailPath);
    }),

    listForChannel: wrap(async (req, res) => {
      await assertMember(db, req.params.id, req.user.id);
      const page = await listChannelFiles(db, req.params.id, {
        before: req.query.before || null,
        limit: req.query.limit || 30,
      });
      res.json({ success: true, ...page });
    }),
  };
}
