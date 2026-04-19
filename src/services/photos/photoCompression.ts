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

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_JPEG_QUALITY = 0.85;
/** Below this size AND already a small JPEG, skip recompression. */
const SMALL_BYTES_THRESHOLD = 256 * 1024;

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
}

export interface CompressOptions {
  /** Long-edge pixel cap. Defaults to 2048. Avatars typically pass 1024. */
  maxDimension?: number;
  /** JPEG quality, 0–1. Defaults to 0.85. Avatars typically pass 0.92 (faces). */
  quality?: number;
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
 *
 * Options let callers tune the long-edge cap and JPEG quality — e.g. avatar
 * uploads pass `{ maxDimension: 1024, quality: 0.92 }` because faces benefit
 * from a tighter resolution + higher quality than general photos.
 */
export async function compress(
  file: File,
  options: CompressOptions = {}
): Promise<CompressedImage> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_JPEG_QUALITY;

  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';

    // Early return: small JPEGs that are already within the dimension cap
    // don't need recompression — we'd just re-encode for no benefit.
    if (isJpeg && file.size <= SMALL_BYTES_THRESHOLD && longEdge <= maxDimension) {
      return { blob: file, width, height, mime: 'image/jpeg' };
    }

    const scale = longEdge > maxDimension ? maxDimension / longEdge : 1;
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CompressionError('Canvas 2D context unavailable');

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);

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
