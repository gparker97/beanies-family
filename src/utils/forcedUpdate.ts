/**
 * The forced web update: reload a build that is proven behind into the deployed one.
 *
 * NO VUE, NO TELEMETRY (the plan's import rule; telemetry -> diagnosticContext ->
 * syncStore is the cycle `hardReload.ts` documents). The runner (`webUpdate.ts`)
 * passes the shas in and logs from the returned outcome.
 *
 * Two small persisted records:
 *
 *  1. The forced record, `sessionStorage` `{ from, to }`, written ONLY by the forced
 *     path. It is both the loop guard and the "did it take" marker: at the next boot
 *     `to === this build's sha` means applied (record removed); anything else means
 *     the reload did not take (record kept, and automatic forcing toward that sha is
 *     suppressed for the rest of the tab session). It fails CLOSED: if it cannot be
 *     written, no automatic force happens.
 *
 *     Deliberately NOT `PWA_POST_UPDATE_ROUTE_KEY`: that key also fires the
 *     "updated!" toast, and `hardReload()` already keeps the route.
 *
 *  2. First-seen-behind, ONE `localStorage` key `{ sha, since }` (a key per sha would
 *     grow with every deploy). The failure this exists for is a run of SHORT visits,
 *     and an in-memory clock would restart on every page load and never reach the cap.
 */
import { hardReload, isChunkRecoveryInProgress } from '@/utils/hardReload';
import { isNative } from '@/services/sync/capabilities';

export const FORCED_RECORD_KEY = 'pwa-forced-update';
export const BEHIND_SINCE_KEY = 'pwa-behind-since';

export interface ForcedRecord {
  from: string;
  to: string;
}

function isForcedRecord(v: unknown): v is ForcedRecord {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ForcedRecord).from === 'string' &&
    typeof (v as ForcedRecord).to === 'string'
  );
}

/** The forced record, or null when absent, malformed, or storage throws. */
export function readForcedRecord(): ForcedRecord | null {
  try {
    const raw = sessionStorage.getItem(FORCED_RECORD_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isForcedRecord(parsed) ? parsed : null;
  } catch (e) {
    console.warn('[forcedUpdate] forced record unreadable:', e);
    return null;
  }
}

/** Persist the forced record. `false` when storage throws (the guard then fails closed). */
export function writeForcedRecord(record: ForcedRecord): boolean {
  try {
    sessionStorage.setItem(FORCED_RECORD_KEY, JSON.stringify(record));
    return true;
  } catch (e) {
    console.warn('[forcedUpdate] forced record not written (automatic force disabled):', e);
    return false;
  }
}

function removeForcedRecord(): void {
  try {
    sessionStorage.removeItem(FORCED_RECORD_KEY);
  } catch (e) {
    console.warn('[forcedUpdate] forced record not removed:', e);
  }
}

/** Put the record back the way it was before a force that was then called off. */
function restoreForcedRecord(previous: ForcedRecord | null): void {
  if (previous) writeForcedRecord(previous);
  else removeForcedRecord();
}

/**
 * Boot-time "did the forced reload take?". `applied` removes the record; `failed`
 * keeps it, so the once-per-sha guard holds for the rest of the tab session.
 */
export function reconcileForcedRecord(
  currentSha: string
): { kind: 'applied' | 'failed'; record: ForcedRecord } | null {
  const record = readForcedRecord();
  if (!record) return null;
  // Compared against `from`, not `to`: a reload that lands on a build NEWER than the
  // target (another deploy finished meanwhile) took just as well. Only "still on the
  // build we left" means it did not.
  if (record.from !== currentSha) {
    removeForcedRecord();
    return { kind: 'applied', record };
  }
  return { kind: 'failed', record };
}

/**
 * When this remote sha was first seen as behind, across page loads. A different sha
 * restamps to `now`. A throw (storage blocked) degrades to `now`, meaning "the cap
 * never passes", which is the safe direction: no reload rather than an early one.
 */
export function behindSince(remoteSha: string, now: number): number {
  try {
    const raw = localStorage.getItem(BEHIND_SINCE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { sha?: unknown; since?: unknown };
      if (
        parsed &&
        parsed.sha === remoteSha &&
        typeof parsed.since === 'number' &&
        Number.isFinite(parsed.since) &&
        parsed.since <= now
      ) {
        return parsed.since;
      }
    }
    localStorage.setItem(BEHIND_SINCE_KEY, JSON.stringify({ sha: remoteSha, since: now }));
  } catch (e) {
    console.warn('[forcedUpdate] behind-since unavailable (cap will not pass):', e);
  }
  return now;
}

/** A forced reload is swapping the page (two `hardReload()`s race the SW + cache eviction). */
let forceInFlight = false;

export function isForceInFlight(): boolean {
  return forceInFlight;
}

export type ForceOutcome =
  | { outcome: 'reloading' }
  | { outcome: 'suppressed' }
  | { outcome: 'storage' }
  | { outcome: 'busy' }
  /** `beforeReload` called it off (the screen stopped being safe while logging). */
  | { outcome: 'aborted' }
  | { outcome: 'failed'; error: unknown };

/**
 * Force the update: guard, write the record, let the caller log + re-check
 * (`beforeReload`, which may call it off), then `hardReload()`.
 *
 * `beforeReload` runs AFTER the guard so a refused force never logs `forced`; a
 * call-off restores the record so it cannot suppress a later legitimate force.
 * A person's tap (`userRequested`) ignores the once-per-sha guard and does not need
 * the record (the loop it prevents needs no human in it). Never rejects.
 */
export async function forceUpdate(
  opts: { from: string; to: string; userRequested: boolean },
  beforeReload: () => boolean | Promise<boolean> = () => true
): Promise<ForceOutcome> {
  // Native is a refusal of last resort: no caller should reach it.
  if (isNative() || isChunkRecoveryInProgress() || forceInFlight) return { outcome: 'busy' };

  const previous = readForcedRecord();
  if (!opts.userRequested && previous?.to === opts.to) return { outcome: 'suppressed' };
  if (!writeForcedRecord({ from: opts.from, to: opts.to }) && !opts.userRequested) {
    return { outcome: 'storage' };
  }

  forceInFlight = true;
  let proceed: boolean;
  try {
    proceed = await beforeReload();
  } catch (e) {
    console.warn('[forcedUpdate] beforeReload threw, calling the force off:', e);
    proceed = false;
  }
  if (!proceed) {
    forceInFlight = false;
    restoreForcedRecord(previous);
    return { outcome: 'aborted' };
  }

  try {
    await hardReload();
    // The page is being replaced; leave the in-flight flag set.
    return { outcome: 'reloading' };
  } catch (error) {
    // `location.replace` threw: the page is NOT being replaced. The record stays, so
    // automatic forcing toward this sha is suppressed for the tab (it would fail again).
    forceInFlight = false;
    return { outcome: 'failed', error };
  }
}

/** Test-only: module state otherwise resets only on a full document load. */
export function __resetForcedUpdateForTesting(): void {
  forceInFlight = false;
}
