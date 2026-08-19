/**
 * useSheetExport — the reusable, plan-shape-agnostic export engine.
 *
 * One layout source → two outputs: rasterise an off-screen DOM node to a PNG,
 * and (for PDF) embed that same PNG into a single landscape-A4 page, so the
 * image and the PDF are pixel-identical and there is exactly one layout to
 * maintain. `html-to-image` and `jspdf` are lazy-loaded via memoised dynamic
 * imports (mirroring `loadPdfjs`) so they stay code-split out of the entry
 * bundle.
 *
 * Error contract: each stage rethrows a typed `ExportError` carrying its
 * `stage`. The engine NEVER toasts or reports itself — it lets the error
 * propagate to the single View-level handler so there is exactly one report per
 * failure. `ExportStage` + `ExportError` are the single taxonomy the View and
 * the delivery helper import (no drifting string literals).
 */
import { blobToDataUrl } from '@/utils/blobToDataUrl';

export type ExportStage = 'render' | 'rasterize' | 'pdf' | 'deliver';

/** Typed failure carrying the stage that broke — the one export taxonomy. */
export class ExportError extends Error {
  readonly stage: ExportStage;
  constructor(stage: ExportStage, cause: unknown) {
    super(
      `export failed at stage '${stage}': ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = 'ExportError';
    this.stage = stage;
    if (cause instanceof Error) this.cause = cause;
  }
}

// ── Memoised lazy deps (code-split, mirroring loadPdfjs) ─────────────────────
let htmlToImagePromise: Promise<typeof import('html-to-image')> | null = null;
function loadHtmlToImage(): Promise<typeof import('html-to-image')> {
  // Null the memo on rejection so a failed first import (offline / a 404'd
  // chunk right after a deploy) doesn't cache the rejection and permanently
  // break every later export — the next call re-imports.
  if (!htmlToImagePromise) {
    htmlToImagePromise = import('html-to-image').catch((err) => {
      htmlToImagePromise = null;
      throw err;
    });
  }
  return htmlToImagePromise;
}

let jspdfPromise: Promise<typeof import('jspdf')> | null = null;
function loadJsPdf(): Promise<typeof import('jspdf')> {
  if (!jspdfPromise) {
    jspdfPromise = import('jspdf').catch((err) => {
      jspdfPromise = null;
      throw err;
    });
  }
  return jspdfPromise;
}

/**
 * Warm the lazy export deps in the background so a later Share/Export tap
 * doesn't have to await a code-split chunk fetch — important on iOS WebKit,
 * where `navigator.share({files})` loses its transient user activation if too
 * much awaiting happens between the tap and the call. Fire-and-forget; failures
 * are ignored (the real export path reports them).
 */
export function prewarmSheetExport(): void {
  void loadHtmlToImage().catch(() => {});
  void loadJsPdf().catch(() => {});
}

export interface PngExportOptions {
  /**
   * Font specs (`"<weight> <size> <family>"`) the sheet renders, forced into
   * flight before capture. Required for lazily-triggered faces (esp. Caveat).
   */
  fonts?: string[];
  /** Capture scale — 2× keeps text crisp on retina + when scaled into the PDF. */
  pixelRatio?: number;
  backgroundColor?: string;
}

/**
 * Rasterise `el` to a PNG blob. Loads the sheet's fonts and waits for
 * `document.fonts.ready` BEFORE capture — `nextTick` alone doesn't schedule the
 * lazy font fetch, so `ready` could resolve with nothing pending and bake a
 * FOUT / missing-glyph. Throws `ExportError('rasterize', …)` on any failure
 * (including a lazy-import failure or a null blob).
 */
export async function exportElementToPng(
  el: HTMLElement,
  opts: PngExportOptions = {}
): Promise<Blob> {
  try {
    if (opts.fonts?.length && typeof document !== 'undefined' && document.fonts) {
      // Force each family/weight into flight, then let loading settle.
      // `allSettled`: a single failed font fetch (offline / flaky) is a cosmetic
      // fallback, NOT a reason to fail the whole export.
      await Promise.allSettled(opts.fonts.map((f) => document.fonts.load(f)));
    }
    if (typeof document !== 'undefined' && document.fonts) {
      await document.fonts.ready;
    }

    const { toBlob } = await loadHtmlToImage();
    // No `cacheBust`: the only images are same-origin brand PNGs (no CORS), and
    // cache-busting appends a unique query that misses the SW precache and can
    // bake in blank marks on a cold/offline first capture.
    const blob = await toBlob(el, {
      pixelRatio: opts.pixelRatio ?? 2,
      backgroundColor: opts.backgroundColor,
    });
    if (!blob) throw new Error('html-to-image returned a null blob');
    return blob;
  } catch (err) {
    if (err instanceof ExportError) throw err;
    throw new ExportError('rasterize', err);
  }
}

export interface PdfExportOptions {
  /** Page margin in pt (both axes). Default 24. */
  margin?: number;
}

/**
 * Wrap a PNG blob in a single landscape-A4 PDF page, scaled-to-fit and centred,
 * so a full week never clips or spills onto a second page. Throws
 * `ExportError('pdf', …)` on any failure.
 */
export async function pngBlobToPdf(pngBlob: Blob, opts: PdfExportOptions = {}): Promise<Blob> {
  try {
    const { jsPDF } = await loadJsPdf();
    const dataUrl = await blobToDataUrl(pngBlob);
    const { width: imgW, height: imgH } = await imageSize(dataUrl);

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = opts.margin ?? 24;

    const scale = Math.min((pageW - margin * 2) / imgW, (pageH - margin * 2) / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    pdf.addImage(dataUrl, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h);
    return pdf.output('blob');
  } catch (err) {
    if (err instanceof ExportError) throw err;
    throw new ExportError('pdf', err);
  }
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('failed to decode PNG for PDF embedding'));
    img.src = dataUrl;
  });
}

/** Thin composable wrapper so Views can `const { exportElementToPng } = useSheetExport()`. */
export function useSheetExport() {
  return { exportElementToPng, pngBlobToPdf };
}
