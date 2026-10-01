/** Multipart filenames arrive decoded as latin1; browsers send UTF-8. Also drops any path. */
export const utf8Name = (name) =>
  Buffer.from(String(name || ''), 'latin1')
    .toString('utf8')
    .split(/[\\/]/)
    .pop() || 'file';

/** RFC 6266 download header: an ASCII fallback in filename= plus the real name in filename*=. */
export const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};
