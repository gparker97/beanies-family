/**
 * One-time migration sweep: ensure every photo in the Automerge doc
 * has an anyone-with-link reader permission on Drive. Without this
 * grant, family members whose `drive.file` OAuth scope doesn't cover
 * photos uploaded by other members get 404s on `<img>` — the problem
 * fixed by ADR-021's public-link rendering.
 *
 * Runs once per (session, family) — gated by `sessionStorage` keyed on
 * the `.beanpod` driveFileId so switching families still sweeps.
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
import { requestAccessToken } from '@/services/google/googleAuth';
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

async function runSweep(driveFileId: string): Promise<void> {
  if (alreadyRan(driveFileId)) return;
  markRan(driveFileId);

  const photoStore = usePhotoStore();
  const all = Object.values(photoStore.photos).filter((p) => !p.deletedAt);
  if (all.length === 0) return;

  let token: string;
  try {
    token = await requestAccessToken();
  } catch (e) {
    console.warn('[ensurePhotosPublic] skipping sweep — token request failed', e);
    return;
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
      } else if (e instanceof DriveApiError) {
        failed++;
        console.warn('[ensurePhotosPublic] Drive API error', {
          photoId: photo.id,
          fileId: photo.driveFileId,
          status: e.status,
          message: e.message,
        });
      } else {
        failed++;
        console.warn('[ensurePhotosPublic] unexpected error', {
          photoId: photo.id,
          fileId: photo.driveFileId,
          error: e,
        });
      }
    }
  }
  console.info('[ensurePhotosPublic] sweep complete', {
    granted,
    skippedNotOwner,
    skippedMissing,
    failed,
    total: all.length,
  });
}

/**
 * Attach the sweep trigger to the active sync file. Call once from
 * App.vue's onMounted — it watches `syncStore.driveFileId` and fires
 * the sweep exactly once per (session, family).
 */
export function useEnsurePhotosPublic(): void {
  const syncStore = useSyncStore();
  watch(
    () => syncStore.driveFileId,
    (id) => {
      if (id) void runSweep(id);
    },
    { immediate: true }
  );
}
