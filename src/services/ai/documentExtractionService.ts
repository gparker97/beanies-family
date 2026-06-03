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
import { createByokProvider, type ByokConfig } from './providers/byokProvider';
import { managedProvider } from './providers/managedProvider';
import { onDeviceProvider } from './providers/onDeviceProvider';
import {
  ExtractionProviderError,
  type AiTier,
  type DocumentExtractionResult,
  type ExtractionProvider,
  type ExtractionRequest,
} from './types';

/**
 * Compression defaults sized for the managed proxy body cap. The base64 data-URL is
 * ~1.33× the compressed bytes; 2048px / q0.85 keeps a typical document comfortably
 * under the ~2 MB proxy limit while staying readable for OCR.
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

/**
 * Extract event details from a single document image and return a typed result.
 * Always resolves (never rejects) with a classified outcome.
 */
export async function extractEventFromDocument(
  file: File,
  opts: ExtractOptions
): Promise<DocumentExtractionResult> {
  // 1) Compress client-side (also down-scales for the proxy cap + faster upload).
  let imageDataUrl: string;
  try {
    const compressed = await compress(file, opts.compression ?? DEFAULT_COMPRESSION);
    imageDataUrl = await blobToDataUrl(compressed.blob);
  } catch (err) {
    if (err instanceof CompressionError) {
      return { success: false, errorCode: 'compression', error: err.message };
    }
    return { success: false, errorCode: 'compression', error: 'Failed to prepare image' };
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
  const request: ExtractionRequest = { imageDataUrl, todayIso: opts.todayIso, signal: opts.signal };
  try {
    const data = await provider.extract(request);
    return { success: true, data };
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
