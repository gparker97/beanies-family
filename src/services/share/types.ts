// The one shape every share-target platform implements (#64).
//
// Adapters exist to turn a platform's delivery mechanism into `File[]` and nothing else.
// They contain NO branching on kind, flag, consent or route — every one of those decisions
// belongs to `useSharedDocumentIngest`, so a fourth platform is one file plus one registry
// entry rather than another copy of the flow. If an adapter needs a second decision, that is
// the signal the decision belongs in the orchestrator.

import type { ShareMeta } from '@/composables/useSharedDocumentIngest';

export type SharePlatform = ShareMeta['platform'];

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
  start(onShare: (files: File[], meta: ShareMeta) => void): () => void;
}
