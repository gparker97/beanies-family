// Rasterize page 1 of a PDF to a JPEG File for AI extraction (#30).
//
// The managed extraction Lambda accepts JPEG/PNG only, but travel confirmations are
// overwhelmingly PDFs. We render the FIRST page to a canvas and hand back a JPEG so the
// existing image pipeline (compress → data URL → proxy) is unchanged. pdfjs-dist is
// dynamic-imported here so it is code-split into a chunk that the main bundle and the
// activity wedge never load — it is fetched only when a user actually extracts a PDF.
//
// v1 limitation: only page 1 is read for extraction. The full original PDF is still
// attached to the segment, so nothing is lost.
//
// The pdfjs lazy-load + worker wiring + page-render live in `pdfRender.ts`, shared
// with the in-app PDF viewer (`pdfToPageImages`).

import { loadPdfjs, renderPdfPageToBlob } from './pdfRender';

/** True for a PDF by mime or extension (covers pickers that omit the mime). */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Long-edge target px for the rendered page. The extraction service re-compresses to
 *  2048px/q0.85 anyway, so this is a sensible upper bound, not the final size. */
const TARGET_LONG_EDGE = 2048;

export async function pdfFirstPageToImage(file: File): Promise<File> {
  const pdfjs = await loadPdfjs();
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(1);
    const blob = await renderPdfPageToBlob(page, TARGET_LONG_EDGE);
    const baseName = file.name.replace(/\.pdf$/i, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } finally {
    // Release the worker-side document so the worker can be reclaimed.
    void doc.destroy();
  }
}
