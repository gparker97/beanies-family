/**
 * "What would this delete lose?" (C6, 2026-10-03).
 *
 * Every destructive cache delete (sign-out clear tier, Settings Clear Data, forget family,
 * delete family) asks this FIRST and either saves, or gets an explicit "discard" from the
 * person naming what goes. Before this, the clear tier skipped the unpushed guard, Settings
 * Clear Data never saved, and forget family deleted a database that sign-out had kept
 * precisely because it held the only copy of someone's work.
 *
 * Two measurements, because two situations exist:
 *   - LIVE: the family's document is open in this tab. Measured the way sign-out measures
 *     it (`docPushedAgainst` against the remote baseline), plus the remote-blocked latch.
 *   - AT REST: the family is not open (the picker). Nothing is left to measure, so the
 *     per-family `unpushed-at-signout` marker a previous sign-out left is the answer.
 * Both add the family's queued photo uploads. An answer this module cannot get reads as
 * at-risk (`unknown`), never as clean: the cost of a wrong "clean" is someone's work.
 */
import {
  docPushedAgainst,
  getRemoteBaselineHeadsFp,
  isRemoteBlocked,
  type SaveOutcome,
} from '@/services/sync/syncService';
import { countQueuedPhotoUploads, hasUnpushedAtSignOutMarker } from '@/services/indexeddb/database';
import { logEvent } from '@/services/telemetry/logEvent';

/**
 * Why the save this measurement ran first did not land: the `syncService` save outcomes
 * (`SaveResult.outcome`, with `no-provider` renamed `no-home` for the copy) plus `timeout`,
 * the probe's own race giving up on a save that was still running. Carried as data so the ONE
 * confirm can name the cause.
 */
export type SaveProbeCause = 'auth' | 'transient' | 'timeout' | 'error' | 'no-home' | 'deferred';

/**
 * The probe's cause from the sync layer's classification. `no-provider` (no storage provider
 * installed, e.g. Drive could not restore after a Google disconnect) reads as `no-home`: the
 * device is not connected to the family data file at all, which is a different sentence from
 * "the token was rejected".
 */
export function probeCauseFromOutcome(outcome: SaveOutcome | null): SaveProbeCause | null {
  return outcome === 'no-provider' ? 'no-home' : outcome;
}

export interface UnsavedWorkReport {
  /** Families whose document holds work the family file has not got. */
  unsavedFamilies: number;
  /** Queued photo uploads: photos that exist nowhere else yet. */
  photoUploads: number;
  /** The open family's file cannot be read, so no save can land right now. */
  remoteBlocked: boolean;
  /** Something could not be measured. Reads as at-risk. */
  unknown: boolean;
  /**
   * Why the pre-delete save did not land, or `null` when it landed or no save ran. Stamped
   * by the store that ran the save (`authStore.measureUnsavedWork`); the measurements here
   * never run a save, so they always return `null`. Not a risk on its own: a failed save
   * with nothing dirty still reads clean (`hasUnsavedWork` ignores it).
   */
  saveFailure: SaveProbeCause | null;
}

export const NOTHING_UNSAVED: Readonly<UnsavedWorkReport> = Object.freeze({
  unsavedFamilies: 0,
  photoUploads: 0,
  remoteBlocked: false,
  unknown: false,
  saveFailure: null,
});

/** Would a delete now lose anything (or can we not tell)? */
export function hasUnsavedWork(r: UnsavedWorkReport): boolean {
  return r.unsavedFamilies > 0 || r.photoUploads > 0 || r.remoteBlocked || r.unknown;
}

export function combineUnsavedWork(a: UnsavedWorkReport, b: UnsavedWorkReport): UnsavedWorkReport {
  return {
    unsavedFamilies: a.unsavedFamilies + b.unsavedFamilies,
    photoUploads: a.photoUploads + b.photoUploads,
    remoteBlocked: a.remoteBlocked || b.remoteBlocked,
    unknown: a.unknown || b.unknown,
    saveFailure: a.saveFailure ?? b.saveFailure,
  };
}

async function photoCount(familyId: string): Promise<{ count: number; unknown: boolean }> {
  try {
    return { count: await countQueuedPhotoUploads(familyId), unknown: false };
  } catch (e) {
    logEvent({
      level: 'warn',
      surface: 'sign-out',
      message: 'could not count queued photo uploads before a delete',
      error: e,
      context: { action: 'unsaved_probe_failed', stage: 'photo-queue' },
    });
    return { count: 0, unknown: true };
  }
}

/** The family open in this tab. Call AFTER any save attempt, so the answer is post-save. */
export async function measureLiveFamily(familyId: string | null): Promise<UnsavedWorkReport> {
  let unsavedFamilies = 0;
  let unknown = false;
  try {
    if ((await docPushedAgainst(getRemoteBaselineHeadsFp())) === 'dirty') unsavedFamilies = 1;
  } catch (e) {
    unknown = true;
    logEvent({
      level: 'warn',
      surface: 'sign-out',
      message: 'could not measure unpushed work before a delete',
      error: e,
      context: { action: 'unsaved_probe_failed', stage: 'doc' },
    });
  }
  const photos = familyId ? await photoCount(familyId) : { count: 0, unknown: false };
  return {
    unsavedFamilies,
    photoUploads: photos.count,
    remoteBlocked: isRemoteBlocked() !== null,
    unknown: unknown || photos.unknown,
    saveFailure: null,
  };
}

/**
 * The photo queue ALONE (round 3): an untrusted keep-data sign-out keeps the encrypted cache
 * when it holds unpushed work (that is safe: ciphertext), but a queued photo is plaintext, so
 * that sign-out asks about the queue only.
 */
export async function measurePhotoQueue(familyId: string): Promise<UnsavedWorkReport> {
  const photos = await photoCount(familyId);
  return { ...NOTHING_UNSAVED, photoUploads: photos.count, unknown: photos.unknown };
}

/** A family that is NOT open here: the marker a previous sign-out left, plus its photos. */
export async function measureFamilyAtRest(familyId: string): Promise<UnsavedWorkReport> {
  const photos = await photoCount(familyId);
  return {
    unsavedFamilies: hasUnpushedAtSignOutMarker(familyId) ? 1 : 0,
    photoUploads: photos.count,
    remoteBlocked: false,
    unknown: photos.unknown,
    saveFailure: null,
  };
}
