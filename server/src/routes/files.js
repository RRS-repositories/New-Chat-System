import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { httpError, wrap, sendError } from '../http-errors.js';
import { isMember } from '../repo/channels.js';
import { createMessage, getMessage } from '../repo/messages.js';
import { insertFile, getFile, listChannelFiles } from '../repo/files.js';
import { cleanMessageContent } from '../sanitize.js';
import { dmPostBlocked, DM_BLOCKED_MESSAGE } from '../repo/restrictions.js';
import { ALLOWED_MIME, MAX_FILE_BYTES, saveUpload, makeThumbnail, removeUpload } from '../files/storage.js';

// busboy/multer decode multipart filenames as latin1; browsers send UTF-8.
const utf8Name = (name) => Buffer.from(String(name || ''), 'latin1').toString('utf8').split(/[\\/]/).pop() || 'file';
// RFC 6266: an ASCII fallback in filename= plus the real name in filename*=.
const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

export function createFileRoutes({ db, emit, uploadsDir, limiter, notifier = null }) {
  const r = Router();
  const mustBeMember = async (channelId, userId) => {
    if (!(await isMember(db, channelId, userId))) throw httpError(403, 'not_member', 'You are not in this channel');
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 5 } });

  // multer errors arrive as the next(err) of the middleware; map them to our JSON shape.
  const receive = (req, res, next) => upload.array('files', 5)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, httpError(400, 'file_too_large', 'Files must be 20 MB or smaller'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return sendError(res, httpError(400, 'too_many_files', 'Up to 5 files per message'));
    return sendError(res, err);
  });

  r.post('/channels/:id/upload', limiter, receive, wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    // Same rule as a text message: a dm/all restriction stops posting into an existing DM.
    if (await dmPostBlocked(db, { channelId: req.params.id, userId: req.user.id })) throw httpError(403, 'restricted', DM_BLOCKED_MESSAGE);
    const files = req.files || [];
    if (!files.length) throw httpError(400, 'no_files', 'Attach at least one file');
    for (const f of files) f.originalname = utf8Name(f.originalname);
    for (const f of files) if (!ALLOWED_MIME.has(f.mimetype)) throw httpError(400, 'file_type', `${f.originalname}: file type not allowed`);
    let content = '';
    if (req.body?.content && String(req.body.content).trim()) content = cleanMessageContent(req.body.content);
    const saved = [];
    try {
      for (const f of files) {
        const { relPath } = await saveUpload({ uploadsDir, channelId: req.params.id, filename: f.originalname, buffer: f.buffer });
        saved.push({ f, relPath, thumb: await makeThumbnail({ uploadsDir, relPath, mime: f.mimetype }) });
      }
      const created = await createMessage(db, { channelId: req.params.id, userId: req.user.id, content, type: 'file', replyToId: req.body?.replyToId || null, threadId: req.body?.threadId || null });
      for (const s of saved) {
        await insertFile(db, { messageId: created.id, channelId: req.params.id, userId: req.user.id, filename: s.f.originalname, mimeType: s.f.mimetype, sizeBytes: s.f.size, filePath: s.relPath, thumbnailPath: s.thumb });
      }
      const message = await getMessage(db, created.id);
      emit.toChannel(req.params.id, 'new_message', { message, channel_id: req.params.id });
      void notifier?.onMessage({ message, channelId: req.params.id, senderId: req.user.id, senderName: req.user.fullName, mentionedUserIds: [], mentionAll: false });
      res.status(201).json({ success: true, message });
    } catch (e) {
      for (const s of saved) { await removeUpload(uploadsDir, s.relPath); await removeUpload(uploadsDir, s.thumb); }
      throw e;
    }
  }));

  r.get('/files/:id/download', wrap(async (req, res) => {
    const file = await getFile(db, req.params.id);
    if (!file) throw httpError(404, 'not_found', 'File not found');
    await mustBeMember(file.channelId, req.user.id);
    const type = file.mimeType === 'image/svg+xml' ? 'application/octet-stream' : file.mimeType;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', contentDisposition(file.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(path.join(uploadsDir, file.filePath)).on('error', () => res.status(404).end()).pipe(res);
  }));

  r.get('/files/:id/thumb', wrap(async (req, res) => {
    const file = await getFile(db, req.params.id);
    if (!file || !file.thumbnailPath) throw httpError(404, 'not_found', 'No thumbnail');
    await mustBeMember(file.channelId, req.user.id);
    res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=86400');
    createReadStream(path.join(uploadsDir, file.thumbnailPath)).on('error', () => res.status(404).end()).pipe(res);
  }));

  r.get('/channels/:id/files', wrap(async (req, res) => {
    await mustBeMember(req.params.id, req.user.id);
    res.json({ success: true, ...(await listChannelFiles(db, req.params.id, { before: req.query.before || null, limit: req.query.limit || 30 })) });
  }));

  return r;
}
