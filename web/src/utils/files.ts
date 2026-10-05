export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 5;
const EXT = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'csv',
  'txt',
  'zip',
  'mp4',
  'webm',
];
export const ACCEPT = EXT.map((e) => `.${e}`).join(',');
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}
export function validateFiles(files: File[]): { ok: File[]; errors: string[] } {
  const ok: File[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!EXT.includes(ext)) {
      errors.push(`${f.name}: this file type is not allowed`);
      continue;
    }
    if (f.size > MAX_FILE_BYTES) {
      errors.push(`${f.name}: files must be 20 MB or smaller`);
      continue;
    }
    ok.push(f);
  }
  if (ok.length > MAX_FILES) {
    errors.push(`Up to ${MAX_FILES} files per message`);
    ok.length = MAX_FILES;
  }
  return { ok, errors };
}
export const isImage = (mime: string) => /^image\/(jpeg|png|gif|webp)$/.test(mime);
export const isVideo = (mime: string) => /^video\/(mp4|webm)$/.test(mime);

const KINDS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word document',
  xlsx: 'Spreadsheet',
  pptx: 'Presentation',
  csv: 'Spreadsheet',
  txt: 'Text',
  zip: 'Archive',
  svg: 'Image',
  webm: 'Recording',
  mp4: 'Video',
};
/** A plain word for what a file is, shown on its card: "PDF", "Spreadsheet", "Image". */
export function fileKind(mime: string, filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (KINDS[ext]) return KINDS[ext];
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime.startsWith('video/')) return 'Video';
  return 'File';
}
