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
import { computed, ref, shallowRef, triggerRef } from 'vue';
import {
  createFile,
  deleteFile,
  downloadFileBlob,
  findOrCreateFolder,
  getFileMetadata,
  setPublicLinkPermission,
  DriveFileNotFoundError,
} from '@/services/google/driveService';
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
import { changeDoc, getDoc, docVersion } from '@/services/automerge/docService';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import type { FamilyDocument } from '@/types/automerge';
import type { PhotoAttachment, UUID } from '@/types/models';

const THUMB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOMBSTONE_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_THUMB_SIZE = 400;
const DEFAULT_FULL_SIZE = 2048;

export type PhotoSize = 'thumb' | 'full';

export type PhotoResolution =
  | { status: 'ok'; url: string }
  | { status: 'pending' }
  | { status: 'missing' };

/**
 * Collections that currently reference photos via a `photoIds?: UUID[]`
 * field. Follow-up integration plans (activities, family avatars, todos)
 * register their collection name here so `gcOrphans` can detect photos
 * with zero inbound references.
 */
const photoReferringCollections = new Set<string>();

export function registerPhotoCollection(name: string): void {
  photoReferringCollections.add(name);
}

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
   * have proven unreliable across page reloads. Entries are revoked on
   * deactivate() and on explicit invalidation.
   */
  const blobUrlCache = new Map<string, string>();

  // Reactive projection of `photos` collection — re-reads on every docVersion bump.
  const photos = computed<Record<UUID, PhotoAttachment>>(() => {
    void docVersion.value; // subscribe to reactivity
    try {
      return getDoc().photos ?? {};
    } catch {
      return {};
    }
  });

  const photosEnabled = computed(() => !!syncStore.driveFileId);

  // --- Lifecycle --------------------------------------------------------

  async function activate(familyId: string): Promise<void> {
    setQueueFamily(familyId);
    setQueueFlushHandler(handleQueuedUpload);
    await refreshPending();
    if (navigator.onLine) {
      void flushPhotoQueue().finally(() => refreshPending());
    }
  }

  function deactivate(): void {
    clearQueueFamily();
    unresolvedIds.value = new Set();
    canonicalFolderId.value = null;
    photosFolderIdByFamily.clear();
    thumbUrlCache.clear();
    for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
    blobUrlCache.clear();
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

  async function addPhoto(
    file: File,
    entityCollection: string,
    entityId: string,
    createdBy?: UUID
  ): Promise<UUID> {
    if (!photosEnabled.value) {
      throw new Error('photoStore: cloud sync is required to attach photos.');
    }

    // Compress first so the queue stores the smaller blob (and we know
    // the final dimensions/mime even before we attempt Drive upload).
    let compressed;
    try {
      compressed = await compress(file);
    } catch (e) {
      if (e instanceof CompressionError) throw e;
      throw new CompressionError('Failed to compress image', e);
    }

    const photoId = crypto.randomUUID();
    const filename = `beanies-photo-${photoId}.jpg`;

    // Offline path: queue for later. Metadata is only written to Automerge
    // after the upload actually succeeds (avoids half-baked records).
    if (!navigator.onLine) {
      await enqueueUpload({
        photoId,
        entityCollection,
        entityId,
        blob: compressed.blob,
        filename,
        mime: compressed.mime,
        width: compressed.width,
        height: compressed.height,
        sizeBytes: compressed.blob.size,
        createdBy,
      });
      await refreshPending();
      return photoId;
    }

    // Online path: upload → write Automerge → push to entity.photoIds.
    await finalizeUpload({
      photoId,
      entityCollection,
      entityId,
      blob: compressed.blob,
      filename,
      mime: compressed.mime,
      width: compressed.width,
      height: compressed.height,
      sizeBytes: compressed.blob.size,
      createdBy,
    });
    return photoId;
  }

  /**
   * Completes an upload (the finalization step for both the online path and
   * the queue flush handler). Atomic: if the Automerge write fails, the
   * just-uploaded Drive file is deleted so we don't leave orphans.
   */
  async function finalizeUpload(
    payload: Omit<QueuedPhotoUpload, 'id' | 'createdAt'>
  ): Promise<void> {
    const folderId = await resolvePhotosFolderId();
    const token = await requestAccessToken();
    const { fileId } = await createFile(
      token,
      folderId,
      payload.filename,
      payload.blob,
      payload.mime
    );

    // Grant anyone-with-link read so family members whose `drive.file`
    // scope doesn't cover this file can still fetch bytes by URL. The
    // Automerge doc carrying these IDs is encrypted with the family
    // key, so effective exposure is the same trust boundary as the doc
    // itself. See ADR-021 "public-link access" section. Failure is
    // non-fatal — the file is uploaded; the migration sweep will retry.
    await setPublicLinkPermission(token, fileId).catch((e) => {
      console.warn('[photoStore] public-link setup failed on upload', {
        photoId: payload.photoId,
        fileId,
        error: e,
      });
    });

    try {
      const now = new Date().toISOString();
      changeDoc((doc: FamilyDocument) => {
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
        // Automerge rejects undefined property assignments — only set
        // optional fields when they have a value.
        if (payload.createdBy) record.createdBy = payload.createdBy;
        doc.photos[payload.photoId] = record;
        attachPhotoToEntity(doc, payload.entityCollection, payload.entityId, payload.photoId);
      }, `photos: add ${payload.photoId}`);
    } catch (writeErr) {
      // Rollback: try to delete the Drive file we just created.
      try {
        await deleteFile(token, fileId);
      } catch (deleteErr) {
        console.warn('[photoStore] Rollback delete failed', deleteErr);
      }
      throw writeErr;
    }

    // Bust any stale URL cache entry (shouldn't exist yet, but defensive).
    thumbUrlCache.delete(fileId);
    unresolvedIds.value.delete(payload.photoId);
  }

  /** The photoUploadQueue flush handler — finalizes a queued entry. */
  async function handleQueuedUpload(entry: QueuedPhotoUpload): Promise<void> {
    await finalizeUpload(entry);
    await refreshPending();
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
   * Reliable image URL via authorized `alt=media` + `URL.createObjectURL`.
   *
   * @deprecated Use `getPublicUrl` instead. Public-link rendering (ADR-021)
   * removes the OAuth dependency entirely — photos render without an
   * access-token round-trip, which also means family members whose
   * `drive.file` scope doesn't cover other-owned files can still see
   * photos. This function is kept for the transition only and will be
   * removed in a follow-up once every call site has migrated.
   */
  async function getBlobUrl(photoId: UUID): Promise<string | null> {
    const photo = photos.value[photoId];
    if (!photo || photo.deletedAt) return null;

    const cached = blobUrlCache.get(photo.driveFileId);
    if (cached) return cached;

    try {
      const token = await requestAccessToken();
      const blob = await downloadFileBlob(token, photo.driveFileId);
      const url = URL.createObjectURL(blob);
      blobUrlCache.set(photo.driveFileId, url);
      unresolvedIds.value.delete(photoId);
      return url;
    } catch (e) {
      if (e instanceof DriveFileNotFoundError) {
        markUnresolved(photoId);
        return null;
      }
      console.warn('[photoStore] getBlobUrl download failed', photoId, e);
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
   * so the next `getImageUrl` / `getBlobUrl` call re-fetches. Useful
   * when an `<img>` fires `error` on a previously-valid URL — Drive
   * CDN tokens rotate, blob URLs can go bad if the backing file was
   * replaced. Safe to call even with no cached entry.
   */
  function invalidateThumbCache(photoId: UUID): void {
    const photo = photos.value[photoId];
    if (!photo) return;
    thumbUrlCache.delete(photo.driveFileId);
    const cachedBlob = blobUrlCache.get(photo.driveFileId);
    if (cachedBlob) {
      URL.revokeObjectURL(cachedBlob);
      blobUrlCache.delete(photo.driveFileId);
    }
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
    await setPublicLinkPermission(token, fileId).catch((e) => {
      console.warn('[photoStore] public-link setup failed on avatar upload', {
        photoId,
        fileId,
        error: e,
      });
    });

    try {
      const now = new Date().toISOString();
      changeDoc((doc: FamilyDocument) => {
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
        doc.photos[photoId] = record;
      }, `photos: add avatar ${photoId}`);
    } catch (writeErr) {
      try {
        await deleteFile(token, fileId);
      } catch (deleteErr) {
        console.warn('[photoStore] Avatar rollback delete failed', deleteErr);
      }
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
    await setPublicLinkPermission(token, newDriveFileId).catch((e) => {
      console.warn('[photoStore] public-link setup failed on replace', {
        photoId,
        fileId: newDriveFileId,
        error: e,
      });
    });

    const previousDriveFileId = existing.driveFileId;
    changeDoc((doc: FamilyDocument) => {
      const record = doc.photos[photoId];
      if (!record) return;
      record.driveFileId = newDriveFileId;
      record.mime = compressed.mime;
      record.width = compressed.width;
      record.height = compressed.height;
      record.sizeBytes = compressed.blob.size;
      record.updatedAt = new Date().toISOString();
    }, `photos: replace ${photoId}`);

    thumbUrlCache.delete(previousDriveFileId);
    thumbUrlCache.delete(newDriveFileId);
    unresolvedIds.value.delete(photoId);
    triggerRef(unresolvedIds);

    // Best-effort: clean up the previous Drive file. If it was already
    // missing (unresolved), this will 404 harmlessly.
    if (previousDriveFileId) {
      try {
        await deleteFile(token, previousDriveFileId);
      } catch (e) {
        if (!(e instanceof DriveFileNotFoundError)) {
          console.warn('[photoStore] Could not delete previous Drive file', e);
        }
      }
    }
  }

  function markDeleted(photoId: UUID): void {
    const photo = photos.value[photoId];
    if (!photo) return;
    changeDoc((doc: FamilyDocument) => {
      const record = doc.photos[photoId];
      if (!record) return;
      record.deletedAt = new Date().toISOString();
      record.updatedAt = record.deletedAt;
    }, `photos: tombstone ${photoId}`);
  }

  // --- Garbage collection ---------------------------------------------

  async function gcOrphans(): Promise<{ scanned: number; deleted: number }> {
    const doc = getDoc();
    const all = Object.values(doc.photos ?? {});
    const now = Date.now();
    const toDelete: PhotoAttachment[] = [];
    const referenced = collectReferencedPhotoIds(doc);

    for (const photo of all) {
      const tombstoneExpired =
        photo.deletedAt && now - Date.parse(photo.deletedAt) > TOMBSTONE_GRACE_MS;
      const orphaned = photoReferringCollections.size > 0 && !referenced.has(photo.id);
      if (tombstoneExpired || orphaned) toDelete.push(photo);
    }

    if (toDelete.length === 0) return { scanned: all.length, deleted: 0 };

    const token = await requestAccessToken().catch(() => null);
    for (const photo of toDelete) {
      if (token) {
        try {
          await deleteFile(token, photo.driveFileId);
        } catch (e) {
          if (!(e instanceof DriveFileNotFoundError)) {
            console.warn('[photoStore] gc: Drive delete failed', photo.id, e);
            // Don't drop the Automerge record — retry next sweep.
            continue;
          }
        }
      }
      changeDoc((d: FamilyDocument) => {
        delete d.photos[photo.id];
      }, `photos: gc ${photo.id}`);
      thumbUrlCache.delete(photo.driveFileId);
      unresolvedIds.value.delete(photo.id);
    }

    triggerRef(unresolvedIds);
    return { scanned: all.length, deleted: toDelete.length };
  }

  function collectReferencedPhotoIds(doc: FamilyDocument): Set<UUID> {
    const ids = new Set<UUID>();
    for (const collection of photoReferringCollections) {
      // Scan both shapes in one pass:
      //   - `photoIds?: UUID[]` (e.g. activities, recipes, medications)
      //   - `avatarPhotoId?: UUID` scalar (family-member avatars)
      // Entities that only have one field are fine — the missing field is
      // undefined and contributes nothing.
      const entities = (
        doc as unknown as Record<
          string,
          Record<string, { photoIds?: UUID[]; avatarPhotoId?: UUID }>
        >
      )[collection];
      if (!entities) continue;
      for (const entity of Object.values(entities)) {
        for (const pid of entity?.photoIds ?? []) ids.add(pid);
        if (entity?.avatarPhotoId) ids.add(entity.avatarPhotoId);
      }
    }
    return ids;
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

  // --- Helpers ---------------------------------------------------------

  function attachPhotoToEntity(
    doc: FamilyDocument,
    entityCollection: string,
    entityId: string,
    photoId: UUID
  ): void {
    const entities = (doc as unknown as Record<string, Record<string, { photoIds?: UUID[] }>>)[
      entityCollection
    ];
    if (!entities) return;
    const entity = entities[entityId];
    if (!entity) return;
    entity.photoIds = [...(entity.photoIds ?? []), photoId];
  }

  return {
    // state (computed)
    photos,
    photosEnabled,
    pendingUploads,
    // lifecycle
    activate,
    deactivate,
    // actions
    addPhoto,
    addAvatarPhoto,
    getImageUrl,
    getBlobUrl,
    isUnresolved,
    markUnresolved,
    getPublicUrl,
    invalidateThumbCache,
    replacePhotoFile,
    markDeleted,
    gcOrphans,
    resolveCanonicalFolderId,
    pendingUploadsFor,
    refreshPending,
    // constants
    QUEUE_SOFT_CAP,
  };
});

// Exported for tests only.
export const __internals = {
  registerPhotoCollection,
  photoReferringCollections,
};
