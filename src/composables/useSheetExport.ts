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
import {
  familiesInList,
  inlineFontFace,
  mergeSameFileFaces,
  normalizeFamily,
  parseFontFaceBlocks,
  selectFontFaces,
  type FontFaceBlock,
} from '@/utils/fontFaceEmbed';

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

/** Cross-origin stylesheet text, fetched once per href per session. Rejections are not cached. */
const remoteCssCache = new Map<string, Promise<string>>();
/** Font file URL to its `data:` URL, fetched once per file per session. Rejections are not cached. */
const fontDataUrlCache = new Map<string, Promise<string>>();

function memoised(
  cache: Map<string, Promise<string>>,
  key: string,
  load: () => Promise<string>
): Promise<string> {
  let pending = cache.get(key);
  if (!pending) {
    // Null-on-rejection, like `loadHtmlToImage`: one offline export must not poison the session.
    pending = load().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res;
}

function collectFontFaceText(rules: CSSRuleList, out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (rule.cssText.startsWith('@font-face')) {
      out.push(rule.cssText);
    } else if ('cssRules' in rule && rule.cssRules) {
      // @media / @supports / @layer can wrap a face.
      collectFontFaceText(rule.cssRules as CSSRuleList, out);
    }
  }
}

/**
 * Every `@font-face` the document declares. Same-origin sheets are read in place; a
 * cross-origin sheet (our Google Fonts `<link>`, which has no `crossorigin` attribute and so
 * cannot be read) is refetched with a CORS `fetch`. Google Fonts answers with
 * `Access-Control-Allow-Origin: *`, and the service worker only handles the `<link>`'s own
 * `destination: 'style'` load, so this reaches the network or the HTTP cache.
 */
async function collectFontFaceBlocks(): Promise<{
  blocks: FontFaceBlock[];
  sheetFailures: number;
}> {
  const settled = await Promise.allSettled(
    Array.from(document.styleSheets).map(async (sheet): Promise<FontFaceBlock[]> => {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        // Cross-origin: read by fetch below.
      }
      if (rules) {
        const text: string[] = [];
        collectFontFaceText(rules, text);
        return parseFontFaceBlocks(text.join('\n'), sheet.href ?? document.baseURI);
      }
      const href = sheet.href;
      if (!href) return [];
      const css = await memoised(remoteCssCache, href, async () => (await fetchOk(href)).text());
      return parseFontFaceBlocks(css, href);
    })
  );
  const blocks: FontFaceBlock[] = [];
  let sheetFailures = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled') blocks.push(...result.value);
    else sheetFailures++;
  }
  return { blocks, sheetFailures };
}

/** The families `el` names anywhere in its subtree, and every character it renders. */
function usedFamiliesAndText(el: HTMLElement): { families: Set<string>; codepoints: Set<number> } {
  const families = new Set<string>();
  const walk = (node: Element) => {
    for (const family of familiesInList(getComputedStyle(node).fontFamily)) families.add(family);
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(el);
  const codepoints = new Set<number>();
  for (const ch of el.textContent ?? '') codepoints.add(ch.codePointAt(0)!);
  return { families, codepoints };
}

/** Families the document loads as web fonts (every `@font-face`, readable sheet or not). */
function documentWebFontFamilies(): Set<string> {
  const out = new Set<string>();
  document.fonts?.forEach?.((face) => out.add(normalizeFamily(face.family)));
  return out;
}

/**
 * The `@font-face` CSS to inline into the capture of `el`: only the families `el` uses, only
 * the script subsets its text needs, each font file fetched once and inlined as a `data:` URL.
 *
 * ⚠️ THIS REPLACES html-to-image's `getFontEmbedCSS`, which returned an EMPTY STRING in every
 * production build: see `src/utils/fontFaceEmbed.ts` for why. Because it came back empty
 * rather than throwing, no fallback log fired and nobody could see it; that is why every
 * outcome below is logged, including success.
 *
 * Never throws for a missing face: it embeds what it can and reports the gap.
 */
async function buildFontEmbedCss(el: HTMLElement): Promise<string> {
  const started = performance.now();
  const { families, codepoints } = usedFamiliesAndText(el);
  const { blocks, sheetFailures } = await collectFontFaceBlocks();
  const faces = mergeSameFileFaces(selectFontFaces(blocks, families, codepoints));

  const urls = [...new Set(faces.flatMap((face) => face.urls))];
  const dataUrls = new Map<string, string>();
  let fileFailures = 0;
  await Promise.all(
    urls.map(async (url) => {
      try {
        const dataUrl = await memoised(fontDataUrlCache, url, async () =>
          blobToDataUrl(await (await fetchOk(url)).blob())
        );
        dataUrls.set(url, dataUrl);
      } catch {
        fileFailures++;
      }
    })
  );

  const css: string[] = [];
  const embedded = new Set<string>();
  for (const face of faces) {
    const text = inlineFontFace(face, dataUrls);
    if (text === null) continue;
    css.push(text);
    embedded.add(face.family);
  }

  // A web font the sheet asks for that the capture cannot draw: it will render in a fallback
  // face inside boxes measured for the real one (the overlapping header greg reported).
  const webFamilies = documentWebFontFamilies();
  const missing = [...families].filter((f) => webFamilies.has(f) && !embedded.has(f)).sort();
  if (missing.length > 0 || css.length === 0) {
    console.warn('[sheet-export] fonts missing from the capture', {
      missing,
      sheetFailures,
      fileFailures,
    });
    logEvent({
      level: 'warn',
      surface: SHEET_EXPORT_SURFACE,
      message: 'sheet export could not embed every font; those faces render in a fallback',
      context: {
        error_code: css.length === 0 ? 'font-embed-empty' : 'font-embed-missing',
        detail: missing.join(','),
        count: sheetFailures, // stylesheets that could not be read or fetched
        file_count: fileFailures, // font files that could not be fetched
      },
    });
  } else {
    logEvent({
      level: 'info',
      surface: SHEET_EXPORT_SURFACE,
      message: 'sheet export fonts embedded',
      context: {
        action: 'font-embed',
        count: css.length, // @font-face blocks inlined
        file_count: urls.length,
        perf_duration_ms: Math.round(performance.now() - started),
      },
    });
  }
  return css.join('\n');
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
  // ⚠️ DELIBERATELY NOT `buildFontEmbedCss()`. Warming it looked free and was the opposite:
  // it is cross-origin font fetches and base64, and the only surface that prewarms is the
  // recovery-kit sheet, which opens seconds after first paint during family creation, so the
  // warm-up competed with pod setup for the network on the one flow that must not stall. It
  // also needs the sheet being captured, which does not exist yet. Paying it at export time is
  // both cheaper overall and correct.
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
    ...(fontEmbedCss === null ? { skipFonts: true } : { fontEmbedCSS: fontEmbedCss }),
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
      // NOTE this is a FOUT guard for the on-screen element (html-to-image copies its measured
      // boxes), not a font-embedding lever: `buildFontEmbedCss` is what reaches html-to-image.
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
      // An empty result was already reported inside; `|| null` captures bare rather than
      // handing html-to-image an empty string it would treat as "embed nothing".
      fontEmbedCss =
        (await withTimeout(buildFontEmbedCss(el), FONT_EMBED_TIMEOUT_MS, 'font embed timed out')) ||
        null;
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
      // shape entirely: the embed SUCCEEDS (html-to-image's `getFontEmbedCSS` handed back
      // multiple megabytes of base64; `buildFontEmbedCss` now keeps only the subsets the sheet
      // uses, a fraction of that), and it is the rasterize step that then dies on the resulting
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
