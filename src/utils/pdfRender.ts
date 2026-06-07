// Shared pdf.js plumbing. Two callers:
//   • pdfFirstPageToImage (AI extraction) — page 1 → JPEG File for the proxy.
//   • pdfToPageImages (in-app viewing) — all pages → object URLs the PhotoViewer
//     renders inline, because mobile/PWA webviews frequently refuse to inline an
//     <iframe> PDF (they show a dead native fallback instead).
//
// pdfjs-dist is dynamic-imported so it stays code-split out of the main bundle —
// fetched only when a user actually reads or views a PDF. The lib + worker are
// wired once and memoized.

import type { PDFPageProxy } from 'pdfjs-dist';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/** Lazy-load pdfjs-dist and wire its worker (once). */
export async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Wire the worker via Vite's `?url` so it is emitted as a separate asset (no eval/CDN).
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Render a pdf.js page to a JPEG blob, scaling so the long edge is ~`longEdge`px
 * (clamped to a 1–3× device-independent scale). Shared by both callers.
 */
export async function renderPdfPageToBlob(
  page: PDFPageProxy,
  longEdge: number,
  quality = 0.85
): Promise<Blob> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(3, longEdge / Math.max(base.width, base.height)));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context to render the PDF');

  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );
  if (!blob) throw new Error('Could not encode the rendered PDF page to an image');
  return blob;
}

/** Long-edge target px for inline viewing — sharp on phones, light on memory. */
const VIEW_LONG_EDGE = 1600;
/** Safety cap so a pathologically long PDF can't render hundreds of canvases. */
const MAX_VIEW_PAGES = 20;

export interface PdfViewPages {
  /** One JPEG object URL per rendered page, in order. Caller MUST revoke them. */
  urls: string[];
  /** True when the document had more pages than were rendered (cap hit). */
  truncated: boolean;
}

/**
 * Render up to `MAX_VIEW_PAGES` pages of a PDF to JPEG object URLs for inline
 * display. The caller owns the returned URLs and must `URL.revokeObjectURL` them
 * when done (the PhotoViewer revokes on close / navigation / unmount).
 */
export async function pdfToPageImages(data: ArrayBuffer): Promise<PdfViewPages> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data }).promise;
  const urls: string[] = [];
  try {
    const count = Math.min(doc.numPages, MAX_VIEW_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      try {
        const blob = await renderPdfPageToBlob(page, VIEW_LONG_EDGE);
        urls.push(URL.createObjectURL(blob));
      } finally {
        page.cleanup();
      }
    }
    return { urls, truncated: doc.numPages > count };
  } finally {
    void doc.destroy();
  }
}
