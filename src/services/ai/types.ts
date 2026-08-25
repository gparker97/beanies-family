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
 * Managed-tier attestation rides on ANY task's result, so it is declared ONCE here rather
 * than on each result type. That is what lets the generic `run` below fold attestation in
 * with no cast and no per-task branch: `managedProvider` assigns onto a `T extends
 * AttestedResult`. Declaring it per-result instead forces an `as` cast at that call site.
 */
export interface AttestedResult {
  /** Managed tier only (see {@link AttestationInfo}); omitted by BYOK/on-device. */
  attestation?: AttestationInfo;
}

/**
 * What the model is given. Discriminated so a text-only task can never be handed images
 * by mistake, and so adding a third input kind is a compile error at every switch rather
 * than a silent fallthrough.
 *
 * `images`: `data:image/jpeg;base64,…` per client-compressed page of ONE document, in page
 * order. Always ≥1 (a photo is the single-element case; a PDF contributes up to
 * `MAX_EXTRACT_PAGES`). The model reads them as one document → one merged result.
 *
 * `text`: already-extracted plain text (a reduced web page, a video transcript). It is
 * UNTRUSTED — see the fencing rules in the prompt builders.
 */
export type ExtractionSource =
  { kind: 'images'; imageDataUrls: string[] } | { kind: 'text'; text: string };

/**
 * A single document to extract from. Data-minimization: this is one document, never the
 * family dataset.
 *
 * NOTE: there is deliberately no `task` field. The task is `run`'s first argument, and
 * carrying it in both places creates two sources of truth that can disagree.
 */
export interface ExtractionRequest {
  source: ExtractionSource;
  /** Current date `YYYY-MM-DD`, so the model can resolve relative/partial dates. */
  todayIso: string;
  /** Optional cancel signal so the UI can abort a slow extraction. */
  signal?: AbortSignal;
}

/**
 * Task → result type. This map is the SINGLE place the task union grows: adding an entry
 * here gives you the task id, the provider's return type, and the registry key at once.
 * `event` is the #133 invitation→activity wedge; `travel` is the #30 document→segment wedge.
 */
export interface ExtractionResultByTask {
  event: ExtractionResult;
  travel: TravelExtractionResult;
  recipe: RecipeExtractionResult;
}

/** The extraction tasks the funnel supports (one prompt/schema/parser per task). */
export type ExtractionTask = keyof ExtractionResultByTask;

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
export interface ExtractionResult extends AttestedResult {
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
export interface TravelExtractionResult extends AttestedResult {
  /** False when the document is not a travel booking — handled gracefully, never invented. */
  isTravel: boolean;
  /** Suggested destination-based trip name, or `''`. */
  tripName: string;
  /** One of the 6 VacationTripType values, or `''` if unclear. */
  tripTypeHint: string;
  segments: TravelSegmentDraft[];
}

/** One ingredient or step, carrying whether the model INFERRED it rather than read it. */
export interface RecipeLine {
  text: string;
  /**
   * True when the model filled this in from culinary knowledge rather than reading it.
   * Surfaced in the review step so the user knows what to check — this is the mitigation
   * for the accepted gap that a video's on-screen-only quantities are never heard.
   */
  inferred: boolean;
}

/** Per-field 0..1 confidence for a recipe extraction. */
export interface RecipeFieldConfidence {
  name: number;
  ingredients: number;
  steps: number;
}

/** The structured recipe extracted from a source. Mirrors RECIPE_JSON_SHAPE (#72). */
export interface RecipeExtractionResult extends AttestedResult {
  /** False when the source is not a recipe — handled gracefully, never invented. */
  isRecipe: boolean;
  name: string;
  subtitle: string;
  prepTime: string;
  cookTime: string;
  servings: string;
  ingredients: RecipeLine[];
  steps: RecipeLine[];
  notes: string;
  /**
   * A model-supplied URL to a photo of the finished dish, or ''. UNTRUSTED and NOT yet
   * screened here — the caller must put it through `safeHttpsUrl` (and, on the fetch path,
   * a same-domain check) before it is fetched or stored. Never bind it to an element.
   */
  imageUrl: string;
  confidence: RecipeFieldConfidence;
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
  | 'malformed_output' // the model returned unparseable or wrong-shape JSON
  | 'fetch_blocked' // the SSRF guard refused the URL, or it was not fetchable at all (#72)
  | 'no_content'; // fetched fine, but nothing readable came back: no JSON-LD, no usable
// text, no captions (#72). Distinct from provider_error — the request SUCCEEDED.

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
  /**
   * Run ONE extraction task. Deliberately generic rather than one method per task: the
   * previous shape (`extract` + `extractTravel`) grew a near-identical member for every
   * new task across all three providers. Adding a task to {@link ExtractionResultByTask}
   * now requires NO provider change at all.
   */
  run<T extends ExtractionTask>(
    task: T,
    request: ExtractionRequest
  ): Promise<ExtractionResultByTask[T]>;
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
