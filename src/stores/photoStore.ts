/**
 * photoStore — orchestrator (per MVO) for photo attachments.
 *
 * Coordinates:
 *   compress → Drive upload → Automerge metadata write → entity.photoIds
 *   (+ offline queue fallback + thumbnailLink resolution + tombstone GC)
 *
 * Views never call driveService / photoCompression / photoUploadQueue
 * directly — they invoke this store's methods. The store is responsible
 * for atomicity (rollback on partial failure) and for keeping Automerge
 * and Drive consistent.
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef, triggerRef, watch } from 'vue';
import {
  createFile,
  deleteFile,
  deletePermission,
  downloadFileBlob,
  findOrCreateFolder,
  getFileMetadata,
  listFilePermissions,
  listFilesInFolder,
  setPublicLinkPermission,
  DriveApiError,
  DriveFileNotFoundError,
} from '@/services/google/driveService';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { requestAccessToken } from '@/services/google/googleAuth';
import { compress, CompressionError } from '@/services/photos/photoCompression';
import {
  enqueueUpload,
  getPending,
  setActiveFamily as setQueueFamily,
  setFlushHandler as setQueueFlushHandler,
  clearActiveFamily as clearQueueFamily,
  flushQueue as flushPhotoQueue,
  QUEUE_SOFT_CAP,
  type QueuedPhotoUpload,
} from '@/services/sync/photoUploadQueue';
import { docVersion } from '@/services/automerge/docService';
import {
  list as projectionList,
  getById as projectionGetById,
  collectionRef,
} from '@/services/automerge/projection';
import {
  mutate,
  fireAndForgetMutate,
  collectReferencedPhotoIds as collectPhotoIdsRpc,
} from '@/services/automerge/worker/docClient';
import {
  registerPhotoCollection,
  hasPhotoCollections,
  flatHooks,
  type PhotoCollectionHooks,
} from '@/services/automerge/worker/photoOps';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import type { CollectionName } from '@/types/automerge';
import type { PhotoAttachment, UUID } from '@/types/models';
import { PDF_MIME } from '@/utils/attachmentKind';

const THUMB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOMBSTONE_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * A record with no host reference is only an orphan once it is older than this. A fresh
 * upload is unreferenced for the window between the `photos` record landing and the host's
 * `photoIds` write (the eager-create modals, a queue flush mid-wizard, a peer's attach that
 * has not synced yet); without a grace the sweep would delete a photo the person just added.
 */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_THUMB_SIZE = 400;
const DEFAULT_FULL_SIZE = 2048;

/** HTTP status off a Drive error, for the `http_status` context key. */
function httpStatus(e: unknown): number | undefined {
  return e instanceof DriveApiError ? e.status : undefined;
}

/**
 * The photo pipeline's diagnostic events. One greppable surface per stage
 * (`photo-upload`, `photo-public-link`, `photo-detach`, `photo-replace`, `photo-gc`); the
 * context carries only allowlisted keys (`action`, `http_status`, `file_count`, `kind`).
 */
function photoEvent(
  surface: 'photo-upload' | 'photo-public-link' | 'photo-detach' | 'photo-replace' | 'photo-gc',
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown>,
  error?: unknown
): void {
  logEvent({ level, surface, message, context, ...(error !== undefined ? { error } : {}) });
}

/**
 * Discriminated result for `addPhoto`. Lets callers distinguish:
 *   - `'completed'` — Drive upload + Automerge write succeeded synchronously;
 *     the photo is fully attached to the entity.
 *   - `'queued'` — the upload is in the photo queue and will sync when
 *     conditions permit. Caller's optimistic local update is still valid;
 *     the photo tile renders via `pendingUploads`.
 *
 * Explicit shape (vs inferring from `!store.photos[id]`) so the contract is
 * self-documenting and survives any future refactor of how pending state is
 * tracked in the doc.
 */
export interface AddPhotoResult {
  photoId: UUID;
  status: 'completed' | 'queued';
}

/**
 * Thrown when the fallback `enqueueUpload` itself fails (IndexedDB quota,
 * private-browsing restrictions, DB corruption). Caller (`usePhotos.add`)
 * `instanceof`-checks this to surface a distinct "couldn't save your photo
 * for later" toast — different from the generic non-transient upload error.
 *
 * Modeled after `CompressionError` in `photoCompression.ts:32-39`.
 */
export class QueueWriteFailedError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'QueueWriteFailedError';
    this.cause = cause;
  }
}

/**
 * Classify whether a `finalizeUpload` failure is transient (worth queuing
 * for later retry) or genuine (re-throw → user-facing error toast).
 *
 * Transient: network blips, slow connections, server-side wobble, rate
 * limit. The same payload retried in a few seconds may succeed.
 *
 * Non-transient: auth (need reconnect, not retry), malformed requests
 * (bug), explicit folder-not-found (after the driveService auto-retry).
 *
 * Used by both the online branch of `addPhoto` and (future) `addAvatarPhoto`
 * once the queue infrastructure supports avatars.
 */
function isTransientUploadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const name = e.name;
  const msg = e.message;
  // Browser fetch failure shapes.
  if (name === 'AbortError') return true;
  if (name === 'NetworkError') return true;
  if (name === 'TypeError' && msg.includes('Failed to fetch')) return true;
  // Drive REST error shapes — driveService throws Error with the response
  // status in the message; we pattern-match on that.
  if (/\b(5\d{2}|429)\b/.test(msg)) return true;
  return false;
}

export type PhotoSize = 'thumb' | 'full';

export type PhotoResolution =
  { status: 'ok'; url: string } | { status: 'pending' } | { status: 'missing' };

/**
 * How a collection references photos. Two functions cover the two
 * GC-critical surfaces:
 *   - `attach`: append a finished upload's photoId to its parent entity
 *     inside the doc (the safety-net write used by the online path AND the
 *     offline queue flush).
 *   - `collect`: yield every photoId the collection currently references, so
 *     `gcOrphans` knows what NOT to delete.
 *
 * Most collections are flat top-level id-keyed records with a `photoIds?`
 * array (`doc[collection][entityId].photoIds`) — they register by name only
 * and get `flatHooks` synthesized. Non-flat hosts (family-member avatars
 * via a scalar `avatarPhotoId`; vacation booking segments nested inside
 * `doc.vacations[*].{travelSegments,…}[]`) pass explicit hooks.
 */
// The hook contract, registry, flatHooks, attach/collect, and PhotoCollectHookError
// now live in `worker/photoOps.ts` (pure, worker-shared) and are re-exported below
// for backward compatibility. See ADR-032.
export { registerPhotoCollection, type PhotoCollectionHooks };

