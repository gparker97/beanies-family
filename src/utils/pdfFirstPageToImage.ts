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

/** True for a PDF by mime or extension (covers pickers that omit the mime). */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Long-edge target px for the rendered page. The extraction service re-compresses to
 *  2048px/q0.85 anyway, so this is a sensible upper bound, not the final size. */
const TARGET_LONG_EDGE = 2048;

export async function pdfFirstPageToImage(file: File): Promise<File> {
  const pdfjs = await import('pdfjs-dist');
  // Wire the worker via Vite's `?url` so it is emitted as a separate asset (no eval/CDN).
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(1, Math.min(3, TARGET_LONG_EDGE / Math.max(base.width, base.height)));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context to render the PDF');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
    if (!blob) throw new Error('Could not encode the rendered PDF page to an image');

    const baseName = file.name.replace(/\.pdf$/i, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } finally {
    // Release the worker-side document so the worker can be reclaimed.
    void doc.destroy();
  }
}
