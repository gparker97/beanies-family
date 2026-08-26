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
export interface ShareLink {
  pageUrl: string;
  provenanceUrl: string;
  /** The page's own og:image / JSON-LD image. UNTRUSTED — screen with `boundedDishImage`. */
  imageUrl: string;
  path: ExtractionPath;
  kind: 'page' | 'youtube';
}

/**
 * Which of two shapes a recipe arrived in.
 *
 * A JSON-LD hit is NOT converted into a fake `RecipeExtractionResult`: doing so would mean
 * inventing confidence scores and `inferred` flags for the one path that cannot hallucinate.
 * The link is deliberately NOT repeated here — it lives on the envelope, because a link that
 * resolves to text arrives as `via: 'extraction'` and needs it just as much.
 */
export type RecipeShareSource =
  { via: 'extraction'; data: RecipeExtractionResult } | { via: 'jsonld'; recipe: JsonLdRecipe };

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
}

/** A classified extraction result routed to the page that owns its review modal. */
export type SharePayload =
  | { kind: 'event'; data: ExtractionResult; env: ResultEnvelope }
  | { kind: 'travel'; data: TravelExtractionResult; env: ResultEnvelope }
  | { kind: 'recipe'; source: RecipeShareSource; env: ResultEnvelope };
