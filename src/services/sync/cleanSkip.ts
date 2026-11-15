/**
 * The clean skip (requirement 15, plan 2026-11-15): may a save asked for on tab
 * hide or `beforeunload` upload nothing, because Drive already holds everything
 * this device has?
 *
 * ADR-032 forbade skipping a save on document heads alone: the heads do not
 * cover the envelope's key material (invite, passkey and recovery wraps), so a
 * heads-only skip could leave a wrap unpublished. This adds the envelope
 * fingerprint the ADR asked for (`envelopeFingerprint`, `envelopeMerge.ts`),
 * and the skip needs BOTH, plus proof that no save is wanted for any other
 * reason. Every doubt is a decline, and a decline is an ordinary upload.
 *
 * PURE apart from {@link evaluateCleanSkip}, which only sequences the two I/O
 * answers the caller supplies (cheap local facts first, so a save that is
 * plainly wanted starts without waiting on the worker or a hash).
 */

/** Which caller asked. Only these two may ever skip. */
export type CleanSkipTrigger = 'hide' | 'unload';

/** Facts the caller reads from module state, synchronously. */
export interface CleanSkipLocal {
  /** A debounced save was armed: the RETURN of the caller's own `cancelPendingSave()`. */
  debouncePending: boolean;
  /** A save is in flight or queued behind one (`saveFlight.pending()`). */
  saveInFlight: boolean;
  /** A pre-save or poll merge is in flight: the heads and envelope are about to move. */
  mergeInFlight: boolean;
  /** Saves are held (a cross-family decrypt), or a held save is waiting to re-arm. */
  savesHeld: boolean;
  /** The offline queue holds a save, or the last attempt ended queued. */
  offlineQueued: boolean;
  /** The last save attempt failed. */
  lastSaveFailed: boolean;
  /** The remote is latched unreadable or unmergeable; the save path owns that verdict. */
  remoteBlocked: boolean;
  /** The envelope fingerprint the committed baseline recorded, or null. */
  baselineEnvelopeFp: string | null;
}

/** Everything the decision needs: the local facts plus the two I/O answers. */
export interface CleanSkipInputs extends CleanSkipLocal {
  /** The document's heads equal the committed baseline's (`docPushedAgainst` said `clean`). */
  headsClean: boolean;
  /** The current envelope's fingerprint, or null when it could not be taken. */
  currentEnvelopeFp: string | null;
}

/** `reason` is `clean` on a skip, else what blocked it (logged as the decline's `detail`). */
export interface CleanSkipDecision {
  skip: boolean;
  reason: string;
}

const decline = (reason: string): CleanSkipDecision => ({ skip: false, reason });

/** The first local fact that blocks the skip, or null. Order is the log's precedence only. */
function localBlock(i: CleanSkipLocal): string | null {
  if (i.debouncePending) return 'pending';
  if (i.saveInFlight) return 'in-flight';
  if (i.mergeInFlight) return 'merge-in-flight';
  if (i.savesHeld) return 'held';
  if (i.offlineQueued) return 'queued-offline';
  if (i.lastSaveFailed) return 'failed-last';
  if (i.remoteBlocked) return 'remote-blocked';
  if (i.baselineEnvelopeFp === null) return 'no-envelope-fp';
  return null;
}

/**
 * THE decision. Skip only when every condition holds; each one alone blocks it
 * (`cleanSkip.test.ts` is a table of exactly that).
 */
export function decideCleanSkip(i: CleanSkipInputs): CleanSkipDecision {
  const blocked = localBlock(i);
  if (blocked !== null) return decline(blocked);
  if (!i.headsClean) return decline('heads-differ');
  if (i.currentEnvelopeFp === null) return decline('no-envelope-fp');
  if (i.currentEnvelopeFp !== i.baselineEnvelopeFp) return decline('envelope-differs');
  return { skip: true, reason: 'clean' };
}

/** The two I/O answers, asked only when every local fact allows a skip. */
export interface CleanSkipProbes {
  headsClean: () => Promise<boolean>;
  currentEnvelopeFp: () => Promise<string | null>;
}

/**
 * Gather and decide: local facts first, then the heads, then the fingerprint,
 * each asked only when everything before it allowed a skip. The verdict is
 * always {@link decideCleanSkip}'s; this adds no condition of its own.
 */
export async function evaluateCleanSkip(
  local: CleanSkipLocal,
  probes: CleanSkipProbes
): Promise<CleanSkipDecision> {
  const blocked = localBlock(local);
  if (blocked !== null) return decline(blocked);
  const headsClean = await probes.headsClean();
  const currentEnvelopeFp = headsClean ? await probes.currentEnvelopeFp() : null;
  return decideCleanSkip({ ...local, headsClean, currentEnvelopeFp });
}
