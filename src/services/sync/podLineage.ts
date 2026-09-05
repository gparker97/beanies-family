/**
 * Which document may be merged with which, and what to do when they disagree.
 *
 * Pure — no I/O, no module state, like `remoteBaseline.ts` beside it.
 *
 * ⚠️ THE INVARIANT: a document may only be CRDT-merged with a document of the
 * same LINEAGE. Anything else is adopted wholesale, or refused — never merged.
 *
 * `Automerge.from(Automerge.toJS(doc))` is the only way to drop history in
 * Automerge 3.x, and it mints brand-new object ids. The compacted document
 * therefore shares no ancestry with the original, so a merge is a map-level
 * conflict rather than a reconciliation. Measured on a two-account document:
 * merging a compacted pod into a peer still holding the original history
 * destroyed that peer's unsynced changes 200 runs out of 200 — both an edit to
 * an existing entity and a newly created one. On a single-key document the
 * outcome flips run to run on random actor ordering, which is worse, because it
 * looks like it works.
 */
import type { PodLineage } from '@/types/syncFileV4';

/** How the two lineages relate. A fact, with no policy in it. */
export type LineageVerdict = 'same' | 'adopt-remote' | 'ours-newer' | 'conflict';

/** What the caller should DO. The four things a caller can actually perform. */
export type LineageAction = 'merge' | 'adopt' | 'publish-local' | 'block';

/**
 * What this device can PROVE about its own document.
 *
 * ⚠️ Deliberately NOT "open vs mid-session". A wall-clock phase gets both ends
 * wrong: a peer's FIRST post-compaction sync arrives through the ordinary poll
 * path, so classifying that as "mid-session, block" means every peer in the
 * fleet latches and none ever adopts — a compaction could never propagate. And
 * it blocks the rollback route, because re-opening the pre-compaction file
 * looks like "ours is newer".
 *
 *  - `clean`     — our document provably holds nothing the remote has not seen.
 *  - `dirty`     — it might. Never adopt over this.
 *  - `user-file` — the human explicitly chose these bytes. That IS the decision
 *                  the guard exists to demand, so it never blocks.
 */
export type LineageContext = 'clean' | 'dirty' | 'user-file';

/** Thrown by `guardLineage` when the two documents must not be combined. */
export class PodLineageError extends Error {
  readonly verdict: LineageVerdict;
  constructor(verdict: LineageVerdict, message: string) {
    super(message);
    // ⚠️ LITERAL, never `new.target.name`. The worker error registry keys on
    // `err.name` and the prod build minifies, so a derived name would arrive
    // mangled and the `instanceof` dispatch on main would silently degrade.
    this.name = 'PodLineageError';
    this.verdict = verdict;
  }

  /** `RemoteBlocker`: the short, stable code for `error_code`. */
  get blockCode(): string {
    return this.verdict;
  }
}

export function compareLineage(
  remote: PodLineage | undefined,
  local: PodLineage | undefined
): LineageVerdict {
  if (!remote && !local) return 'same'; // the whole fleet, today
  if (remote && local && remote.id === local.id) return 'same';
  if (!local) return 'adopt-remote'; // remote has been compacted; we have not
  if (!remote) return 'ours-newer'; // we compacted; the remote is pre-compaction
  if (remote.seq > local.seq) return 'adopt-remote';
  if (remote.seq < local.seq) return 'ours-newer';
  // Same generation, different identity: two devices compacted concurrently.
  // A machine cannot pick between them and must not try.
  return 'conflict';
}

/**
 * THE policy, as one table.
 *
 * A switch at each of the three consumers would be the same policy written
 * three times, drifting independently the first time a fifth verdict or a
 * fourth context appears. Consumers switch on the four ACTIONS they can
 * actually perform; this module owns what the verdicts MEAN.
 *
 * Three properties worth naming, because each one was got wrong in a draft:
 *  1. the whole `same` column is `merge` — a never-compacted pod behaves
 *     byte-for-byte as it does today, in every context, by the shape of the
 *     table rather than by inspection;
 *  2. `adopt-remote` + `clean` adopts EVERYWHERE, including on the poll path.
 *     That is the only route by which a compaction reaches a peer;
 *  3. `user-file` never blocks. Without it the guard refuses the
 *     pre-compaction `.beanpod` that is the only rollback route — the guard
 *     would have made the recovery it mandates impossible.
 */
const POLICY: Record<LineageVerdict, Record<LineageContext, LineageAction>> = {
  same: { clean: 'merge', dirty: 'merge', 'user-file': 'merge' },
  'adopt-remote': { clean: 'adopt', dirty: 'block', 'user-file': 'adopt' },
  'ours-newer': { clean: 'publish-local', dirty: 'publish-local', 'user-file': 'adopt' },
  conflict: { clean: 'block', dirty: 'block', 'user-file': 'adopt' },
};

export function lineageAction(verdict: LineageVerdict, ctx: LineageContext): LineageAction {
  return POLICY[verdict][ctx];
}

const WHY: Record<LineageVerdict, string> = {
  same: 'same lineage',
  'adopt-remote': 'the remote pod has been compacted and this device has unsaved changes',
  'ours-newer': 'this device holds an unpublished compaction and the remote has moved',
  conflict: 'two devices compacted this pod at the same time',
};

/**
 * Compare, apply the policy, and THROW on `block`.
 *
 * Returns one of the three non-blocking actions, so no caller re-maps the
 * verdict and no caller can forget a case.
 *
 * Termini (keep this list in step with the tests):
 *   1. syncStore.replaceDocWithCacheRecovery   (cache recovery + file adopt)
 *   2. syncStore.hydrateFromEnvelope           (background recovery)
 *   3. syncService.fetchAndMergeRemote         (poll + pre-save)
 */
export function guardLineage(
  remote: PodLineage | undefined,
  local: PodLineage | undefined,
  ctx: LineageContext
): Exclude<LineageAction, 'block'> {
  const verdict = compareLineage(remote, local);
  const action = lineageAction(verdict, ctx);
  if (action === 'block')
    throw new PodLineageError(verdict, `Pod lineage blocked: ${WHY[verdict]}`);
  return action;
}
