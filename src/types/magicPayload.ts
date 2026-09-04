// The payload a share hands to the page that owns the matching review modal (#64).
//
// TYPES ONLY — no runtime imports beyond the AI result types. This module exists so
// `useMagicReader` (the dispatch channel) and `useSharedDocumentIngest` (the producer) can
// both name the payload without importing each other, which would be a cycle.
//
// The union is discriminated on `kind` so a travel result can never be handed to
// `deliverEvent`. Every consumer narrows on it and closes with `assertNever`, so adding a
// fourth reader is a build error at every page rather than a silent no-op at one of them.

import type {
  ExtractionResult,
  RecipeExtractionResult,
  TravelExtractionResult,
} from '@/services/ai/types';
import type { ExtractionPath } from '@/services/ai/recipeSourceResolver';
import type { JsonLdRecipe } from '@/services/ai/recipeFetchService';

/** The three things a shared document can turn out to be. Keep in step with `MAGIC_READERS`. */
export type ShareKind = 'event' | 'travel' | 'recipe';

/**
 * Where a shared LINK came from, and what may be trusted about it (#64 links).
 *
 * The two URLs are deliberately separate and are NOT interchangeable:
 *  - `pageUrl` is the page actually read. It is the same-registrable-domain BOUND on any
 *    image the page declares — pass the wrong one and a hostile page's image is either
 *    wrongly accepted or every legitimate one is dropped.
 *  - `provenanceUrl` is what gets STORED: the video the user shared, not the blog post the
 *    YouTube ladder followed to find the recipe.
 * For a plain page share they are the same string; for a video capture they are not, which
 * is exactly when getting them the wrong way round is silent.
 */
/**
 * Which rung of the dish-image ladder produced a candidate (#86).
 *
 * This is a TELEMETRY LABEL, not an authorisation. The client must never reject a candidate
 * for carrying a value it does not recognise: the Lambda deploys ahead of the client, so a
 * newly-added rung would have every one of its candidates silently dropped on-device for the
 * whole deploy window — the exact silent-drop class this issue exists to remove. Unknown
 * values are coerced to `other` and kept; see `screenCandidates`.
 *
 * `other` is a real member so the unknown case shows up in the CloudWatch rung distribution
 * rather than being invisible.
 */
export const IMAGE_SOURCES = [
  'jsonld',
  'og_image',
  'og_secure',
  'twitter',
  'twitter_src',
  'link_rel',
  'thumbnail',
  'youtube_thumb',
  'other',
] as const;

export type ImageSource = (typeof IMAGE_SOURCES)[number];

/** One candidate dish photo, as extracted from the page by the content-fetch Lambda. */
export interface ImageCandidate {
  /** Already absolutised and syntactically screened. The BYTES are still unverified. */
  url: string;
  source: ImageSource;
}

/**
 * Why a capture ended with no stored dish image, as a closed vocabulary (#86).
 *
 * Declared ONCE and imported by every log site rather than typed as bare string literals: the
 * value space is shared across four `action`s, and a typo'd literal is a CloudWatch dimension
 * that silently never matches.
 *
 * ⚠️ `compress_failed` is deliberately absent. `usePhotos.add` returns `[]` identically for a
 * cloud-off refusal, an at-cap refusal, a rejected type and a thrown CompressionError, and the
 * richer context it logs is not allowlisted. Since cloud and cap are checked BEFORE the call,
 * a surviving `store_rejected` already means "decode or upload failed" by elimination.
 * Declaring a value we can never emit would read in CloudWatch as evidence it never happens.
 */
export const IMAGE_NONE_REASONS = [
  'no_candidates',
  'all_failed',
  'cloud_required',
  'at_cap',
  'store_rejected',
] as const;

export type ImageNoneReason = (typeof IMAGE_NONE_REASONS)[number];

/**
 * The dish-image half of a recipe prefill: the candidates, plus the FACT that a source page
 * existed and which kind it was (#86).
 *
 * The `kind` earns its place twice over — it is the `kind` context key on the telemetry, and
 * its mere presence is what distinguishes "a page declared no images" (candidates: []) from
 * "there was no page" (the whole object is null). See the note on `RecipePrefill.dishImage`.
 */
export interface DishImagePrefill {
  kind: 'page' | 'youtube';
  candidates: ImageCandidate[];
  /** The page the candidates came from, forwarded as a `Referer` when fetching them. */
  pageUrl: string;
}

