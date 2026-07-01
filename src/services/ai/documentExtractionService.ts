// Document → structured event extraction funnel (ADR-030, #133).
//
// The single entry point all callers use (DRY): client-side compression →
// tier dispatch → provider call → typed result. Every failure is classified into a
// stable `ExtractionErrorCode` and returned as `{ success: false, errorCode }` — the
// service NEVER throws to the caller and never reports/toasts (the composable owns
// user-facing reporting, so it isn't double-fired). See docs/lessons.md (no silent failures).
//
// CONSENT is a precondition enforced by the CALLER (the wedge composable shows the
// per-action consent modal before invoking this). By the time we're here, the user has
// agreed to send this one document. Data-minimization: only the single compressed
// document leaves the device — never the family dataset.

import {
  compress,
  CompressionError,
  type CompressOptions,
} from '@/services/photos/photoCompression';
import { assertNever } from '@/utils/assertNever';
import { isPdfFile, pdfToExtractionImages } from '@/utils/pdfExtractionImages';
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
  type ExtractionTask,
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
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new CompressionError('Could not read compressed image', reader.error));
    reader.readAsDataURL(blob);
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
 * Resolve the input `File` into one-or-more client-compressed page images.
 * - PDF → rasterize up to `MAX_EXTRACT_PAGES` pages (`pdfToExtractionImages`), then compress each.
 * - Any other image → the single-image case (`truncated: false`).
 *
 * Compresses sequentially: canvas work is main-thread, so sequential bounds peak memory
 * and is simpler than `Promise.all`. Throws `CompressionError` on any failure so the single
 * catch in `runExtraction` classifies it as `'compression'`. Returns page 1's compressed blob
 * as the representative thumbnail.
 */
async function prepareImageDataUrls(
  file: File,
  compression: CompressOptions
): Promise<PreparedImages> {
  let sourceFiles: File[];
  let truncated: boolean;
  if (isPdfFile(file)) {
    const rasterized = await pdfToExtractionImages(file);
    sourceFiles = rasterized.files;
    truncated = rasterized.truncated;
  } else {
    sourceFiles = [file];
    truncated = false;
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
    imageDataUrls.push(await blobToDataUrl(compressed.blob));
  }
  // compressedBlob is defined: the length guard above guarantees ≥1 iteration.
  return { imageDataUrls, compressedBlob: compressedBlob as Blob, truncated };
}

/**
 * Shared funnel for every extraction task (DRY): client-side compression → tier dispatch →
 * the task-specific provider call → typed result. Always resolves (never rejects) with a
 * classified outcome; `run` selects the per-task provider method (`extract` / `extractTravel`).
 */
async function runExtraction<T>(
  file: File,
  opts: ExtractOptions,
  task: ExtractionTask,
  run: (provider: ExtractionProvider, request: ExtractionRequest) => Promise<T>
): Promise<DocumentExtractionResult<T>> {
  // 1) Resolve the document into its page image(s) and compress each client-side (a PDF
  //    rasterizes up to MAX_EXTRACT_PAGES pages; a photo is the single-image case). Keep
  //    page 1's compressed blob so a successful result can hand it back as the source
  //    thumbnail without a second compression pass, and carry `truncated` through.
  let prepared: PreparedImages;
  try {
    prepared = await prepareImageDataUrls(file, opts.compression ?? DEFAULT_COMPRESSION);
  } catch (err) {
    // Rasterize + compress live here now, so their dev-guidance log lives here too.
    console.error(
      '[ai-extract] failed to prepare document "%s" for extraction — a corrupt or ' +
        'password-protected PDF, a browser-undecodable image (e.g. HEIC on Chromium), or ' +
        'an out-of-memory canvas render can cause this. Reported to the user as a ' +
        'compression error.',
      file.name,
      err
    );
    const detail = err instanceof CompressionError ? err.message : 'Failed to prepare image';
    return { success: false, errorCode: 'compression', error: detail };
  }

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
    imageDataUrls: prepared.imageDataUrls,
    todayIso: opts.todayIso,
    signal: opts.signal,
    task,
  };
  try {
    const data = await run(provider, request);
    return {
      success: true,
      data,
      compressedBlob: prepared.compressedBlob,
      truncated: prepared.truncated,
    };
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
 * Extract event details from a single document image and return a typed result (#133).
 * Always resolves (never rejects) with a classified outcome.
 */
export function extractEventFromDocument(
  file: File,
  opts: ExtractOptions
): Promise<DocumentExtractionResult<ExtractionResult>> {
  return runExtraction(file, opts, 'event', (provider, request) => provider.extract(request));
}

/**
 * Extract travel booking(s) from a single document image and return a typed result (#30).
 * Always resolves (never rejects) with a classified outcome.
 */
export function extractTravelFromDocument(
  file: File,
  opts: ExtractOptions
): Promise<DocumentExtractionResult<TravelExtractionResult>> {
  return runExtraction(file, opts, 'travel', (provider, request) =>
    provider.extractTravel(request)
  );
}
