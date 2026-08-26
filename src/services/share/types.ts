// The one shape every share-target platform implements (#64).
//
// Adapters exist to turn a platform's delivery mechanism into `File[]` and nothing else.
// They contain NO branching on kind, flag, consent or route — every one of those decisions
// belongs to `useSharedDocumentIngest`, so a fourth platform is one file plus one registry
// entry rather than another copy of the flow. If an adapter needs a second decision, that is
// the signal the decision belongs in the orchestrator.

import type { ShareMeta } from '@/composables/useSharedDocumentIngest';

export type SharePlatform = ShareMeta['platform'];

/**
 * What a share actually carried. Adapters produce this and nothing else.
 *
 * `text` is whatever the sender attached as text — a bare link, prose around a link, or
 * plain text with no link at all. Deciding what to DO with it (files win, extract the URL,
 * or say there is no link) belongs to the orchestrator, not to three adapters.
 */
export interface SharedContent {
  files: File[];
  text?: string;
}

/**
 * The share-boundary cap on sender-supplied text.
 *
 * Enforced in the ORCHESTRATOR so every platform is bounded identically — an earlier draft
 * capped only in the Android plugin, which left the PWA path feeding an unbounded string
 * into a whole-string `split`. `ShareIntentPlugin.java` mirrors this value as
 * defence-in-depth; that native cap is a second line, never the only one.
 */
export const MAX_SHARE_TEXT_CHARS = 4000;

export interface ShareAdapter {
  name: SharePlatform;
  /** Whether this adapter can run here at all (right platform, plugin present). */
  isSupported(): boolean;
  /**
   * Begin listening. Returns a teardown function.
   *
   * The callback body is the adapter's ONLY logic. Implementations must wrap their own
   * async work in try/catch and report it: a rejection inside a native event listener
   * escapes Vue's error handler entirely, so an unguarded throw here is a share that
   * vanishes with the user told nothing.
   */
  start(onShare: (content: SharedContent, meta: ShareMeta) => void): () => void;
}
