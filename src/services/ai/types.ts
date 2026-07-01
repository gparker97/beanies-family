// Domain types for the private-AI document-extraction capability (ADR-030, #133).
//
// DESIGN INVARIANT — interface purity (longevity): the provider contract below
// (`ExtractionProvider`) is expressed PURELY in domain terms — a document in,
// structured event fields out. No provider-shaped fields (OpenAI `choices`,
// message roles, model ids), no transport concerns, and no API keys appear here;
// those live entirely inside each provider module (`providers/*`). Adding a new
// provider (managed-TEE, BYOK, on-device) must NOT require widening these types.
// `attestation` is metadata of the *managed* result only → an OPTIONAL field that
// on-device/BYOK providers simply omit. Never make it required.

/** Preference-ordered tiers. See ADR-030. Canonical definition lives in `@/types/models`
 *  (so `Settings.aiTier` can reference it without a layering inversion); re-exported here
 *  for the AI service/provider modules. */
export type { AiTier } from '@/types/models';

/**
 * Concrete inference backends. `tinfoil` is the managed-tier engine (server-held
 * key, reached via our proxy); `openai`/`claude`/`gemini` are BYOK targets;
 * `on-device` is the future in-browser tier.
 */
export type AiProviderId = 'tinfoil' | 'openai' | 'claude' | 'gemini' | 'on-device';

/**
 * A single document to extract from. Data-minimization: this is one document's
 * already-compressed page image(s) — never the family dataset. Each image is a
 * base64 `data:` URL so the request travels as a self-contained payload.
 */
export interface ExtractionRequest {
  /**
   * `data:image/jpeg;base64,…` for each client-compressed page of ONE document, in
   * page order. Always ≥1 (a photo is the single-element case; a PDF contributes up
   * to `MAX_EXTRACT_PAGES`). The model reads them as one document → one merged result.
   */
  imageDataUrls: string[];
  /** Current date `YYYY-MM-DD`, so the model can resolve relative/partial dates. */
  todayIso: string;
  /** Optional cancel signal so the UI can abort a slow extraction. */
  signal?: AbortSignal;
  /**
   * Which extraction task to run. `event` (default) is the #133 invitation→activity
   * wedge; `travel` is the #30 document→travel-segment wedge. The provider selects the
   * task-appropriate prompt + parser; omitting it preserves the original event behavior.
   */
  task?: ExtractionTask;
}

/** The extraction tasks the funnel supports (one prompt/schema/parser per task). */
export type ExtractionTask = 'event' | 'travel';

/** Per-field 0..1 confidence so the UI can flag low-confidence values for review. */
export interface FieldConfidence {
  title: number;
  date: number;
  startTime: number;
  endTime: number;
  location: number;
}

/**
 * Managed-tier-only attestation metadata, passed through from the confidential
 * enclave. Omitted by BYOK/on-device providers. Kept intentionally small for now;
 * Gate 3 (verification-SDK + EHBP) fills in the verified measurement.
 */
export interface AttestationInfo {
  /** Named enclave, e.g. `qwen3-vl-30b.inf10.tinfoil.sh`. */
  enclave?: string;
  /** True once the client SDK has verified the enclave measurement (Gate 3). */
  verified?: boolean;
}

/** The structured event fields extracted from a document. Mirrors EXTRACTION_JSON_SHAPE. */
export interface ExtractionResult {
  /** False when the image is not an event/invitation — handled gracefully, never invented. */
  isEvent: boolean;
  title: string;
  /** ISO `YYYY-MM-DD`, or `''` if absent. */
  date: string;
  /** 24h `HH:mm`, or `''`. */
  startTime: string;
  /** 24h `HH:mm`, or `''`. */
  endTime: string;
  isAllDay: boolean;
  location: string;
  description: string;
  /**
   * Optional free-text category label the model suggests (e.g. "birthday", "soccer game").
   * The client maps it to an ActivityCategory (see utils/extractionToActivity). OPTIONAL:
   * an older deployed managed proxy omits it, and BYOK/on-device may too — callers must
   * tolerate its absence and fall back to keyword inference.
   */
  categoryHint?: string;
  /**
   * Optional category id the model picks directly from the app taxonomy (the closed list
   * embedded in the prompt). OPTIONAL for the same backward-compat reasons as categoryHint.
   * NOT trusted blindly — the mapper validates it against ACTIVITY_CATEGORIES and falls back
   * to keyword inference (categoryHint, then title/description) when it is absent or unknown.
   */
  category?: string;
  confidence: FieldConfidence;
  /** Managed tier only (see AttestationInfo). */
  attestation?: AttestationInfo;
}

