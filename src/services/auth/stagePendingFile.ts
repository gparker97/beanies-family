/**
 * Stage the family's envelope — the non-dispatching HALF of what `useLoginFlow`'s
 * `ensureStaged()` used to do alone.
 *
 * ⚠️ WHY THIS IS SPLIT OUT. `ensureStaged()` dispatches `OPEN_FAILED`, writes
 * `proveError`, calls `reportPayloadFailure` and mutates `stagedPayloadFailure`. That is
 * exactly right for the three callers that run AFTER the user has submitted a credential.
 * It is exactly wrong for staging early (before the prove screen resolves its methods):
 * `transition()` swallows `OPEN_FAILED` from any state but `opening`/`prove`
 * (`loginFlow.ts:259`), so an early failure would vanish silently while still poisoning
 * `proveError` and `stagedPayloadFailure` for the later, real attempt.
 *
 * So: this module is pure I/O and answers ONE question — "is there an envelope in reach
 * now?". It never dispatches, never writes `proveError`, never reports a payload failure.
 * `ensureStaged()` remains the sole owner of those side effects and becomes a pure
 * translation of one `StageOutcome` into them.
 *
 * THE ANTI-DRIFT RULE, so the two halves cannot grow apart: this function is the only
 * one on the path that touches `syncStore`, and `ensureStaged()` must contain no I/O and
 * no branching on store state. A new staging condition goes HERE and the wrapper gains
 * one branch. If the wrapper ever regrows a `syncStore.` reference, the split has failed.
 */

import { useSyncStore } from '@/stores/syncStore';
import { PayloadLoadError } from '@/types/sync';

/** The transport reasons staging can fail for. Deliberately excludes credential outcomes. */
export type StageFailReason = 'not-found' | 'permission' | 'auth' | 'error';

export type StageOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: StageFailReason;
      /**
       * Carried so the wrapper can reproduce today's behaviour EXACTLY — it feeds
       * `payloadErrorKind`, `payloadErrorMessageKey` and `reportPayloadFailure`, all
       * three of which need the instance, not a classification of it.
       */
      payload?: PayloadLoadError;
      /**
       * The original exception for anything that is NOT a payload failure. Carried
       * because the wrapper reports it: classifying an error and then discarding it
       * leaves a CloudWatch entry with no message and no stack, which is the opposite
       * of the point.
       */
      cause?: unknown;
    };

/**
 * `loadFromFile`'s failure reasons → the machine's transport vocabulary.
 *
 * No `'permission'` case on purpose: that is decided by the `needsPermission` check
 * above, and `loadFromFile` never returns it (`reason?: 'auth' | 'not-found' | 'error'`).
 * A branch for it would read as a handled case that is in fact unreachable, and would
 * hide the gap if that union ever grew one.
 */
function classifyLoadFailure(reason?: string): StageFailReason {
  if (reason === 'auth') return 'auth';
  if (reason === 'not-found' || reason === 'file-not-found') return 'not-found';
  return 'error';
}

/**
 * Ensure the envelope is staged (pending) or the pod is open.
 *
 * Never throws — `loadFromFile()` throws the latched remote blocker
 * (`syncStore.ts:1611`), so the try/catch is mandatory rather than defensive. Callers
 * get an outcome, never an exception, which is what lets the early-staging path treat
 * offline as a normal answer instead of an error on screen.
 */
export async function stagePendingFile(alreadyOpen: boolean): Promise<StageOutcome> {
  const syncStore = useSyncStore();

  // Three different situations resolve to the same "yes": the pod is already open, an
  // envelope is already staged, or one was just fetched. This function deliberately does
  // NOT return the envelope — where it ended up is stated once, by the caller's
  // derivation, so there is no implicit resolution order for a reader to learn.
  //
  // `alreadyOpen` is passed in rather than read here: "the pod is open" is
  // `familyStore.members.length > 0`, a fact the caller owns. Reaching for a second
  // store would make this module's `syncStore`-only rule untrue on its first day.
  if (alreadyOpen || syncStore.hasPendingEncryptedFile) return { ok: true };
  if (!syncStore.isConfigured) return { ok: false, reason: 'not-found' };
  if (syncStore.needsPermission) return { ok: false, reason: 'permission' };

  try {
    const result = await syncStore.loadFromFile();
    if (result.success || result.needsPassword) return { ok: true };
    return { ok: false, reason: classifyLoadFailure(result.reason) };
  } catch (e) {
    if (e instanceof PayloadLoadError) {
      return { ok: false, reason: 'error', payload: e };
    }
    return { ok: false, reason: 'error', cause: e };
  }
}
