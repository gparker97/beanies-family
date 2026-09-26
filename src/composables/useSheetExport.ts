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
import { withTimeout } from '@/utils/timing';
import { blobToDataUrl } from '@/utils/blobToDataUrl';
import { logEvent } from '@/services/telemetry';

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
 * How long we will wait for the cross-origin font embed before giving up on it.
 *
 * Generous, because on a cold session this is dozens of fetches; bounded, because the whole point
 * is that a slow font CDN must not cost someone their recovery kit.
 */
const FONT_EMBED_TIMEOUT_MS = 6_000;

/**
 * ⚠️ NOT `'login-flow'`. These events were filed under the recovery-kit surface because that
 * is where the Firefox bug was reported, but `MealPlannerPage` exports through the same
 * function — so a meal-planner font failure filed itself against login and would have been
 * triaged as an auth problem. One surface for the exporter, whoever calls it.
 */
const SHEET_EXPORT_SURFACE = 'sheet-export';

let fontEmbedCssPromise: Promise<string> | null = null;

/**
 * The `@font-face` CSS to inline into the capture, computed ONCE per session.
 *
 * ⚠️ THIS IS THE ACTUAL FIX FOR THE FIREFOX RECOVERY-KIT FAILURE, and the obvious one was a
 * no-op. `PngExportOptions.fonts` only ever fed `document.fonts.load()`; it is never passed to
 * `html-to-image` and has no effect on embedding. What actually happens without this: the
 * library's `getCSSRules` hits a `SecurityError` reading `cssRules` on our cross-origin Google
 * Fonts <link>, falls into a catch that refetches the stylesheet, and inlines EVERY `@font-face`
 * it contains — Outfit x6 weights, Inter x3, Caveat x3, each across ~7 unicode-range subsets — as
 * base64 into a single foreignObject SVG data URL. Multiple megabytes and dozens of fetches, on
 * every export in the app. Chromium tolerates it; Firefox does not, and the rasterize step fails.
 *
 * Memoised with the same null-on-rejection shape as `loadHtmlToImage` above, so one bad session
 * cannot cache a rejection forever, and so N exports pay this once rather than N times.
 */
