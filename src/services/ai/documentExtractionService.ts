// Document → structured event extraction funnel (ADR-030, #133).
//
// The single entry point all callers use (DRY): client-side compression →
// tier dispatch → provider call → typed result. Every failure is classified into a
// stable `ExtractionErrorCode` and returned as `{ success: false, errorCode }` — the
// service NEVER throws to the caller and never reports/toasts (the composable owns
// user-facing reporting, so it isn't double-fired). See docs/lessons.md (no silent failures).
//
// CONSENT is a precondition enforced by the TYPE SYSTEM (#64). `ExtractOptions.grant` is a
// branded `ConsentGrant` that only `requestConsent()` can mint, so reaching this funnel
// without having awaited the ADR-030 gate does not compile. It used to be a convention in
// this comment, and a new entry point duly shipped without the gate. The service never
// inspects the token — it only demands it. Data-minimization is unchanged: only the
// compressed document leaves the device, never the family dataset.

import {
  compress,
  CompressionError,
  type CompressOptions,
} from '@/services/photos/photoCompression';
import type { ConsentGrant } from '@/composables/useDocumentConsent';
import { assertNever } from '@/utils/assertNever';
import { blobToDataUrl } from '@/utils/blobToDataUrl';
import { MAX_EXTRACT_PAGES, isPdfFile, pdfToExtractionImages } from '@/utils/pdfExtractionImages';
import { createByokProvider, type ByokConfig } from './providers/byokProvider';
import { managedProvider } from './providers/managedProvider';
import { onDeviceProvider } from './providers/onDeviceProvider';
import {
  ExtractionProviderError,
  type AiTier,
  type DocumentExtractionResult,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResult,
  type ExtractionResultByTask,
  type ExtractionSource,
  type ExtractionTask,
  type RecipeExtractionResult,
  type ShareExtractionResult,
  type TravelExtractionResult,
} from './types';

/**
 * Per-page compression defaults. The base64 data-URL is ~1.33× the compressed bytes;
 * 2048px / q0.85 keeps each page small while staying readable for OCR. PDF pages are
 * already rendered at 1600px (≤ this cap, so no upscale), and the page count is bounded
 * by `MAX_EXTRACT_PAGES`, keeping the whole request under the Lambda body cap.
 */
const DEFAULT_COMPRESSION: CompressOptions = { maxDimension: 2048, quality: 0.85 };

export interface ExtractOptions {
  /** Which tier to use. Default tier is `managed`. */
  tier: AiTier;
  /** Current date `YYYY-MM-DD`, for resolving relative dates in the document. */
  todayIso: string;
  /** Optional cancel signal so the UI can abort. */
  signal?: AbortSignal;
  /** Compression tuning override. */
  compression?: CompressOptions;
  /** Required when `tier === 'byok'`: which provider + key. Ignored otherwise. */
  byok?: ByokConfig;
  /**
   * Proof that the ADR-030 per-document consent gate ran for this action. Obtained by
   * awaiting `requestConsent()`; it cannot be constructed any other way, which is what makes
   * an ungated extraction a compile error rather than a review catch.
   */
  grant: ConsentGrant;
}

function selectProvider(opts: ExtractOptions): ExtractionProvider {
  switch (opts.tier) {
    case 'managed':
      return managedProvider;
    case 'byok':
      if (!opts.byok) {
        throw new ExtractionProviderError(
          'not_available',
          'BYOK tier selected but no key configured'
        );
      }
      return createByokProvider(opts.byok);
    case 'on-device':
      return onDeviceProvider;
    default:
      // A new tier added to AiTier without a case here fails the build, not at runtime.
      return assertNever(opts.tier, 'aiTierDispatch');
  }
}

/** Read a Blob as a base64 `data:` URL for the self-contained image payload. */
function readImageDataUrl(blob: Blob): Promise<string> {
  return blobToDataUrl(blob).catch((err) => {
    throw new CompressionError('Could not read compressed image', err);
  });
}

interface PreparedImages {
  /** One compressed `data:` URL per page, in page order (always ≥1). */
  imageDataUrls: string[];
  /** Page 1's compressed blob — the representative source thumbnail for the caller. */
  compressedBlob: Blob;
  /** True when a PDF had more pages than `MAX_EXTRACT_PAGES` (extra pages dropped). */
  truncated: boolean;
}

