// Rasterize the first pages of a PDF to JPEG Files for AI extraction.
//
// The managed extraction Lambda and the vision models it proxies are image-based, so
// a picked PDF must be rasterized to images before extraction. We render up to
// MAX_EXTRACT_PAGES pages; the model reads them as the pages of ONE document and
// returns a single merged result. The full original PDF is still attached to the
// item, so nothing is lost past the cap.
//
// pdfjs-dist is reached ONLY through pdfRender's `renderPdfPages` → `loadPdfjs()`
// dynamic import. This module deliberately does NOT statically import pdfjs-dist, so
// it stays out of the main bundle even though the extraction service imports it
// statically (for `isPdfFile`).

import { renderPdfPages } from './pdfRender';

/** True for a PDF by mime or extension (covers pickers that omit the mime). */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * Max PDF pages read per extraction. This is the PRODUCT cap — it bounds cost,
 * latency, and request payload. It is intentionally decoupled from the Lambda's
 * looser `MAX_IMAGES` server-side backstop; do not "reconcile" the two to match.
 */
export const MAX_EXTRACT_PAGES = 5;

/**
 * Long-edge px for each rendered page. 1600px is ample for document OCR and keeps a
 * full MAX_EXTRACT_PAGES payload comfortably under the Lambda body cap.
 */
const EXTRACT_LONG_EDGE = 1600;

export interface ExtractionImages {
  /** One JPEG File per rendered page, in page order (always ≥1). */
  files: File[];
  /** True when the PDF had more pages than MAX_EXTRACT_PAGES (extra pages dropped). */
  truncated: boolean;
}

/**
 * Rasterize up to MAX_EXTRACT_PAGES pages of a PDF into JPEG Files for extraction.
 * Delegates the pdf.js page loop to `renderPdfPages` (shared with the in-app viewer),
 * so the worker lifecycle + per-page cleanup live in exactly one place.
 *
 * `maxPages` lets a MULTI-document extraction (#64) ask for only the pages it can still
 * use, so sharing five photos and a long PDF does not rasterize pages that would be thrown
 * away. It is clamped to MAX_EXTRACT_PAGES — a caller can ask for fewer, never more, so the
 * cap still lives here.
 */
export async function pdfToExtractionImages(
  file: File,
  maxPages: number = MAX_EXTRACT_PAGES
): Promise<ExtractionImages> {
  const data = await file.arrayBuffer();
  const { blobs, truncated } = await renderPdfPages(data, {
    longEdge: EXTRACT_LONG_EDGE,
    maxPages: Math.max(1, Math.min(maxPages, MAX_EXTRACT_PAGES)),
  });
  const baseName = file.name.replace(/\.pdf$/i, '');
  const files = blobs.map(
    (blob, i) => new File([blob], `${baseName}-p${i + 1}.jpg`, { type: 'image/jpeg' })
  );
  return { files, truncated };
}