function getFontEmbedCss(): Promise<string> {
  if (!fontEmbedCssPromise) {
    fontEmbedCssPromise = loadHtmlToImage()
      .then((m) => m.getFontEmbedCSS(document.body))
      .catch((err) => {
        fontEmbedCssPromise = null;
        throw err;
      });
  }
  return fontEmbedCssPromise;
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
  // ⚠️ DELIBERATELY NOT `getFontEmbedCss()`. Warming it looked free and was the opposite:
  // it is dozens of cross-origin font fetches and megabytes of base64, and the only surface that
  // prewarms is the recovery-kit sheet, which opens seconds after first paint during family
  // creation — so the warm-up competed with pod setup for the network on the one flow that must
  // not stall. It also memoises for the whole session from whatever the DOM looked like at that
  // moment, which is not the sheet being captured. Paying it at export time is both cheaper
  // overall and correct.
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
/**
 * One capture attempt. Extracted so the fallback below is a second CALL rather than a retry
 * buried inside a catch — one level of nesting, not two.
 *
 * `fontEmbedCSS: null` means "do not embed fonts at all" (`skipFonts`), which renders in the
 * platform fallback face. That is a cosmetic downgrade, and it is always better than no file.
 */
/**
 * Drop `[data-export-hide]` subtrees from the capture.
 *
 * A sheet is one layout serving two audiences: a live surface people click, and a flat file.
 * Interactive affordances belong only to the first — a "Copy link" button rasterised into a
 * PDF is a button someone taps on paper. This is the seam for that, and it lives in the
 * exporter rather than in each caller so a sheet marks its own non-printing parts and every
 * export path honours it.
 *
 * `filter` is not called for the root node, so a caller cannot accidentally erase its own sheet.
 */
function excludeFromExport(node: Node): boolean {
  return !(node instanceof Element) || !node.hasAttribute('data-export-hide');
}

async function captureOnce(
  el: HTMLElement,
  opts: PngExportOptions,
  fontEmbedCss: string | null
): Promise<Blob> {
  const { toBlob } = await loadHtmlToImage();
  // No `cacheBust`: the only images are same-origin brand PNGs (no CORS), and
  // cache-busting appends a unique query that misses the SW precache and can
  // bake in blank marks on a cold/offline first capture.
  const blob = await toBlob(el, {
    pixelRatio: opts.pixelRatio ?? 2,
    backgroundColor: opts.backgroundColor,
    filter: excludeFromExport,
    ...(fontEmbedCss === null
      ? { skipFonts: true }
      : { fontEmbedCSS: fontEmbedCss, preferredFontFormat: 'woff2' as const }),
  });
  if (!blob) throw new Error('html-to-image returned a null blob');
  return blob;
}

export async function exportElementToPng(
  el: HTMLElement,
  opts: PngExportOptions = {}
): Promise<Blob> {
  try {
    if (opts.fonts?.length && typeof document !== 'undefined' && document.fonts) {
      // Force each family/weight into flight, then let loading settle.
      // `allSettled`: a single failed font fetch (offline / flaky) is a cosmetic
      // fallback, NOT a reason to fail the whole export.
      //
      // NOTE this is a FOUT guard for the on-screen element, not a font-embedding lever — see
      // `getFontEmbedCss`, which is the one that actually reaches html-to-image.
      await Promise.allSettled(opts.fonts.map((f) => document.fonts.load(f)));
    }
    if (typeof document !== 'undefined' && document.fonts) {
      await document.fonts.ready;
    }

    // ⚠️ DEGRADE, NEVER ABORT. A font problem used to cost the user the whole export — and on the
    // recovery-kit surface that means they cannot save the one artefact that gets them back into
    // their pod. A kit in fallback fonts is a working kit.
    let fontEmbedCss: string | null = null;
    try {
      // `withTimeout` rather than an inline race: it CLEARS its timer when the promise settles
      // first, where the hand-rolled race left one pending for the full six seconds on every
      // successful export.
      fontEmbedCss = await withTimeout(
        getFontEmbedCss(),
        FONT_EMBED_TIMEOUT_MS,
        'font embed timed out'
      );
    } catch (fontErr) {
      // Not fatal, but never silent: a quality regression nobody can see is one nobody fixes.
      console.warn('[sheet-export] font embed failed; capturing without embedded fonts', fontErr);
      logEvent({
        level: 'warn',
        surface: SHEET_EXPORT_SURFACE,
        message: 'sheet export font embed failed; captured with fallback fonts',
        context: { error_code: 'font-embed-fallback' },
      });
    }

    // At most ONE fallback. A second failure is a real failure and still throws, so today's
    // contract is preserved rather than widened.
    if (fontEmbedCss === null) return await captureOnce(el, opts, null);

    try {
      return await captureOnce(el, opts, fontEmbedCss);
    } catch (captureErr) {
      // ⚠️ THIS IS THE ARM THAT ACTUALLY FIXES FIREFOX, and it was missing: the degrade
      // above only fired when FETCHING the font CSS failed. The reported failure is the other
      // shape entirely — `getFontEmbedCSS` SUCCEEDS, handing back multiple megabytes of base64
      // `@font-face` rules, and it is the rasterize step that then dies on the resulting
      // foreignObject data URL. Chromium tolerates it, Firefox does not. With one call site the
      // `skipFonts` path could not be reached on the exact failure it was written for, and the
      // comment above claimed a fallback the code did not have.
      console.warn('[sheet-export] capture with embedded fonts failed; retrying bare', captureErr);
      logEvent({
        level: 'warn',
        surface: SHEET_EXPORT_SURFACE,
        message: 'sheet export capture failed with embedded fonts; retried with fallback fonts',
        context: { error_code: 'font-embed-capture-fallback' },
      });
      return await captureOnce(el, opts, null);
    }
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
 * Wrap PNG blobs in a landscape-A4 PDF, one page per blob, each scaled-to-fit and
 * centred, so a page never clips or spills. A multi-page sheet renders each page
 * element separately and passes them in order. Throws `ExportError('pdf', …)` on
 * any failure, including an empty list.
 */
export async function pngBlobsToPdf(pngBlobs: Blob[], opts: PdfExportOptions = {}): Promise<Blob> {
  try {
    if (pngBlobs.length === 0) throw new Error('no pages to export');
    const { jsPDF } = await loadJsPdf();
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = opts.margin ?? 24;

    for (const [i, pngBlob] of pngBlobs.entries()) {
      const dataUrl = await blobToDataUrl(pngBlob);
      const { width: imgW, height: imgH } = await imageSize(dataUrl);
      if (i > 0) pdf.addPage('a4', 'landscape');
      const scale = Math.min((pageW - margin * 2) / imgW, (pageH - margin * 2) / imgH);
      const w = imgW * scale;
      const h = imgH * scale;
      // 'FAST' deflates the embedded image: without it jsPDF stores the decoded pixels raw,
      // about 10 MB per A4 page at 2x, which is a heavy file to share or email.
      pdf.addImage(dataUrl, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, 'FAST');
    }
    return pdf.output('blob');
  } catch (err) {
    if (err instanceof ExportError) throw err;
    throw new ExportError('pdf', err);
  }
}

/** A single PNG on a single page — `pngBlobsToPdf` with one item. */
export function pngBlobToPdf(pngBlob: Blob, opts: PdfExportOptions = {}): Promise<Blob> {
  return pngBlobsToPdf([pngBlob], opts);
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
  return { exportElementToPng, pngBlobToPdf, pngBlobsToPdf };
}
