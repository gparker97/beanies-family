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
 * conflict rather than a reconciliation. And merging one into a peer still on the original history is NOT a coin flip.
 * `Automerge.from` renumbers every opId, and Automerge breaks a map-write tie
 * by opId COUNTER before it falls back to the actor id. A collection added by a
 * later `migrateDoc` therefore carries a HIGH counter in the old lineage and a
 * LOW one in the compacted pod, so the OLD lineage wins DETERMINISTICALLY.
 * Measured over 60 trials: the compactor's post-compaction edits were destroyed
 * 60/60 in `recipes` (added by a later migration) and 29/60 in `accounts`
 * (created in the first change, where the counters tie and the actor id decides).
 * The earlier "200/200" and "~50% coin flip" figures both came from
 * single-collection probes, which can only ever exhibit the tie case.
 */
import type { PodLineage } from '@/types/models';
import type { PodBlockMessageKey, RemoteBlocker } from '@/types/sync';

/** How the two lineages relate. A fact, with no policy in it. */
export type LineageVerdict = 'same' | 'adopt-remote' | 'ours-newer' | 'conflict';

/** What the caller should DO. The four things a caller can actually perform. */
export type LineageAction = 'merge' | 'adopt' | 'rebase' | 'publish-local' | 'block';

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
 *  - `user-file` — the human explicitly chose these bytes, having been shown
 *                  what is lost. That IS the decision the guard exists to
 *                  demand, so it never blocks.
 *
 * ⚠️ `user-file` HAS EXACTLY ONE PRODUCER, and adding a second is a data-loss
 * change. It is `syncStore.useRemoteFileOverLocalDocument` — the lineage
 * banner's action, behind a `confirm({variant:'danger'})` that names what is let
 * go — and the choice travels as an ARGUMENT on that one call, never as module
 * state. It was briefly armed by `rebindPodFile` as well, which is WRONG:
 * `rebindPodFile` is the generic access repair for PERMISSION_DENIED,
 * FILE_NOT_FOUND, CANONICAL_MISMATCH and NO_HOME (plus the save-failure banner),
 * and in none of those is the human answering a lineage question. `user-file`
 * never blocks and `adopt` destroys the local document, so a canonical-mismatch
 * repair would silently discard work that lived only in the private copy — and
 * `conflict` × `user-file` = `adopt` is precisely the choice the banner refuses
 * to offer. `podAccess.ts` states the rule: verification may REPORT a problem,
 * never RESOLVE one.
 *
 * ⚠️ SO TWO CELLS OF THIS COLUMN ARE CURRENTLY UNREACHABLE, and that is a known
 * gap, not an oversight. Only `adopt-remote` × `user-file` is produced. Nothing
 * reaches `ours-newer` × `user-file`, which means THE ROLLBACK IS NOT WIRED:
 * re-pointing at a pre-compaction `.beanpod` compares `ours-newer` →
 * `publish-local`, so this device republishes its compacted document over the
 * file the family just chose, with no block and therefore no banner to recover
 * from. Wiring it needs a surface that asks the human first — Stage 2's job,
 * alongside the rebase. Do NOT close the gap by arming an access repair.
 */
export type LineageContext = 'clean' | 'dirty' | 'user-file';

/** Thrown by `guardLineage` when the two documents must not be combined. */
export class PodLineageError extends Error implements RemoteBlocker {
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

  /** A lineage mismatch is a fact about the two documents; a retry cannot change it. */
  get latches(): boolean {
    return true;
  }

  /**
   * `RemoteBlocker`: which inline message the sync bar shows.
   *
   * Two, because the two blocking verdicts have different actions. An
   * `adopt-remote` block is recoverable by the user (save or export the local
   * changes, then reload); a `conflict` is not something they can resolve, and
   * the honest copy says so rather than sending them round a loop.
   */
  get inlineMessageKey(): PodBlockMessageKey {
    return this.verdict === 'conflict' ? 'podLineage.conflictInline' : 'podLineage.unsyncedInline';
  }
}

export function compareLineage(
  remote: PodLineage | null,
  local: PodLineage | null
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
  // ⚠️ `dirty` REBASES (Stage 3, R1) — it does not block. The peer's unsynced
  // work is replayed onto the new lineage instead of the family being asked to
  // give it up. Every way that replay can fail falls back to this cell's old
  // value, so the rebase can only ever lose LESS than the block it replaced.
  // ⚠️ `user-file` REBASES TOO, and getting this wrong made the DELIBERATE
  // choice the destructive one. With `dirty` rebasing, a peer that did nothing
  // kept every offline edit — while a peer whose owner explicitly picked the
  // file (which our own copy tells them to do) had the lot discarded by
  // `adopt`. The column exists so an explicit choice never BLOCKS; `rebase`
  // does not block either, so there was never an argument for losing the work.
  // The worker falls back to `adopt` here — not to the block — because the
  // human already said "replace what is on this device".
  'adopt-remote': { clean: 'adopt', dirty: 'rebase', 'user-file': 'rebase' },
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
  remote: PodLineage | null,
  local: PodLineage | null,
  ctx: LineageContext
): Exclude<LineageAction, 'block'> {
  const verdict = compareLineage(remote, local);
  const action = lineageAction(verdict, ctx);
  if (action === 'block') throw lineageBlockError(verdict);
  return action;
}

/**
 * The block, as a factory — so the copy has ONE source.
 *
 * The worker raises the same error when a REBASE turns out to be unavailable
 * (no baseline heads, or heads this document's history does not contain), and
 * the user must not be able to tell the two apart: both mean "these two
 * documents cannot be combined here, and your work is still yours".
 */
export function lineageBlockError(verdict: LineageVerdict): PodLineageError {
  return new PodLineageError(verdict, `Pod lineage blocked: ${WHY[verdict]}`);
}
