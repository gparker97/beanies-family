/**
 * Client-side image compression using canvas.
 *
 * Output: JPEG at ≤ MAX_DIMENSION px long edge, q = JPEG_QUALITY.
 * Text in photos must remain readable at zoom — the 2048px ceiling is
 * the main lever to balance quality against Drive upload time.
 *
 * HEIC decoding depends on the browser. Safari handles it natively;
 * Chromium / Firefox throw on `createImageBitmap(heicFile)`. Callers
 * should catch CompressionError and surface a friendly message.
 */

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;
/** Below this size AND already a small JPEG, skip recompression. */
const SMALL_BYTES_THRESHOLD = 256 * 1024;

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
}

export class CompressionError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CompressionError';
    this.cause = cause;
  }
}

/**
 * Compress a user-selected image File.
 * Returns a JPEG Blob with dimensions and mime.
 */
export async function compress(file: File): Promise<CompressedImage> {
  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';

    // Early return: small JPEGs that are already within the dimension cap
    // don't need recompression — we'd just re-encode for no benefit.
    if (isJpeg && file.size <= SMALL_BYTES_THRESHOLD && longEdge <= MAX_DIMENSION) {
      return { blob: file, width, height, mime: 'image/jpeg' };
    }

    const scale = longEdge > MAX_DIMENSION ? MAX_DIMENSION / longEdge : 1;
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CompressionError('Canvas 2D context unavailable');

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);

    return { blob, width: targetWidth, height: targetHeight, mime: 'image/jpeg' };
  } finally {
    bitmap.close?.();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch (e) {
    throw new CompressionError(
      `Could not decode image (${file.type || 'unknown type'}). HEIC files only decode in Safari.`,
      e
    );
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new CompressionError('Canvas toBlob returned null'));
        else resolve(blob);
      },
      type,
      quality
    );
  });
}
