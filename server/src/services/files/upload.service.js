// Sharing files: check them, put them on disk, and post the message that carries them.
import { httpError } from '../../middleware/errors.js';
import { createMessage, getMessage } from '../../models/messages.model.js';
import { insertFile } from '../../models/files.model.js';
import { utf8Name } from '../../utils/filenames.js';
import { ALLOWED_MIME, saveUpload, makeThumbnail, removeUpload } from './storage.js';

/** Fixes the names and refuses an empty upload or a file type that is not allowed. */
export function checkUploads(files) {
  if (!files.length) throw httpError(400, 'no_files', 'Attach at least one file');
  for (const file of files) file.originalname = utf8Name(file.originalname);
  for (const file of files) {
    if (!ALLOWED_MIME.has(file.mimetype)) throw httpError(400, 'file_type', `${file.originalname}: file type not allowed`);
  }
}

/**
 * Saves the files and creates one `file` message that carries them. If anything fails part-way,
 * whatever was written to disk is removed again. Returns the stored message with its files.
 */
export async function postFiles({ db, uploadsDir }, { channelId, userId, files, content, replyToId = null, threadId = null }) {
  const saved = [];
  try {
    for (const file of files) {
      const { relPath } = await saveUpload({ uploadsDir, channelId, filename: file.originalname, buffer: file.buffer });
      saved.push({ file, relPath, thumb: await makeThumbnail({ uploadsDir, relPath, mime: file.mimetype }) });
    }
    const created = await createMessage(db, { channelId, userId, content, type: 'file', replyToId, threadId });
    for (const { file, relPath, thumb } of saved) {
      await insertFile(db, {
        messageId: created.id,
        channelId,
        userId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        filePath: relPath,
        thumbnailPath: thumb,
      });
    }
    return await getMessage(db, created.id);
  } catch (e) {
    for (const { relPath, thumb } of saved) {
      await removeUpload(uploadsDir, relPath);
      await removeUpload(uploadsDir, thumb);
    }
    throw e;
  }
}
