/**
 * QR decoding from a user-supplied file (login rethink Phase 3): lets a family redeem
 * their recovery kit by uploading the saved kit PDF itself, or a photo/screenshot of
 * the printed QR — no 32-character transcription. `jsqr` and `pdfjs-dist` are
 * lazy-loaded so the login bundle stays lean (pdf.js only loads for an actual PDF).
 */

import { loadPdfjs, renderPdfPageToBlob } from '@/utils/pdfRender';

/** Downscale target — jsQR is O(pixels) and phone photos are huge. */
const MAX_DIM = 1600;

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
  if (!ctx) return null;
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
 * Decode a QR from an image OR the kit PDF itself. Returns the QR's text payload, or
 * null when nothing decodable was found (the caller shows a typed-code fallback).
 */
export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  try {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    return isPdf ? await decodeQrFromPdf(file) : await decodeQrFromBitmapSource(file);
  } catch {
    return null;
  }
}