/**
 * Resolve the input document(s) into client-compressed page images.
 * - PDF → rasterize its pages (`pdfToExtractionImages`), then compress each.
 * - Any other image → used as a single page.
 *
 * SEVERAL documents are read as the PAGES OF ONE ITEM (#64), in the order given — sharing
 * three photos of one recipe produces one extraction, not three. Collection stops the moment
 * `MAX_EXTRACT_PAGES` pages exist, so N inputs cost at most cap-many rasterize+compress
 * passes rather than N, and nothing past the cap is even read. `truncated` is set whenever
 * the cap bit, so the caller can say so — pages are never dropped silently.
 *
 * THE PAGE CAP LIVES HERE (and in the rasterizer it delegates to) and nowhere else. Counting
 * FILES would be the wrong unit: one shared PDF is many pages.
 *
 * Compresses sequentially: canvas work is main-thread, so sequential bounds peak memory
 * and is simpler than `Promise.all`. Throws `CompressionError` on any failure so the single
 * catch in `runExtraction` classifies it as `'compression'`. Returns page 1's compressed blob
 * as the representative thumbnail.
 */
async function prepareImageDataUrls(
  input: File | File[],
  compression: CompressOptions
): Promise<PreparedImages> {
  const inputs = Array.isArray(input) ? input : [input];
  const sourceFiles: File[] = [];
  let truncated = false;

  for (const file of inputs) {
    const remaining = MAX_EXTRACT_PAGES - sourceFiles.length;
    if (remaining <= 0) {
      // There were more documents than we can read. Not silent: the caller shows a notice.
      truncated = true;
      break;
    }
    if (isPdfFile(file)) {
      // Ask for only the pages we can still use, so a long PDF behind several photos does
      // not rasterize pages that would be discarded.
      const rasterized = await pdfToExtractionImages(file, remaining);
      sourceFiles.push(...rasterized.files);
      if (rasterized.truncated) truncated = true;
    } else {
      sourceFiles.push(file);
    }
  }

  // Defensive: an empty / unrenderable PDF would otherwise leave nothing to send.
  if (sourceFiles.length === 0) {
    throw new CompressionError('Document produced no readable pages');
  }

  const imageDataUrls: string[] = [];
  let compressedBlob: Blob | undefined;
  for (const src of sourceFiles) {
    const compressed = await compress(src, compression);
    compressedBlob ??= compressed.blob; // page 1 → source thumbnail
    imageDataUrls.push(await readImageDataUrl(compressed.blob));
  }
  // compressedBlob is defined: the length guard above guarantees ≥1 iteration.
  return { imageDataUrls, compressedBlob: compressedBlob as Blob, truncated };
}

/**
 * Shared funnel for every extraction task (DRY): client-side compression → tier dispatch →
 * the task-specific provider call → typed result. Always resolves (never rejects) with a
 * classified outcome; `run` selects the per-task provider method (`extract` / `extractTravel`).
 */
async function runExtraction<T extends ExtractionTask>(
  input: File | File[] | string,
  opts: ExtractOptions,
  task: T
): Promise<DocumentExtractionResult<ExtractionResultByTask[T]>> {
  // A text source has no file to rasterize or compress, so it skips preparation entirely
  // (no compressedBlob, no truncation). Closed with assertNever so a third source kind is
  // a BUILD error here rather than a silent fallthrough.
  if (typeof input === 'string') {
    return runWithSource({ kind: 'text', text: input }, opts, task, undefined, false);
  }
  // 1) Resolve the document into its page image(s) and compress each client-side (a PDF
  //    rasterizes up to MAX_EXTRACT_PAGES pages; a photo is the single-image case). Keep
  //    page 1's compressed blob so a successful result can hand it back as the source
  //    thumbnail without a second compression pass, and carry `truncated` through.
  let prepared: PreparedImages;
  try {
    prepared = await prepareImageDataUrls(input, opts.compression ?? DEFAULT_COMPRESSION);
  } catch (err) {
    // Rasterize + compress live here now, so their dev-guidance log lives here too.
    console.error(
      '[ai-extract] failed to prepare document "%s" for extraction — a corrupt or ' +
        'password-protected PDF, a browser-undecodable image (e.g. HEIC on Chromium), or ' +
        'an out-of-memory canvas render can cause this. Reported to the user as a ' +
        'compression error.',
      Array.isArray(input) ? `${input.length} documents` : input.name,
      err
    );
    const detail = err instanceof CompressionError ? err.message : 'Failed to prepare image';
    return { success: false, errorCode: 'compression', error: detail };
  }

  return runWithSource(
    { kind: 'images', imageDataUrls: prepared.imageDataUrls },
    opts,
    task,
    prepared.compressedBlob,
    prepared.truncated
  );
}

