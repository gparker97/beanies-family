/**
 * One-time migration sweep: ensure every photo in the Automerge doc
 * has an anyone-with-link reader permission on Drive. Without this
 * grant, family members whose `drive.file` OAuth scope doesn't cover
 * photos uploaded by other members get 404s on `<img>` — the problem
 * fixed by ADR-021's public-link rendering.
 *
 * Runs once per (session, family) — gated by `sessionStorage` keyed on
 * the `.beanpod` driveFileId so switching families still sweeps. The
 * session mark is written ONLY after a sweep that ran against a LOADED
 * doc and completed (C11): it used to be written up front, so a sweep
 * that fired before the doc arrived (zero photos in the projection) or
 * lost its token marked the session done and never ran again.
 * Per-photo failures are isolated:
 *   - 403 Forbidden: this photo belongs to another member; they'll run
 *     the sweep on their own device. Skipped silently.
 *   - 404 Not Found: the file was deleted or moved in Drive. Skipped;
 *     it'd 404 on the render path anyway.
 *   - Other errors: logged and counted; don't halt the rest of the sweep.
 *
 * Only runs for signed-in users with a resolved `syncStore.driveFileId`.
 * Called from App.vue after the initial doc load settles.
 */
import { watch } from 'vue';
import {
  setPublicLinkPermission,
  DriveFileNotFoundError,
  DriveApiError,
} from '@/services/google/driveService';
import { getValidTokenSilent } from '@/services/google/googleAuth';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import { logEvent } from '@/services/telemetry/logEvent';
import { useSyncStore } from '@/stores/syncStore';
import { usePhotoStore } from '@/stores/photoStore';

const SESSION_KEY_PREFIX = 'beanies:publicPhotoSweep:';

function storageKey(driveFileId: string): string {
  return `${SESSION_KEY_PREFIX}${driveFileId}`;
}

function alreadyRan(driveFileId: string): boolean {
  try {
    return sessionStorage.getItem(storageKey(driveFileId)) === '1';
  } catch {
    // No sessionStorage → run every session; harmless, just wastes a
    // few API calls per navigation to the app cold-start.
    return false;
  }
}

function markRan(driveFileId: string): void {
  try {
    sessionStorage.setItem(storageKey(driveFileId), '1');
  } catch {
    /* ignore */
  }
}

/** Files whose sweep is running right now; a second trigger for the same file joins nothing. */
const inFlight = new Set<string>();

/** One sweep outcome class, emitted with its count so rates are queryable per class. */
function emitOutcome(kind: string, count: number): void {
  if (count === 0) return;
  logEvent({
    level: kind === 'failed' ? 'warn' : 'info',
    surface: 'photo-public-link',
    message: `public-link sweep: ${kind}`,
    context: { action: 'sweep-complete', kind, file_count: count },
  });
}

/**
 * Run the sweep for `driveFileId`. Returns whether it COMPLETED (every photo attempted),
 * which is the only outcome that marks the session. Exported for tests.
 */
export async function runSweep(driveFileId: string): Promise<boolean> {
  if (alreadyRan(driveFileId) || inFlight.has(driveFileId)) return false;
  if (!isDocLoaded()) return false; // the projection is empty, not the family's photos
  inFlight.add(driveFileId);
  try {
    const photoStore = usePhotoStore();
    const all = Object.values(photoStore.photos).filter((p) => !p.deletedAt);
    if (all.length === 0) {
      markRan(driveFileId);
      return true;
    }

    let token: string;
    try {
      // ⚠️ SILENT ONLY. This is background work nobody asked for, so it must never
      // start an interactive sign-in: `requestAccessToken` opens a popup first, and
      // on Android that popup became full Chrome on a blank page on every cold start
      // (2026-10-05). No silent token means skip and retry next session.
      token = await getValidTokenSilent();
    } catch (e) {
      logEvent({
        level: 'warn',
        surface: 'photo-public-link',
        message: 'public-link sweep skipped: token request failed; will retry',
        error: e,
        context: { action: 'sweep-skipped', error_code: 'no-token' },
      });
      return false;
    }

    let granted = 0;
    let skippedNotOwner = 0;
    let skippedMissing = 0;
    let failed = 0;
    for (const photo of all) {
      try {
        await setPublicLinkPermission(token, photo.driveFileId);
        granted++;
      } catch (e) {
        if (e instanceof DriveFileNotFoundError && e.status === 403) {
          // Someone else's file — they'll run this on their own device.
          skippedNotOwner++;
        } else if (e instanceof DriveFileNotFoundError && e.status === 404) {
          skippedMissing++;
        } else {
          failed++;
          logEvent({
            level: 'warn',
            surface: 'photo-public-link',
            message: 'public-link grant failed during sweep',
            error: e,
            context: {
              action: 'grant-failed',
              stage: 'sweep',
              http_status: e instanceof DriveApiError ? e.status : undefined,
            },
          });
        }
      }
    }
    emitOutcome('granted', granted);
    emitOutcome('not-owner', skippedNotOwner);
    emitOutcome('missing', skippedMissing);
    emitOutcome('failed', failed);
    // A completed sweep is marked even with per-photo failures: those are logged above and a
    // retry on the next session is the documented recovery; an identical loop this session
    // would hit the same 5xx or scope refusal.
    markRan(driveFileId);
    return true;
  } finally {
    inFlight.delete(driveFileId);
  }
}

/**
 * Attach the sweep trigger to the active sync file. Call once from
 * App.vue's onMounted — it watches `syncStore.driveFileId` AND the doc
 * version, so a file id that resolves before the doc loads is swept once
 * the doc arrives, and fires the sweep exactly once per (session, family).
 */
export function useEnsurePhotosPublic(): void {
  const syncStore = useSyncStore();
  watch(
    () => [syncStore.driveFileId, docVersion.value] as const,
    ([id]) => {
      if (id) void runSweep(id);
    },
    { immediate: true }
  );
}
