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
// inspects the token — it only demands it. Data-minimization: only the compressed document
// leaves the device, never the family dataset — with ONE named exception, the `statement`
// task's merchant memory (`ExtractOptions.context`, ADR-030's 2026-09-25 update, #107).

import {
  compress,
  CompressionError,
  type CompressOptions,
} from '@/services/photos/photoCompression';
import type { ConsentGrant } from '@/composables/useDocumentConsent';
import type { ExtractionContext, HintReason, ShareKindHint } from './types';
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
  type ExtractionResultByTask,
  type ExtractionSource,
  type ExtractionTask,
  type RecipeExtractionResult,
  type ShareExtractionResult,
  type StatementExtractionResult,
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
  /**
   * Which family this read is billed to.
   *
   * REQUIRED since the meter. It used to be optional in both directions, and the reason it
   * gave — an absent id degrades to the proxy's IP limit — stopped being acceptable once every
   * read had to be counted: with no id the Lambda has no partition key to write under, so the
   * read happens, costs us money, and leaves no row. That is the loophole the meter exists to
   * close, so an unattributable read is now REFUSED before the model
   * (`resolveBillableFamilyId`), and omitting this is a compile error rather than a silent
   * fallback.
   *
   * The Lambda still ACCEPTS a request without one and must continue to — every cached old
   * bundle sends none, and 400ing them would break working installs. That asymmetry is
   * deliberate; the skipped count is logged and alarmed so its real rate is visible.
   *
   * Still an OPTION rather than a store read: this module is deliberately store-free
   * (`grep -rn "from '@/stores/" src/services/ai/` returns nothing), and calling a store here
   * would put app state into the one AI module that has none.
   */
  familyId: string;
  /**
   * Set on a correction re-read, or on a first read the person pre-labelled from the
   * magic-beans sheet (#108, `reason: 'stated'`). `to` is what makes the read targeted;
   * `token` is the managed-tier grant that makes a CORRECTION free, and is absent on BYOK and
   * on-device, whose reads cost us nothing, and always absent on a stated first read, which
   * is billed like any other. Mirrors `ExtractionRequest.correction`.
   */
  correction?: { token?: string; to: ShareKindHint; reason?: HintReason };
  /**
   * The `statement` task's merchant memory (#107): the ONLY family data any read carries,
   * disclosed on the statement consent sheet. Every other task ignores it.
   */
  context?: ExtractionContext;
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
    familyId: opts.familyId,
    ...(opts.correction ? { correction: opts.correction } : {}),
    ...(opts.context ? { context: opts.context } : {}),
  };
  try {
    const data = await provider.run(task, request);
    // `preparedSource` is the WIRE payload — the compressed data URLs or the text actually
    // sent. A correction must re-send exactly these bytes: the server fingerprints what it
    // received, so re-preparing the original file would produce different canvas-JPEG output
    // and the grant would be refused on a document the user never changed.
    return { success: true, data, compressedBlob, truncated, preparedSource: source };
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
 * Re-run the `share` task over a source that has ALREADY been prepared and paid for.
 *
 * Skips `prepareImageDataUrls` deliberately: the proxy fingerprints the exact bytes it
 * received, and a second compression pass would not reproduce them. The ONLY caller is the
 * spine's correction arm — every other entry point takes a `File` or a string and prepares it.
 */
export function extractShareFromPreparedSource(
  source: ExtractionSource,
  opts: ExtractOptions
): Promise<DocumentExtractionResult<ShareExtractionResult>> {
  return runWithSource(source, opts, 'share', undefined, false);
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
 * Classify AND extract already-fetched or shared TEXT in ONE call (#64 links, #83 text).
 *
 * ⚠️ The text is UNTRUSTED, and since #83 it is no longer even provenance-bounded. It is
 * EITHER a page/video description fetched by `content-fetch` behind its SSRF guard, OR raw
 * text a person supplied directly — selected in another app and shared in, or pasted into the
 * magic-beans sheet inside beanies (#84). This JSDoc used
 * to promise "never a raw user string"; that guarantee was traded, deliberately and once, for
 * the rate limiting that replaced it (`docs/adr/035-plain-text-share-provenance.md`).
 *
 * What still holds, and is what makes the trade safe:
 *   - the prompt builder fences the text in untrusted-content markers and instructs the model
 *     to ignore instructions inside it (`extractionPrompt.ts` → `buildUserMessage`);
 *   - the caller bounds the length before it gets here;
 *   - nothing is persisted without the user confirming it in a review modal;
 *   - the proxy throttles per family and per IP.
 *
 * Never the bare URL: the model cannot fetch, and `youtu.be/dQw4w9` tells it nothing.
 * Always resolves with a classified outcome.
 */
export function extractShareFromText(
  text: string,
  opts: ExtractOptions
): Promise<DocumentExtractionResult<ShareExtractionResult>> {
  return runExtraction(text, opts, 'share');
}

/**
 * Compress ONE rendered page or photo into the wire source a statement read sends (#107).
 *
 * The statement reader renders and classifies pages itself (it must know the page count
 * before consent, and it keeps dropped pages for "read it anyway"), so it cannot go through
 * `prepareImageDataUrls`, whose `MAX_EXTRACT_PAGES` cap and first-N rasterisation are exactly
 * what a statement must not have. It still uses the same compressor and the same defaults, so
 * a statement page is the same size on the wire as any other page. Throws `CompressionError`.
 */
export async function prepareImageSource(
  image: File,
  compression: CompressOptions = DEFAULT_COMPRESSION
): Promise<ExtractionSource> {
  const compressed = await compress(image, compression);
  return { kind: 'images', imageDataUrls: [await readImageDataUrl(compressed.blob)] };
}

/**
 * Read ONE unit of a statement (#107): a rendered page, a photo, or a text chunk of a pasted
 * statement or CSV export. Text is untrusted and fenced as data by the shared prompt builder.
 * Always resolves with a classified outcome.
 */
export function extractStatementFromSource(
  source: ExtractionSource,
  opts: ExtractOptions
): Promise<DocumentExtractionResult<StatementExtractionResult>> {
  return runWithSource(source, opts, 'statement', undefined, false);
}