/** Tier dispatch + the provider call, shared by both source kinds. */
async function runWithSource<T extends ExtractionTask>(
  source: ExtractionSource,
  opts: ExtractOptions,
  task: T,
  compressedBlob: Blob | undefined,
  truncated: boolean
): Promise<DocumentExtractionResult<ExtractionResultByTask[T]>> {
  // Exhaustiveness anchor: adding a source kind must break the build somewhere concrete.
  if (source.kind !== 'images' && source.kind !== 'text') assertNever(source, 'sourceKind');

  // 2) Dispatch to the selected tier's provider.
  let provider: ExtractionProvider;
  try {
    provider = selectProvider(opts);
  } catch (err) {
    if (err instanceof ExtractionProviderError) {
      return { success: false, errorCode: err.code, error: err.message };
    }
    return { success: false, errorCode: 'not_available', error: 'No provider for selected tier' };
  }

  // 3) Run extraction; classify any failure.
  const request: ExtractionRequest = {
    source,
    todayIso: opts.todayIso,
    signal: opts.signal,
  };
  try {
    const data = await provider.run(task, request);
    return { success: true, data, compressedBlob, truncated };
  } catch (err) {
    if (err instanceof ExtractionProviderError) {
      return { success: false, errorCode: err.code, error: err.message };
    }
    return {
      success: false,
      errorCode: 'provider_error',
      error: err instanceof Error ? err.message : 'Extraction failed',
    };
  }
}

/**
 * Extract event details from a document and return a typed result (#133).
 *
 * Accepts SEVERAL documents (#64), which are read as the pages of one item — sharing three
 * photos of one invite produces one event, not three. Passing a single `File` is unchanged.
 * Always resolves (never rejects) with a classified outcome.
 */
export function extractEventFromDocument(
  file: File | File[],
  opts: ExtractOptions
): Promise<DocumentExtractionResult<ExtractionResult>> {
  return runExtraction(file, opts, 'event');
}

/**
 * Extract a recipe from a document (photo, screenshot or PDF) and return a typed result
 * (#72). Accepts several documents, read as the pages of one recipe (#64).
 * Always resolves (never rejects) with a classified outcome.
 */
export function extractRecipeFromDocument(
  file: File | File[],
  opts: ExtractOptions
): Promise<DocumentExtractionResult<RecipeExtractionResult>> {
  return runExtraction(file, opts, 'recipe');
}

/**
 * Extract a recipe from already-extracted TEXT — a reduced web page or a video transcript
 * (#72 phases 2/3). Skips compression entirely; there is no file (#72).
 *
 * The text is UNTRUSTED (an arbitrary web page or someone's captions). It is fenced as data
 * in the user message by the shared prompt builder, and every field of the reply is bounded
 * and screened downstream. See buildUserMessage's header.
 */
export function extractRecipeFromText(
  text: string,
  opts: ExtractOptions
): Promise<DocumentExtractionResult<RecipeExtractionResult>> {
  return runExtraction(text, opts, 'recipe');
}

/**
 * Classify AND extract a SHARED document in ONE call (#64).
 *
 * Used by the mobile share target, where nothing indicates what the document is. Several
 * documents are read as the pages of one item, so sharing three photos of one invitation
 * produces one event. Always resolves (never rejects) with a classified outcome; the result
 * is a discriminated union whose `kind` selects the review surface, and `kind: 'none'` is the
 * honest answer for a document that is none of the three.
 */
export function extractShareFromDocuments(
  files: File[],
  opts: ExtractOptions
): Promise<DocumentExtractionResult<ShareExtractionResult>> {
  return runExtraction(files, opts, 'share');
}

/**
 * Extract travel booking(s) from a document and return a typed result (#30). Accepts several
 * documents, read as the pages of one itinerary (#64).
 * Always resolves (never rejects) with a classified outcome.
 */
export function extractTravelFromDocument(
  file: File | File[],
  opts: ExtractOptions
): Promise<DocumentExtractionResult<TravelExtractionResult>> {
  return runExtraction(file, opts, 'travel');
}
