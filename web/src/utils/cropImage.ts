/** Profile photos are cut to a square and shrunk in the browser before they are sent. */
export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';

/** The largest centred square inside a picture: where to cut it from. */
export function centreSquare(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), side };
}

/** A picture file → a 256 by 256 JPEG, cut from its centre. Rejects when the file is not a picture the browser can read. */
export async function squareJpeg(file: Blob, size = AVATAR_SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { x, y, side } = centreSquare(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the picture');
    context.drawImage(bitmap, x, y, side, side, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the picture'))),
        'image/jpeg',
        0.85,
      ),
    );
  } finally {
    bitmap.close();
  }
}
