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

/** The three things a shared document can turn out to be. Keep in step with `MAGIC_READERS`. */
export type ShareKind = 'event' | 'travel' | 'recipe';

/**
 * What the extraction produced ALONGSIDE the parsed data — the provenance artefacts each
 * review surface attaches. Shared by all three `deliverX` steps so they cannot drift into
 * three dialects of the same idea.
 */
export interface ResultEnvelope {
  /**
   * The source document. On a multi-file share this is the FIRST file only: all files are
   * READ, but the three attachment contracts (`TravelReady.sourceFile`, the activity source
   * photo, the recipe pending source) are single-file today and widening them to arrays is a
   * separate change across three review modals and their persistence paths.
   *
   * Non-optional on purpose: `TravelReady.sourceFile` is already `File`, and the share path
   * always has at least one real file, so no existing contract is loosened.
   */
  sourceFile: File;
  /** Page 1's client-compressed blob, reused as the thumbnail (no second compression pass). */
  compressedBlob?: Blob;
  /** True when the page cap bit — more pages/files were supplied than were read. */
  truncated?: boolean;
}

/** A classified extraction result routed to the page that owns its review modal. */
export type SharePayload =
  | { kind: 'event'; data: ExtractionResult; env: ResultEnvelope }
  | { kind: 'travel'; data: TravelExtractionResult; env: ResultEnvelope }
  | { kind: 'recipe'; data: RecipeExtractionResult; env: ResultEnvelope };