export const usePhotoStore = defineStore('photos', () => {
  const syncStore = useSyncStore();
  const familyContextStore = useFamilyContextStore();

  // Reactive state
  const unresolvedIds = ref<Set<string>>(new Set());
  const canonicalFolderId = ref<string | null>(null);
  /**
   * Cached id for this family's `data/<familyId>/photos/` subfolder (the
   * actual upload destination). Keyed by familyId so switching families
   * doesn't serve a stale id. Populated lazily on first upload.
   */
  const photosFolderIdByFamily = new Map<string, string>();
  /**
   * Pending uploads cached in memory so UI can reactively observe what's
   * queued for each entity. `shallowRef` because the array identity changes
   * on every refresh — we don't need deep reactivity on QueuedPhotoUpload.
   */
  const pendingUploads = shallowRef<QueuedPhotoUpload[]>([]);
  /** thumbnailLink URL cache, keyed by driveFileId. */
  const thumbUrlCache = new Map<string, { url: string; fetchedAt: number }>();
  /**
   * Blob URL cache for the `alt=media` download path, keyed by driveFileId.
   * Blob URLs live in-process (no token, no CDN handoff) so they never
   * rotate — perfect for avatars where Drive's `thumbnailLink` tokens
   * have proven unreliable across page reloads. Cleared on deactivate() and on
   * explicit invalidation.
   *
   * Holds the BLOB rather than an object URL: an object URL pins its blob
   * anyway, so this costs no more memory per entry, and it lets the PDF
   * renderer and the save-to-device action share one download instead of one
   * going blob -> objectURL -> fetch -> blob. It also deletes an entire class
   * of object-URL lifetime bugs rather than moving them.
   *
   * BOUNDED, because "no more memory per entry" is not the same as no more
   * memory for the SET. Only PDFs used to reach this cache (images render from
   * the CDN thumbnail and retain nothing), so it was effectively self-limiting;
   * now every save-to-device tap adds one. Thirty photos would otherwise pin
   * ~150MB for the life of the tab, and `deactivate()` — the documented
   * clearing point — has no caller anywhere in the app.
   */
  const BLOB_CACHE_MAX_BYTES = 32 * 1024 * 1024;
  const blobCache = new Map<string, Blob>();

  /**
   * Insert, evicting oldest-first until the set fits the budget. `Map`
   * iterates in insertion order, so re-inserting on hit would give true LRU —
   * deliberately not done: these are re-fetchable bytes and an approximate
   * bound is worth more than exact recency.
   */
  function cacheBlob(driveFileId: string, blob: Blob): void {
    blobCache.delete(driveFileId);
    blobCache.set(driveFileId, blob);
    let total = 0;
    for (const b of blobCache.values()) total += b.size;
    for (const key of blobCache.keys()) {
      if (total <= BLOB_CACHE_MAX_BYTES) break;
      // Never evict the entry just inserted — the caller is about to use it.
      if (key === driveFileId) continue;
      total -= blobCache.get(key)?.size ?? 0;
      blobCache.delete(key);
    }
  }

  // Reactive projection of the `photos` collection. Depends on the photos map ref
  // specifically (NOT `docVersion`), so it re-derives ONLY when a photos delta
  // lands — not on every unrelated mutation, which forced an O(n) rebuild of the
  // whole Record on a hot reactive path (F9).
  const photos = computed<Record<UUID, PhotoAttachment>>(() => {
    const map = collectionRef('photos').value;
    const out: Record<UUID, PhotoAttachment> = {};
    for (const p of map.values()) {
      const photo = p as PhotoAttachment;
      out[photo.id] = photo;
    }
    return out;
  });

  const photosEnabled = computed(() => !!syncStore.driveFileId);

  // --- Lifecycle --------------------------------------------------------

  /** The family the offline queue is bound to; `null` between sign-out and the next open. */
  const activeFamilyId = ref<string | null>(null);

  /**
   * Bind the offline upload queue to `familyId` and drain anything it holds. Wired from
   * App.vue's family watcher (C11): until 2026-10 nothing called this, so an offline upload
   * was written to IndexedDB and never flushed. Idempotent per family — a repeat call for the
   * family already bound only re-drains; a different family deactivates the previous one first.
   */
  async function activate(familyId: string): Promise<void> {
    if (activeFamilyId.value && activeFamilyId.value !== familyId) deactivate();
    activeFamilyId.value = familyId;
    setQueueFamily(familyId);
    setQueueFlushHandler(handleQueuedUpload);
    await refreshPending();
    if (navigator.onLine) {
      void flushPhotoQueue().finally(() => refreshPending());
    }
  }

  /**
   * `activate` for a caller that cannot await it (App.vue's family watcher). Never an
   * unhandled rejection: a failed activation (the queue database would not open) leaves the
   * queue put, to drain on the next activation or `online` event, and is logged so a family
   * whose photos never drain is visible in the firehose.
   */
  function activateInBackground(familyId: string): void {
    activate(familyId).catch((e) => {
      logEvent({
        level: 'warn',
        surface: 'photo-upload-flush',
        message: 'photo queue activation failed',
        error: e,
        context: { action: 'activate-failed' },
      });
    });
  }

  function deactivate(): void {
    activeFamilyId.value = null;
    clearQueueFamily();
    unresolvedIds.value = new Set();
    canonicalFolderId.value = null;
    photosFolderIdByFamily.clear();
    thumbUrlCache.clear();
    blobCache.clear();
    pendingUploads.value = [];
  }

  // --- Canonical folder resolution -------------------------------------

  /**
   * Root `beanies.family/` folder — parent of the active `.beanpod`.
   * We still return this for future callers (e.g. a top-level Drive
   * picker), but photo uploads route through `resolvePhotosFolderId()`
   * so they don't clutter the root.
   */
  async function resolveCanonicalFolderId(): Promise<string> {
    if (canonicalFolderId.value) return canonicalFolderId.value;
    const beanpodFileId = syncStore.driveFileId;
    if (!beanpodFileId) {
      throw new Error('photoStore: cannot resolve folder without cloud sync (.beanpod file ID).');
    }
    const token = await requestAccessToken();
    const meta = await getFileMetadata(token, beanpodFileId, 'parents');
    const parents = meta.parents as string[] | undefined;
    const folderId = parents?.[0];
    if (!folderId) {
      throw new Error(`photoStore: no parent folder on .beanpod file ${beanpodFileId}`);
    }
    canonicalFolderId.value = folderId;
    return folderId;
  }

  /**
   * Resolve the destination folder for photo uploads:
   *   `<beanies.family>/data/<familyId>/photos/`
   *
   * Keeps photos out of the shared-folder root so families testing
   * against the same `beanies.family/` folder (or the rare multi-family
   * case) don't pile up one undifferentiated blob of images. `familyId`
   * is taken from `familyContextStore.activeFamilyId` — a stable UUID
   * that already exists in the registry.
   *
   * Each segment is found-or-created and the leaf id is cached per
   * family for the store's lifetime. Pre-existing photos at the root
   * are left in place; photoStore resolves by `driveFileId` so path
   * doesn't matter for display or GC.
   */
  async function resolvePhotosFolderId(): Promise<string> {
    const familyId = familyContextStore.activeFamilyId;
    if (!familyId) {
      throw new Error('photoStore: cannot resolve photos folder without an active family.');
    }
    const cached = photosFolderIdByFamily.get(familyId);
    if (cached) return cached;

    const rootId = await resolveCanonicalFolderId();
    const token = await requestAccessToken();
    const dataId = await findOrCreateFolder(token, 'data', rootId);
    const familyFolderId = await findOrCreateFolder(token, familyId, dataId);
    const photosId = await findOrCreateFolder(token, 'photos', familyFolderId);
    photosFolderIdByFamily.set(familyId, photosId);
    return photosId;
  }

  // --- Upload ----------------------------------------------------------

  /**
   * Attach a photo to an entity.
   *
   * Persistence contract — the returned `photoId` is durably recorded in one
   * of two ways regardless of caller lifecycle (component unmount, modal
   * close, navigation):
   *
   *   - `status: 'completed'` → photo record is in `doc.photos[photoId]` AND
   *     the photoId is appended to `entity.photoIds`. Drive upload succeeded;
   *     a persist save is scheduled (500ms debounce in docService).
   *
   *   - `status: 'queued'` → upload payload is in the photo queue. Will sync
   *     when conditions permit (next `'online'` event, token-refresh, or 5s
   *     retry timer). The doc record is written when the queue flushes.
   *     Caller's optimistic UI (rendering a pending tile) is safe — the
   *     photoId is stable for the lifetime of the upload.
   *
   * Throws:
   *   - `CompressionError` — image couldn't be compressed (corrupt file, etc.)
   *   - `QueueWriteFailedError` — the upload was non-transiently failed
   *     online AND the queue fallback also failed to persist. Photo is lost;
   *     user should retry. The user-facing toast in `usePhotos` distinguishes
   *     this from a clean-non-transient failure.
   *   - Other `Error` — non-transient Drive failure (401/403 auth, 400
   *     malformed, etc.); caller surfaces as a generic "couldn't upload" toast.
   */
  async function addPhoto(
    file: File,
    entityCollection: string,
    entityId: string,
    createdBy?: UUID
  ): Promise<AddPhotoResult> {
    if (!photosEnabled.value) {
      throw new Error('photoStore: cloud sync is required to attach photos.');
    }

    // The family this photo belongs to, captured before any await (round 3).
    const familyId = familyContextStore.activeFamilyId;
    const photoId = crypto.randomUUID();

    // Two kinds flow through this one path:
    //   - PDFs (booking documents): stored as-is — no canvas compression
    //     (createImageBitmap can't decode a PDF). Size/type/magic-byte are
    //     ALREADY validated upstream in usePhotos.add; this branch trusts that
    //     and never throws CompressionError. width/height are 0 (non-raster);
    //     the original filename is preserved for display/download.
    //   - Images: compressed to JPEG as before.
    let attachmentBlob: Blob;
    let filename: string;
    let mime: string;
    let width: number;
    let height: number;
    let originalFileName: string | undefined;

    if (file.type === PDF_MIME) {
      attachmentBlob = file;
      filename = `beanies-doc-${photoId}.pdf`;
      mime = PDF_MIME;
      width = 0;
      height = 0;
      originalFileName = file.name;
    } else {
      // Compress first so the queue stores the smaller blob (and we know
      // the final dimensions/mime even before we attempt Drive upload).
      let compressed;
      try {
        compressed = await compress(file);
      } catch (e) {
        if (e instanceof CompressionError) throw e;
        throw new CompressionError('Failed to compress image', e);
      }
      attachmentBlob = compressed.blob;
      filename = `beanies-photo-${photoId}.jpg`;
      mime = compressed.mime;
      width = compressed.width;
      height = compressed.height;
    }

    const payload = {
      photoId,
      entityCollection,
      entityId,
      blob: attachmentBlob,
      filename,
      mime,
      width,
      height,
      sizeBytes: attachmentBlob.size,
      ...(originalFileName ? { fileName: originalFileName } : {}),
      createdBy,
    };

    // Offline path: queue for later. Metadata is only written to Automerge
    // after the upload actually succeeds (avoids half-baked records).
    if (!navigator.onLine) {
      await enqueueWithWrap(payload);
      await refreshPending();
      return { photoId, status: 'queued' };
    }

    // Online path: try direct Drive upload + Automerge write. On a transient
    // failure (network blip, AbortError, Drive 5xx/429), fall back to the
    // queue so the photo isn't lost on a flaky-but-online connection. The
    // queue's flushHandler IS finalizeUpload, so retry semantics are
    // identical to a fresh offline-queued entry.
    try {
      await finalizeUpload(payload, { familyId });
      return { photoId, status: 'completed' };
    } catch (e) {
      if (!isTransientUploadError(e)) {
        // Non-transient (auth, malformed, etc.) — re-throw so caller surfaces
        // an error toast. Retrying won't help.
        throw e;
      }
      // Transient: queue for later retry. If THAT also fails, we wrap and
      // re-throw so the caller can distinguish from a clean upload failure.
      photoEvent(
        'photo-upload',
        'warn',
        'Drive upload failed transiently; queued for retry',
        { action: 'transient-fallback-queued', http_status: httpStatus(e) },
        e
      );
      await enqueueWithWrap(payload);
      await refreshPending();
      return { photoId, status: 'queued' };
    }
  }

  /**
   * Wraps `enqueueUpload` so a queue-write failure (IndexedDB quota, private-
   * browsing restrictions, DB corruption) throws a typed `QueueWriteFailedError`
   * the caller can branch on. Without this, an underlying DOMException leaks
   * out and `usePhotos` couldn't distinguish "Drive failed AND we couldn't
   * even save it for later" from "Drive failed".
   */
  async function enqueueWithWrap(
    payload: Omit<QueuedPhotoUpload, 'id' | 'createdAt'>
  ): Promise<void> {
    try {
      await enqueueUpload(payload);
    } catch (queueErr) {
      // A user action failed and the photo is gone: page it.
      reportError({
        surface: 'photo-upload',
        message: 'photo could not be queued for later upload',
        severity: 'critical',
        error: queueErr,
        context: { action: 'queue-write-failed' },
      });
      throw new QueueWriteFailedError('Failed to queue photo upload', queueErr);
    }
  }

  /** Grant anyone-with-link read; non-fatal, logged (see `finalizeUpload` for the rationale). */
  async function grantPublicLink(token: string, fileId: string, stage: string): Promise<void> {
    await setPublicLinkPermission(token, fileId).catch((e) => {
      photoEvent(
        'photo-public-link',
        'warn',
        'public-link grant failed; the session sweep will retry',
        { action: 'grant-failed', stage, http_status: httpStatus(e) },
        e
      );
    });
  }

  /**
   * Remove the anyone-with-link grant from a file at tombstone time (C11). Until the GC sweep
   * reclaims the bytes (24h grace, and the sweep is not yet scheduled) the file stays on Drive,
   * so without this a "deleted" photo stayed world-readable to anyone holding its CDN URL.
   * Best-effort and logged either way; a 403 means another member owns the file and their
   * device revokes it when the tombstone syncs to them (see `useEnsurePhotosPublic` for the
   * mirror-image grant sweep).
   */
  async function revokePublicLink(driveFileId: string): Promise<void> {
    let revoked = 0;
    try {
      const token = await requestAccessToken();
      const perms = await listFilePermissions(token, driveFileId);
      for (const p of perms) {
        if (p.type !== 'anyone') continue;
        await deletePermission(token, driveFileId, p.id);
        revoked++;
      }
      photoEvent('photo-public-link', 'info', 'public-link revoked at tombstone', {
        action: 'revoke',
        file_count: revoked,
      });
    } catch (e) {
      photoEvent(
        'photo-public-link',
        'warn',
        'public-link revoke failed at tombstone',
        { action: 'revoke-failed', http_status: httpStatus(e), file_count: revoked },
        e
      );
    }
  }

  /** Delete a Drive file that must not outlive a failed write; the failure is logged, not thrown. */
  async function rollbackDriveFile(
    token: string,
    fileId: string,
    surface: 'photo-upload' | 'photo-replace'
  ): Promise<void> {
    try {
      await deleteFile(token, fileId);
    } catch (deleteErr) {
      if (deleteErr instanceof DriveFileNotFoundError) return;
      reportError({
        surface,
        message: 'rollback delete of the Drive file failed; the file is orphaned',
        severity: 'warning',
        error: deleteErr,
        context: { action: 'rollback-delete-failed', http_status: httpStatus(deleteErr) },
      });
    }
  }

  /**
   * Completes an upload (the finalization step for both the online path and
   * the queue flush handler). Atomic: if the Automerge write fails, the
   * just-uploaded Drive file is deleted so we don't leave orphans.
   *
   * Idempotent per photoId (C11), because a queued entry can be retried after a partial
   * success (the tab died between `createFile` and the doc write, or the write landed in the
   * worker but its reply was lost):
   *   - a `photos` record that already carries a `driveFileId` means the upload finished;
   *     only the host attach is re-issued (a no-op when it already holds the id);
   *   - on a RETRY (`fromQueue`), the deterministic filename is looked up in the photos folder
   *     before a new file is created, so a crash mid-way does not leave a second copy.
   *
   * PDFs ride this path byte-for-byte (no re-encode), so their document metadata (author,
   * producer) stays in the file behind the public link. Follow-up: decide whether booking
   * documents should get the public-link grant at all, or render through `getFileBlob`.
   */
  async function finalizeUpload(
    payload: Omit<QueuedPhotoUpload, 'id' | 'createdAt'>,
    opts: { fromQueue?: boolean; familyId: string | null }
  ): Promise<void> {
    // Round 3: the upload belongs to ONE family. A queued entry drained after a switch (or a
    // direct upload that outlived one) must never land in another family's doc or folder.
    assertActiveFamily(opts.familyId, 'start');
    const already = photos.value[payload.photoId];
    if (already?.driveFileId) {
      await mutate({
        op: 'named',
        name: 'attachPhotoToEntity',
        args: {
          entityCollection: payload.entityCollection,
          entityId: payload.entityId,
          photoId: payload.photoId,
        },
      });
      photoEvent('photo-upload', 'info', 'finalize skipped: record already holds a Drive file', {
        action: 'finalize-already-done',
      });
      unresolvedIds.value.delete(payload.photoId);
      return;
    }

    const folderId = await resolvePhotosFolderId();
    const token = await requestAccessToken();
    let fileId: string | null = null;
    if (opts.fromQueue) {
      // The reuse lookup is what stops a retry creating a second file. If it fails the entry
      // must stay queued (rethrow), never fall through to a fresh create.
      const found = await listFilesInFolder(token, folderId, payload.filename).catch((e) => {
        photoEvent(
          'photo-upload',
          'warn',
          'reuse lookup failed; the entry stays queued',
          { action: 'finalize-reuse-lookup-failed', http_status: httpStatus(e) },
          e
        );
        throw e;
      });
      fileId = found.find((f) => f.name === payload.filename)?.id ?? null;
      if (fileId) {
        photoEvent('photo-upload', 'info', 'finalize reused the file a prior attempt created', {
          action: 'finalize-reused-file',
        });
      }
    }
    if (!fileId) {
      ({ fileId } = await createFile(
        token,
        folderId,
        payload.filename,
        payload.blob,
        payload.mime
      ));
    }

    // Grant anyone-with-link read so family members whose `drive.file`
    // scope doesn't cover this file can still fetch bytes by URL. The
    // Automerge doc carrying these IDs is encrypted with the family
    // key, so effective exposure is the same trust boundary as the doc
    // itself. See ADR-021 "public-link access" section. Failure is
    // non-fatal — the file is uploaded; the migration sweep will retry.
    await grantPublicLink(token, fileId, 'upload');
    // The Drive work took real time: re-check before the doc write. No rollback on a
    // mismatch: the file sits in the uploading family's folder, where that family's next
    // drain reuses it (the deterministic filename lookup above).
    assertActiveFamily(opts.familyId, 'before-write');

    try {
      const now = new Date().toISOString();
      const record: PhotoAttachment = {
        id: payload.photoId,
        driveFileId: fileId,
        mime: payload.mime,
        width: payload.width,
        height: payload.height,
        sizeBytes: payload.sizeBytes,
        createdAt: now,
        updatedAt: now,
      };
      // Automerge rejects undefined property assignments — only set optional
      // fields when they have a value.
      if (payload.createdBy) record.createdBy = payload.createdBy;
      if (payload.fileName) record.fileName = payload.fileName;
      // Atomic: store the photo record + attach it to the host in one batch. A
      // benign attach miss (mid-wizard vacation) does NOT reject the batch (the
      // worker attach handler catches + logs), so the record still lands.
      await mutate({
        op: 'batch',
        ops: [
          { op: 'set', collection: 'photos', id: payload.photoId, entity: record },
          {
            op: 'named',
            name: 'attachPhotoToEntity',
            args: {
              entityCollection: payload.entityCollection,
              entityId: payload.entityId,
              photoId: payload.photoId,
            },
          },
        ],
      });
    } catch (writeErr) {
      // Rollback — but only when the record is genuinely absent. A rejected `mutate` can be a
      // late reply on a write the worker already committed (C12); deleting the file then would
      // leave a live record pointing at nothing, which is the one loss worse than an orphan.
      await rollbackUnlessRecorded(token, payload.photoId, fileId, 'photo-upload');
      throw writeErr;
    }

    // Bust any stale URL cache entry (shouldn't exist yet, but defensive).
    thumbUrlCache.delete(fileId);
    unresolvedIds.value.delete(payload.photoId);
  }

  /** The photoUploadQueue flush handler — finalizes a queued entry for the family it drains. */
  async function handleQueuedUpload(entry: QueuedPhotoUpload, familyId: string): Promise<void> {
    await finalizeUpload(entry, { fromQueue: true, familyId });
    await refreshPending();
  }

  /** Throw (logged) when `familyId` is not the family open now; the caller's work stops. */
  function assertActiveFamily(familyId: string | null, stage: string): void {
    const active = familyContextStore.activeFamilyId;
    if (familyId && familyId === active) return;
    photoEvent('photo-upload', 'warn', 'finalize refused: not the active family', {
      action: 'finalize-family-mismatch',
      stage,
    });
    throw new Error('photoStore: the upload belongs to a family that is not open');
  }

  /**
   * Is `fileId` the file the WORKER doc's record for `photoId` names? Read through the worker
   * (an empty, skip-on-missing patch writes nothing and echoes the stored record), never the
   * projection: a rejected `mutate` can be a late reply on a write the worker already
   * committed, whose delta the projection has not seen. `null` when the doc cannot be read.
   */
  async function workerRecordNames(photoId: string, fileId: string): Promise<boolean | null> {
    try {
      const stored = await mutate<PhotoAttachment | undefined>(
        { op: 'patch', collection: 'photos', id: photoId, patch: {}, onMissing: 'skip' },
        { quiet: true }
      );
      return stored?.driveFileId === fileId;
    } catch (e) {
      photoEvent(
        'photo-upload',
        'warn',
        'could not re-read the record before a rollback',
        {
          action: 'rollback-read-failed',
        },
        e
      );
      return null;
    }
  }

  /**
   * Rollback for a failed doc write: delete the just-created Drive file ONLY when the worker
   * doc provably does not name it. Present → kept (deleting would leave a live record pointing
   * at nothing). Unreadable → kept too: an orphan file is the lesser loss, and GC reclaims it.
   */
  async function rollbackUnlessRecorded(
    token: string,
    photoId: string,
    fileId: string,
    surface: 'photo-upload' | 'photo-replace'
  ): Promise<void> {
    const named = await workerRecordNames(photoId, fileId);
    if (named === false) {
      await rollbackDriveFile(token, fileId, surface);
      return;
    }
    photoEvent(
      surface,
      'warn',
      named ? 'doc write rejected after the record landed; kept' : 'rollback skipped: unverified',
      { action: named ? 'rollback-skipped-record-present' : 'rollback-skipped-unverified' }
    );
  }

  // --- URL resolution --------------------------------------------------

  async function getImageUrl(photoId: UUID, size: PhotoSize = 'thumb'): Promise<string | null> {
    const photo = photos.value[photoId];
    if (!photo || photo.deletedAt) return null;

    const px = size === 'full' ? DEFAULT_FULL_SIZE : DEFAULT_THUMB_SIZE;
    const baseUrl = await fetchThumbnailBaseUrl(photo.driveFileId, photoId);
    if (!baseUrl) return null;
    return resizeThumbnailUrl(baseUrl, px);
  }

  /**
   * The single authorized `alt=media` download. Returns BYTES, not a URL, so
   * callers that want bytes (the PDF renderer, the save-to-device action) stop
   * round-tripping through an object URL.
   *
   * Replaces the former `getBlobUrl`, which returned an object URL and was
   * `@deprecated` pending the ADR-021 public-link migration. Its only caller
   * moved here, so keeping a wrapper would have left an unused deprecated
   * export — dead code the next reader has to prove is dead.
   *
   * NOTE (ADR-021): a family member whose `drive.file` scope doesn't cover an
   * other-owned file can still SEE it (via the public-link grant that
   * `getPublicUrl` uses) but may not be able to download it here. That resolves
   * to `null` → the existing missing-photo state, never a dead button.
   */
  async function getFileBlob(photoId: UUID): Promise<Blob | null> {
    const photo = photos.value[photoId];
    if (!photo || photo.deletedAt) return null;

    const cached = blobCache.get(photo.driveFileId);
    if (cached) return cached;

    try {
      const token = await requestAccessToken();
      const blob = await downloadFileBlob(token, photo.driveFileId);
      cacheBlob(photo.driveFileId, blob);
      unresolvedIds.value.delete(photoId);
      return blob;
    } catch (e) {
      // 404 ONLY, deliberately narrower than the rest of this store.
      // `driveService` raises `DriveFileNotFoundError` for 403 as well as 404,
      // and 403 is the ADR-021 case: member B fetching member A's photo, which
      // renders perfectly well through its public link. Marking that unresolved
      // from a save-to-device tap would flip the photo to "missing" app-wide —
      // the button vanishes, the footer offers "Replace photo", the bin becomes
      // an unlink, and every thumbnail of a healthy photo blanks. Images only
      // started taking this path when the save button began fetching bytes.
      const status = e instanceof DriveApiError ? e.status : undefined;
      if (e instanceof DriveFileNotFoundError && status === 404) {
        markUnresolved(photoId);
      }
      // Was a bare `console.warn`, which never leaves the device — and this is
      // now the only record of why a save-to-device tap failed.
      logEvent({
        level: 'warn',
        surface: 'file-delivery',
        message: 'photo bytes could not be fetched',
        context: {
          action: 'delivery-failed',
          kind: 'photo',
          stage: 'source',
          http_status: status,
        },
        error: e,
      });
      return null;
    }
  }

  /**
   * Reactive runtime flag. Set when a Drive fetch returns 404/403; cleared
   * when a replace or fresh lookup succeeds.
   */
  function isUnresolved(photoId: UUID): boolean {
    return unresolvedIds.value.has(photoId);
  }

  /**
   * Public CDN URL for a photo — no OAuth required. Works because every
   * photo upload sets `type: anyone, role: reader` permission on the
   * Drive file. See ADR-021 "public-link access" section for the
   * privacy analysis (URL lives in the encrypted Automerge doc so
   * effective exposure is "anyone holding the family key" = members).
   *
   * Uses `lh3.googleusercontent.com/d/{id}=wN` rather than
   * `drive.google.com/thumbnail?id=...` or `drive.google.com/uc?...` —
   * the `drive.google.com` URLs are session-sensitive (can bounce
   * anonymous loads to a sign-in page even for anyone-with-link files)
   * AND the `/thumbnail` endpoint only serves after Drive has
   * generated a thumbnail, which doesn't happen instantly on upload.
   * `lh3.googleusercontent.com` is Google's image CDN, works without a
   * session for public files, supports size modifiers, and falls back
   * to original bytes when a thumbnail isn't ready yet.
   *
   * Returns `null` when the photo isn't in the doc, is tombstoned, or
   * has been flagged unresolved (usually a genuine Drive 404 from a
   * deleted file — UI shows the broken-image tile for these).
   *
   * Sync. Deterministic. No caching needed.
   */
  function getPublicUrl(photoId: UUID, size: PhotoSize = 'thumb'): string | null {
    const photo = photos.value[photoId];
    if (!photo || photo.deletedAt) return null;
    if (unresolvedIds.value.has(photoId)) return null;
    const id = encodeURIComponent(photo.driveFileId);
    const px = size === 'full' ? DEFAULT_FULL_SIZE : DEFAULT_THUMB_SIZE;
    return `https://lh3.googleusercontent.com/d/${id}=w${px}`;
  }

  async function fetchThumbnailBaseUrl(driveFileId: string, photoId: UUID): Promise<string | null> {
    const cached = thumbUrlCache.get(driveFileId);
    if (cached && Date.now() - cached.fetchedAt < THUMB_TTL_MS) {
      return cached.url;
    }
    try {
      const token = await requestAccessToken();
      const meta = await getFileMetadata(token, driveFileId, 'thumbnailLink');
      const url = (meta.thumbnailLink as string | undefined) ?? null;
      if (!url) return null;
      thumbUrlCache.set(driveFileId, { url, fetchedAt: Date.now() });
      // Clear unresolved flag if we successfully re-fetched.
      if (unresolvedIds.value.has(photoId)) {
        unresolvedIds.value.delete(photoId);
        triggerRef(unresolvedIds);
      }
      return url;
    } catch (e) {
      if (e instanceof DriveFileNotFoundError) {
        markUnresolved(photoId);
        return null;
      }
      throw e;
    }
  }

  function markUnresolved(photoId: UUID): void {
    if (!unresolvedIds.value.has(photoId)) {
      unresolvedIds.value.add(photoId);
      triggerRef(unresolvedIds);
    }
  }

  /**
   * Drop this photo's cached image URLs (both thumbnailLink and blob)
   * so the next `getImageUrl` / `getFileBlob` call re-fetches. Useful
   * when an `<img>` fires `error` on a previously-valid URL — Drive
   * CDN tokens rotate, blob URLs can go bad if the backing file was
   * replaced. Safe to call even with no cached entry.
   */
  function invalidateThumbCache(photoId: UUID): void {
    const photo = photos.value[photoId];
    if (!photo) return;
    thumbUrlCache.delete(photo.driveFileId);
    blobCache.delete(photo.driveFileId);
  }

  /**
   * `thumbnailLink` URLs look like `https://lh3.googleusercontent.com/.../=s220`.
   * Replace the trailing size suffix to request a larger render, or append
   * a `sz=w{N}` query param as a fallback for URLs without the trailing form.
   */
  function resizeThumbnailUrl(url: string, size: number): string {
    // Drive thumbnailLink URLs end with `=s{N}` and occasionally a `-c` /
    // `-p` crop hint: `...=s220`, `...=s220-c`. Match the suffix and swap.
    const trailingSize = /=s\d+(-[cp])?$/;
    if (trailingSize.test(url)) {
      return url.replace(trailingSize, `=s${size}`);
    }
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}sz=w${size}`;
  }

  // --- Avatar photos ---------------------------------------------------

  /**
   * Upload a family-member avatar photo. Avatars use a tighter compression
   * profile (1024px max, q=0.92) and are NOT attached to any entity's
   * `photoIds` array — instead, the caller (e.g. familyStore) sets the
   * returned photoId on `FamilyMember.avatarPhotoId`. The `familyMembers`
   * collection is registered with the GC so orphan avatars get cleaned up.
   */
  async function addAvatarPhoto(file: File, createdBy?: UUID): Promise<UUID> {
    if (!photosEnabled.value) {
      throw new Error('photoStore: cloud sync is required to upload avatars.');
    }

    let compressed;
    try {
      compressed = await compress(file, { maxDimension: 1024, quality: 0.92 });
    } catch (e) {
      if (e instanceof CompressionError) throw e;
      throw new CompressionError('Failed to compress avatar', e);
    }

    const photoId = crypto.randomUUID();
    const filename = `beanies-avatar-${photoId}.jpg`;

    const folderId = await resolvePhotosFolderId();
    const token = await requestAccessToken();
    const { fileId } = await createFile(
      token,
      folderId,
      filename,
      compressed.blob,
      compressed.mime
    );

    // Public-link grant — see finalizeUpload for rationale.
    await grantPublicLink(token, fileId, 'avatar');

    try {
      const now = new Date().toISOString();
      const record: PhotoAttachment = {
        id: photoId,
        driveFileId: fileId,
        mime: compressed.mime,
        width: compressed.width,
        height: compressed.height,
        sizeBytes: compressed.blob.size,
        createdAt: now,
        updatedAt: now,
      };
      if (createdBy) record.createdBy = createdBy;
      await mutate({ op: 'set', collection: 'photos', id: photoId, entity: record });
    } catch (writeErr) {
      await rollbackUnlessRecorded(token, photoId, fileId, 'photo-upload');
      throw writeErr;
    }

    thumbUrlCache.delete(fileId);
    unresolvedIds.value.delete(photoId);
    return photoId;
  }

  // --- Replace / delete ------------------------------------------------

  async function replacePhotoFile(photoId: UUID, newFile: File): Promise<void> {
    const existing = photos.value[photoId];
    if (!existing) throw new Error(`photoStore.replacePhotoFile: unknown photo ${photoId}`);
    if (!photosEnabled.value) {
      throw new Error('photoStore.replacePhotoFile: cloud sync is required.');
    }

    const compressed = await compress(newFile);
    const folderId = await resolvePhotosFolderId();
    const token = await requestAccessToken();
    const filename = `beanies-photo-${photoId}.jpg`;
    const { fileId: newDriveFileId } = await createFile(
      token,
      folderId,
      filename,
      compressed.blob,
      compressed.mime
    );

    // Public-link grant — see finalizeUpload for rationale.
    await grantPublicLink(token, newDriveFileId, 'replace');

    // The previous file is RETIRED, not deleted: a peer that has not received this patch
    // still renders the old `driveFileId`, and a replace whose patch loses a merge would
    // point at a deleted file. The id goes onto the record's grace list and the GC sweep
    // reclaims it once the record's `updatedAt` is past the grace window.
    const previousDriveFileId = existing.driveFileId;
    const retired = [...(existing.retiredDriveFileIds ?? [])];
    if (previousDriveFileId && !retired.includes(previousDriveFileId)) {
      retired.push(previousDriveFileId);
    }
    try {
      await mutate({
        op: 'patch',
        collection: 'photos',
        id: photoId,
        patch: {
          driveFileId: newDriveFileId,
          mime: compressed.mime,
          width: compressed.width,
          height: compressed.height,
          sizeBytes: compressed.blob.size,
          retiredDriveFileIds: retired,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (writeErr) {
      // The record still names the previous file, so the NEW upload is the orphan.
      await rollbackUnlessRecorded(token, photoId, newDriveFileId, 'photo-replace');
      throw writeErr;
    }

    thumbUrlCache.delete(previousDriveFileId);
    thumbUrlCache.delete(newDriveFileId);
    blobCache.delete(previousDriveFileId);
    unresolvedIds.value.delete(photoId);
    triggerRef(unresolvedIds);
    photoEvent('photo-replace', 'info', 'photo file replaced; previous file retired', {
      action: 'replaced',
      file_count: retired.length,
    });
  }

  /**
   * Is `photoId` referenced by any host right now? Reads the worker doc, so it sees every
   * attach and detach that has been applied. `'unknown'` when a collect hook threw — the
   * caller must then treat the photo as referenced (never tombstone on a partial answer).
   */
  async function referenceState(photoId: UUID): Promise<'referenced' | 'unreferenced' | 'unknown'> {
    try {
      const { ids } = await collectPhotoIdsRpc({ quiet: true });
      return ids.includes(photoId) ? 'referenced' : 'unreferenced';
    } catch (e) {
      photoEvent(
        'photo-detach',
        'warn',
        'reference check failed; photo kept',
        { action: 'reference-check-failed' },
        e
      );
      return 'unknown';
    }
  }

  /**
   * Tombstone a photo — but ONLY once no host references it (C11). Detach is the primitive:
   * the caller removes the id from its own host's `photoIds` first; this then checks every
   * registered host (`collectReferencedPhotoIds`) and writes `deletedAt` only when the id is
   * unreferenced. A photo shared across hosts (one itinerary PDF linked to several booking
   * segments, a milestone photo re-used on a scrapbook spread) therefore survives a removal
   * from one of them, where it used to be tombstoned for all of them.
   *
   * `awaitDetachMs`: when the host write is not awaitable by the caller (the avatar modal
   * emits `save` and the parent persists it), wait up to this long for a doc change that
   * drops the reference, re-checking on every `docVersion` bump. Times out to `false`, which
   * leaves the photo alive — the safe side.
   *
   * At tombstone time the anyone-with-link grant is revoked immediately; the bytes stay until
   * the GC grace elapses, and a tombstoned photo must not stay world-readable meanwhile.
   *
   * Returns whether a tombstone was written (or was already present).
   */
  async function markDeleted(
    photoId: UUID,
    opts: { awaitDetachMs?: number } = {}
  ): Promise<boolean> {
    const photo = photos.value[photoId];
    if (!photo) return false;
    if (photo.deletedAt) return true;

    let state = await referenceState(photoId);
    if (state === 'referenced' && opts.awaitDetachMs) {
      state = await waitForDetach(photoId, opts.awaitDetachMs);
    }
    if (state !== 'unreferenced') {
      photoEvent('photo-detach', 'info', 'photo detached from a host but still referenced', {
        action: state === 'unknown' ? 'kept-unknown' : 'kept-referenced',
      });
      return false;
    }

    const now = new Date().toISOString();
    await mutate({
      op: 'patch',
      collection: 'photos',
      id: photoId,
      patch: { deletedAt: now },
      updatedAt: now,
      onMissing: 'skip',
    });
    thumbUrlCache.delete(photo.driveFileId);
    blobCache.delete(photo.driveFileId);
    photoEvent('photo-detach', 'info', 'photo tombstoned', { action: 'tombstoned' });
    await revokePublicLink(photo.driveFileId);
    return true;
  }

  /** Re-check the reference on each doc change until it drops or `timeoutMs` elapses. */
  function waitForDetach(
    photoId: UUID,
    timeoutMs: number
  ): Promise<'referenced' | 'unreferenced' | 'unknown'> {
    return new Promise((resolve) => {
      let settled = false;
      let checking = false;
      const finish = (state: 'referenced' | 'unreferenced' | 'unknown'): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stop();
        resolve(state);
      };
      const timer = setTimeout(() => finish('referenced'), timeoutMs);
      const stop = watch(docVersion, async () => {
        if (settled || checking) return;
        checking = true;
        const state = await referenceState(photoId);
        checking = false;
        if (state !== 'referenced') finish(state);
      });
    });
  }

  // --- Garbage collection ---------------------------------------------

  /**
   * Reclaim Drive bytes and `photos` records nobody can reach any more:
   *   - a tombstone past its 24h grace that NO host references (a re-attach clears
   *     `deletedAt`, and a tombstone a concurrent attach raced is never collected);
   *   - a record with no host reference that is older than the orphan grace;
   *   - every `retiredDriveFileIds` entry on a record whose `updatedAt` is past the grace.
   *
   * ⚠️ UNWIRED. No scheduler calls this yet (C11). Wire it only once the offline queue has
   * soaked: `photoStore.activate` first shipped in 2026-10, so a queue entry written before
   * then can still flush a photo whose host attach happens AFTER the record lands. The soak
   * condition is: two releases with `photo-upload-flush` showing no stuck entries and no
   * `photo-upload` `rollback-skipped-record-present` events, after which a daily sweep on
   * family activation is safe.
   */
  async function gcOrphans(): Promise<{ scanned: number; deleted: number; reclaimed: number }> {
    const all = projectionList('photos');
    const now = Date.now();
    const toDelete: PhotoAttachment[] = [];
    const empty = { scanned: all.length, deleted: 0, reclaimed: 0 };

    // Fail-safe: if ANY collect hook throws (surfaced as an RPC rejection) we
    // cannot reliably tell which photos are referenced — deleting on a partial
    // set would wipe live attachments. Abort the sweep entirely (delete nothing)
    // and retry next time. `{quiet}`: the abort is expected, not a toast.
    let referenced: Set<UUID>;
    try {
      const { ids } = await collectPhotoIdsRpc({ quiet: true });
      referenced = new Set(ids);
    } catch (e) {
      photoEvent(
        'photo-gc',
        'warn',
        'sweep aborted: reference collect failed',
        {
          action: 'sweep-aborted',
        },
        e
      );
      return empty;
    }

    const hosts = hasPhotoCollections();
    const retirements: Array<{ photo: PhotoAttachment; fileIds: string[] }> = [];
    for (const photo of all) {
      if (referenced.has(photo.id)) {
        // Live record: only its retired files are candidates.
        const retired = photo.retiredDriveFileIds ?? [];
        if (retired.length > 0 && now - Date.parse(photo.updatedAt) > TOMBSTONE_GRACE_MS) {
          retirements.push({ photo, fileIds: [...retired] });
        }
        continue;
      }
      const tombstoneExpired =
        !!photo.deletedAt && now - Date.parse(photo.deletedAt) > TOMBSTONE_GRACE_MS;
      const orphaned =
        hosts && !photo.deletedAt && now - Date.parse(photo.createdAt) > ORPHAN_GRACE_MS;
      if (tombstoneExpired || orphaned) toDelete.push(photo);
    }

    if (toDelete.length === 0 && retirements.length === 0) return empty;

    // No token means no Drive delete, and the record must NOT go either: a record deleted
    // ahead of its file leaves bytes on Drive that nothing can ever find again.
    const token = await requestAccessToken().catch(() => null);
    if (!token) {
      photoEvent('photo-gc', 'warn', 'sweep skipped: no access token', {
        action: 'sweep-no-token',
        file_count: toDelete.length,
      });
      return empty;
    }

    /** Delete one Drive file; `true` when it is gone (deleted or already 404). */
    async function reclaimFile(fileId: string): Promise<boolean> {
      try {
        await deleteFile(token!, fileId);
        return true;
      } catch (e) {
        if (e instanceof DriveFileNotFoundError) return true;
        photoEvent(
          'photo-gc',
          'warn',
          'Drive delete failed; retried next sweep',
          { action: 'drive-delete-failed', http_status: httpStatus(e) },
          e
        );
        return false;
      }
    }

    let deleted = 0;
    for (const photo of toDelete) {
      const gone = await reclaimFile(photo.driveFileId);
      for (const retiredId of photo.retiredDriveFileIds ?? []) await reclaimFile(retiredId);
      // Don't drop the Automerge record until the Drive file is gone — retry next sweep.
      if (!gone) continue;
      // The worker owns the doc, so this is a single-id delete RPC per survivor.
      await mutate({ op: 'delete', collection: 'photos', id: photo.id });
      thumbUrlCache.delete(photo.driveFileId);
      unresolvedIds.value.delete(photo.id);
      deleted++;
    }

    let reclaimed = 0;
    for (const { photo, fileIds } of retirements) {
      const remaining: string[] = [];
      for (const fileId of fileIds) {
        if (await reclaimFile(fileId)) reclaimed++;
        else remaining.push(fileId);
      }
      if (remaining.length === fileIds.length) continue;
      await mutate({
        op: 'patch',
        collection: 'photos',
        id: photo.id,
        patch: { retiredDriveFileIds: remaining },
        onMissing: 'skip',
      });
    }

    triggerRef(unresolvedIds);
    photoEvent('photo-gc', 'info', 'sweep complete', {
      action: 'sweep-complete',
      file_count: deleted + reclaimed,
    });
    return { scanned: all.length, deleted, reclaimed };
  }

  // --- Pending uploads -------------------------------------------------

  async function refreshPending(): Promise<void> {
    pendingUploads.value = await getPending();
    triggerRef(pendingUploads);
  }

  function pendingUploadsFor(entityCollection: string, entityId: string): QueuedPhotoUpload[] {
    return pendingUploads.value.filter(
      (e) => e.entityCollection === entityCollection && e.entityId === entityId
    );
  }

  /**
   * Live photoIds for an entity, read directly from the Automerge doc and
   * subscribed to `docVersion` so callers re-render when the doc changes.
   *
   * Use this instead of reading `photoIds` from a captured prop snapshot when
   * the caller needs to reflect background updates. The motivating case
   * (caught 2026-05-18 from greg's localhost repro):
   *
   *   1. User adds a photo to an activity.
   *   2. Closes the drawer mid-upload (BaseSidePanel's `v-if="open"` unmounts
   *      PhotoAttachments + its composable).
   *   3. `finalizeUpload` continues in the background; its `changeDoc` writes
   *      the photoId into `doc.activities[id].photoIds` via `attachPhotoToEntity`.
   *   4. `activityStore.activities` is a static `ref<Activity[]>` that's only
   *      re-read on explicit `loadActivities()` calls — it does NOT subscribe
   *      to `docVersion`. So its in-memory snapshot of the activity is stale.
   *   5. The `update:photo-ids` emit from the (now unmounted) PhotoAttachments
   *      is a no-op, so the normal `activityStore.updateActivity` follow-up
   *      doesn't fire either.
   *   6. User reopens the drawer; the binding's `initialPhotoIds` getter
   *      reads from `props.activity?.photoIds` — also stale because
   *      `editingActivity.value = target` captured a plain object reference
   *      at click time.
   *   7. Photo doesn't appear until a full refresh re-loads activities from
   *      the doc.
   *
   * This getter bypasses the stale-store / stale-prop chain by reading the
   * doc directly. Reactive on `docVersion`, so any consumer using it inside
   * a `computed` / `watch` / `usePhotoEntityBinding` re-renders when the
   * photoId lands. Returns `undefined` when the entity isn't found yet
   * (caller treats that the same as "no photoIds").
   */
  function photoIdsFor(
    entityCollection: string,
    entityId: string | null | undefined
  ): UUID[] | undefined {
    if (!entityId) return undefined;
    void docVersion.value;
    const entity = projectionGetById(entityCollection as CollectionName, entityId) as
      { photoIds?: UUID[] } | undefined;
    return entity?.photoIds;
  }

  // --- Helpers ---------------------------------------------------------

  /**
   * Link an ALREADY-STORED photo to an additional entity, without re-uploading the
   * blob. Used when one source document belongs to several entities (e.g. a travel
   * itinerary that extracts into multiple booking segments — #30): the file is stored
   * once via `addPhoto`, then its photoId is linked to every other segment here.
   * Runs the `attachPhotoToEntity` named op in the worker; a throwing hook is logged
   * there, never thrown.
   */
  function linkPhotoToEntity(entityCollection: string, entityId: string, photoId: UUID): void {
    fireAndForgetMutate({
      op: 'batch',
      ops: [
        {
          op: 'named',
          name: 'attachPhotoToEntity',
          args: { entityCollection, entityId, photoId },
        },
        // A re-attach revives a tombstone (C11): the id is referenced again, so `deletedAt`
        // must go or the GC sweep would reclaim a photo a host now points at. `deleteKeys` on
        // an untombstoned record is a no-op write (`changed: false`).
        {
          op: 'patch',
          collection: 'photos',
          id: photoId,
          patch: {},
          deleteKeys: ['deletedAt'],
          onMissing: 'skip',
        },
      ],
    });
  }

  return {
    // state (computed)
    photos,
    photosEnabled,
    pendingUploads,
    // lifecycle
    activate,
    activateInBackground,
    deactivate,
    // actions
    addPhoto,
    linkPhotoToEntity,
    addAvatarPhoto,
    getImageUrl,
    getFileBlob,
    isUnresolved,
    markUnresolved,
    getPublicUrl,
    invalidateThumbCache,
    replacePhotoFile,
    markDeleted,
    gcOrphans,
    resolveCanonicalFolderId,
    pendingUploadsFor,
    photoIdsFor,
    refreshPending,
    // constants
    QUEUE_SOFT_CAP,
  };
});

// Exported for tests only. The registry now lives in `worker/photoOps.ts`.
export const __internals = {
  registerPhotoCollection,
  flatHooks,
};