/**
 * One booking the travel model extracted from a document, defensively typed (#30).
 * `fields` carries every recognized string field by name; the pure mapper
 * (`utils/travelExtractionToSegments`) decides which apply to the chosen kind/type and
 * folds the rest into the segment's notes — so nothing the model returned is lost.
 */
export interface TravelSegmentDraft {
  kind: 'travel' | 'accommodation' | 'transportation';
  /** Kind-specific sub-type string (coerced to a valid enum by the mapper). */
  type: string;
  title: string;
  status: 'booked' | 'pending';
  bookingReference: string;
  notes: string;
  arrivesNextDay: boolean;
  breakfastIncluded: boolean;
  /** Recognized string fields keyed by model field name (e.g. `departureAirport`). */
  fields: Record<string, string>;
  /** Names of the people on this segment, exactly as written in the document (or []). */
  travellers: string[];
  /** Overall 0..1 confidence for the segment (the model's `confidence.overall`). */
  confidence: number;
}

/** The structured travel result extracted from a document. Mirrors TRAVEL_JSON_SHAPE. */
export interface TravelExtractionResult {
  /** False when the document is not a travel booking — handled gracefully, never invented. */
  isTravel: boolean;
  /** Suggested destination-based trip name, or `''`. */
  tripName: string;
  /** One of the 6 VacationTripType values, or `''` if unclear. */
  tripTypeHint: string;
  segments: TravelSegmentDraft[];
}

/**
 * Stable error codes the UI maps to a friendly toast. The service classifies every
 * failure into exactly one of these — there are no silent or unclassified failures
 * (see docs/lessons.md). Reporting (toast + reportError) is the CALLER's job, not
 * the service's, so it isn't double-reported.
 */
export type ExtractionErrorCode =
  | 'offline' // no network (the composable guards before calling, but providers may also surface it)
  | 'compression' // the file could not be decoded/compressed (e.g. HEIC on Chromium)
  | 'not_available' // tier/provider unavailable (on-device stub, BYOK missing/unsupported)
  | 'provider_error' // upstream non-2xx or network failure (hard failure)
  | 'upstream_busy' // the inference provider is overloaded/down (5xx) — TRANSIENT, retryable
  | 'timeout' // the request was aborted / exceeded the deadline
  | 'malformed_output'; // the model returned unparseable or wrong-shape JSON

/**
 * Result of the extraction funnel. Per-service `{ success, … }` shape — matching
 * `FetchResult`/`UpdateResult` (exchangeRateService) and the passkeyService result
 * interfaces. There is deliberately NO generic `Result<T>` in this codebase; do not
 * introduce one.
 */
export interface DocumentExtractionResult<T = ExtractionResult> {
  success: boolean;
  data?: T;
  errorCode?: ExtractionErrorCode;
  /** Human-readable detail for logs/diagnostics (never shown raw to users). */
  error?: string;
  /**
   * The client-compressed document image (#133) — present on success so the caller can
   * attach the source photo to the created activity without re-compressing. For a
   * multi-page PDF this is PAGE 1's compressed image (the representative thumbnail).
   * Envelope-level metadata ONLY; never folded into `data` (the model output stays pure
   * text — interface purity invariant above). Always a JPEG, so its mime is on `Blob.type`.
   */
  compressedBlob?: Blob;
  /**
   * True when the source PDF had more pages than `MAX_EXTRACT_PAGES` and only the first
   * pages were read. Envelope metadata so the caller can surface a "read the first pages"
   * notice; the full original file is still attached to the item.
   */
  truncated?: boolean;
}

/**
 * A provider turns one document into structured event fields. PURE domain contract
 * (see the interface-purity invariant at the top of this file). Providers throw an
 * `ExtractionProviderError` on failure; the service catches and classifies.
 */
export interface ExtractionProvider {
  readonly id: AiProviderId;
  /** Event/invitation → activity extraction (#133). */
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
  /** Travel document → travel-segment extraction (#30). */
  extractTravel(request: ExtractionRequest): Promise<TravelExtractionResult>;
}

/** Typed provider failure carrying a stable {@link ExtractionErrorCode}. */
export class ExtractionProviderError extends Error {
  readonly code: ExtractionErrorCode;
  readonly cause?: unknown;
  constructor(code: ExtractionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExtractionProviderError';
    this.code = code;
    this.cause = cause;
  }
}
