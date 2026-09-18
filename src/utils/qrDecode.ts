/**
 * QR decoding from a user-supplied file (login rethink Phase 3): lets a family redeem
 * their recovery kit by uploading the saved kit PDF itself, or a photo/screenshot of
 * the printed QR — no 32-character transcription. `jsqr` and `pdfjs-dist` are
 * lazy-loaded so the login bundle stays lean (pdf.js only loads for an actual PDF).
 */

import { loadPdfjs, renderPdfPageToBlob } from '@/utils/pdfRender';

/**
 * Set when `getContext('2d')` refuses, so the caller can tell a device-capability failure
 * from an honest "no code in this image". Reset per call by `decodeQrFromImageFile`.
 */
let canvasUnavailable = false;

/** Downscale target — jsQR is O(pixels) and phone photos are huge. */
const MAX_DIM = 1600;

/**
 * Why a decode failed. FOUR reasons, because the single `null` this used to return covered
 * four genuinely different situations that need four different things said to the user:
 * only `no-code` is the person's doing, `unsupported-device` wants "try the saved PDF
 * instead", and `decoder-unavailable` is an offline first-load that will work on a retry.
 * Collapsing them meant "we couldn't find a code in that photo" was shown to someone whose
 * browser had simply failed to fetch a chunk.
 */
export type QrDecodeFailure =
  'no-code' | 'unreadable-image' | 'unsupported-device' | 'decoder-unavailable';

export type QrDecodeResult =
  { ok: true; data: string } | { ok: false; reason: QrDecodeFailure; cause?: unknown };

async function decodeQrFromBitmapSource(source: Blob): Promise<string | null> {
  const [{ default: jsQR }, bitmap] = await Promise.all([
    import('jsqr'),
    createImageBitmap(source),
  ]);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Memory pressure or a hardened browser. NOT "no code in this photo" — the photo was
    // never looked at.
    canvasUnavailable = true;
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const result = jsQR(imageData.data, width, height);
  return result?.data ?? null;
}

/** Render page 1 of a PDF (the kit is one page) and scan it for a QR. */
async function decodeQrFromPdf(file: File): Promise<string | null> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await doc.getPage(1);
    const blob = await renderPdfPageToBlob(page, MAX_DIM, 0.95);
    return await decodeQrFromBitmapSource(blob);
  } finally {
    await doc.destroy();
  }
}

/**
 * Decode a QR from an image OR the kit PDF itself.
 *
 * ⚠️ The `cause` is carried on the failure rather than being swallowed, so the ONE place
 * that reports can attach a real stack. Callers that re-report a bare reason string produce
 * a CloudWatch entry with nothing behind it.
 */
export async function decodeQrFromImageFile(file: File): Promise<QrDecodeResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  canvasUnavailable = false;
  try {
    const data = isPdf ? await decodeQrFromPdf(file) : await decodeQrFromBitmapSource(file);
    if (data !== null) return { ok: true, data };
    // A null from the decoders means one of two things, and they are not the same: the
    // canvas was unavailable (device capability) or jsQR genuinely found nothing.
    return canvasUnavailable
      ? { ok: false, reason: 'unsupported-device' }
      : { ok: false, reason: 'no-code' };
  } catch (cause) {
    // A rejected `import('jsqr')` / `loadPdfjs()` is an offline first-load, which retries
    // fine once the chunk is cached. Anything else is the file itself.
    const isChunkFailure =
      cause instanceof Error && /import|chunk|dynamically imported module/i.test(cause.message);
    return {
      ok: false,
      reason: isChunkFailure ? 'decoder-unavailable' : 'unreadable-image',
      cause,
    };
  }
}