export interface ShareLink {
  pageUrl: string;
  provenanceUrl: string;
  /**
   * The page's declared images, best first. UNTRUSTED — screen with `screenCandidates`.
   *
   * Replaced a single `imageUrl` in #86. May legitimately be empty: a page that declared no
   * image at all is a distinct, and loggable, outcome from a capture that had no page.
   */
  imageCandidates: ImageCandidate[];
  path: ExtractionPath;
  kind: 'page' | 'youtube';
}

/**
 * Which shape a recipe arrived in.
 *
 * A JSON-LD hit is NOT converted into a fake `RecipeExtractionResult`: doing so would mean
 * inventing confidence scores and `inferred` flags for the one path that cannot hallucinate.
 * The link is deliberately NOT repeated here — it lives on the envelope, because a link that
 * resolves to text arrives as `via: 'extraction'` and needs it just as much.
 */
export type RecipeShareSource =
  | { via: 'extraction'; data: RecipeExtractionResult }
  | { via: 'jsonld'; recipe: JsonLdRecipe }
  /**
   * A video whose recipe is only spoken aloud. All we have is its title — see the
   * `titleOnly` note on `ResolvedRecipeSource` for why the captions are out of reach — and
   * a named, linked recipe the user finishes themselves beats losing the capture.
   */
  | { via: 'titleOnly'; title: string };

/**
 * What the extraction produced ALONGSIDE the parsed data — the provenance artefacts each
 * review surface attaches. Shared by all three `deliverX` steps so they cannot drift into
 * three dialects of the same idea.
 */
export interface ResultEnvelope {
  /**
   * The source document, or `null` for a link (a link has no file).
   *
   * On a multi-file share this is the FIRST file only: all files are READ, but the three
   * attachment contracts (`TravelReady.sourceFile`, the activity source photo, the recipe
   * pending source) are single-file today, and widening them to arrays is a separate change
   * across three review modals and their persistence paths.
   *
   * Required-but-NULLABLE rather than optional: an optional field lets a future construction
   * site omit it and silently lose the attachment, where this makes the compiler demand an
   * answer.
   */
  sourceFile: File | null;
  /** Page 1's client-compressed blob, reused as the thumbnail (no second compression pass). */
  compressedBlob?: Blob;
  /** True when the page cap bit — more pages/files were supplied than were read. */
  truncated?: boolean;
  /** Present iff the share was a link. The ONE home for link provenance. */
  link?: ShareLink;
  /**
   * Where this capture entered from.
   *
   * `recipe-extract` pairs a `start` event with a `ready` one so a failure RATE is
   * computable. A page's OWN readers log `start` themselves before their await; a capture
   * that was read by the ORCHESTRATOR (a share, or the in-app magic-beans button) arrives
   * straight at delivery, so without this flag its `ready` had no denominator and the pair
   * silently stopped balancing.
   *
   * ⚠️ Widened from `'share'` in #84. Any reader that tests `=== 'share'` rather than for
   * presence will silently stop compensating for an in-app capture — see `useRecipeCapture`.
   */
  origin?: 'share' | 'in-app';
}

/**
 * Telemetry surface per entry point (#84).
 *
 * Lives HERE rather than in `useSharedDocumentIngest` because `useMagicReader` needs it too,
 * and that file is imported BY the orchestrator — putting it there would be an import cycle.
 * This module is types-only and imports neither, so it is the one place both can reach.
 *
 * The surface is what separates the two funnels in CloudWatch. An event filed under the wrong
 * one is not a cosmetic problem: it makes "how many in-app captures failed" unanswerable.
 */
export const INGEST_SURFACES = {
  share: 'share-target-ingest',
  'in-app': 'magic-beans-capture',
} as const;

/** The surface for a capture's origin. A payload-less opener has no origin — treat as share. */
export function surfaceForOrigin(origin: ResultEnvelope['origin']): string {
  return INGEST_SURFACES[origin ?? 'share'];
}

/** A classified extraction result routed to the page that owns its review modal. */
export type SharePayload =
  | { kind: 'event'; data: ExtractionResult; env: ResultEnvelope }
  | { kind: 'travel'; data: TravelExtractionResult; env: ResultEnvelope }
  | { kind: 'recipe'; source: RecipeShareSource; env: ResultEnvelope };
