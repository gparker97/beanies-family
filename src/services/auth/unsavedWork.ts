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
} from '@/services/sync/syncService';
import { countQueuedPhotoUploads, hasUnpushedAtSignOutMarker } from '@/services/indexeddb/database';
import { logEvent } from '@/services/telemetry/logEvent';

export interface UnsavedWorkReport {
  /** Families whose document holds work the family file has not got. */
  unsavedFamilies: number;
  /** Queued photo uploads: photos that exist nowhere else yet. */
  photoUploads: number;
  /** The open family's file cannot be read, so no save can land right now. */
  remoteBlocked: boolean;
  /** Something could not be measured. Reads as at-risk. */
  unknown: boolean;
}

export const NOTHING_UNSAVED: Readonly<UnsavedWorkReport> = Object.freeze({
  unsavedFamilies: 0,
  photoUploads: 0,
  remoteBlocked: false,
  unknown: false,
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
  };
}

/** A family that is NOT open here: the marker a previous sign-out left, plus its photos. */
export async function measureFamilyAtRest(familyId: string): Promise<UnsavedWorkReport> {
  const photos = await photoCount(familyId);
  return {
    unsavedFamilies: hasUnpushedAtSignOutMarker(familyId) ? 1 : 0,
    photoUploads: photos.count,
    remoteBlocked: false,
    unknown: photos.unknown,
  };
}
