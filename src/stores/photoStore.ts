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
  getFileMetadata,
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

  // Reactive state
  const unresolvedIds = ref<Set<string>>(new Set());
  const canonicalFolderId = ref<string | null>(null);
  /**
   * Pending uploads cached in memory so UI can reactively observe what's
   * queued for each entity. `shallowRef` because the array identity changes
   * on every refresh — we don't need deep reactivity on QueuedPhotoUpload.
   */
  const pendingUploads = shallowRef<QueuedPhotoUpload[]>([]);
  /** thumbnailLink URL cache, keyed by driveFileId. */
  const thumbUrlCache = new Map<string, { url: string; fetchedAt: number }>();

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
    thumbUrlCache.clear();
    pendingUploads.value = [];
  }

  // --- Canonical folder resolution -------------------------------------

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
    const folderId = await resolveCanonicalFolderId();
    const token = await requestAccessToken();
    const { fileId } = await createFile(
      token,
      folderId,
      payload.filename,
      payload.blob,
      payload.mime
    );

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
   * Reactive runtime flag. Set when a Drive fetch returns 404/403; cleared
   * when a replace or fresh lookup succeeds.
   */
  function isUnresolved(photoId: UUID): boolean {
    return unresolvedIds.value.has(photoId);
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

  // --- Replace / delete ------------------------------------------------

  async function replacePhotoFile(photoId: UUID, newFile: File): Promise<void> {
    const existing = photos.value[photoId];
    if (!existing) throw new Error(`photoStore.replacePhotoFile: unknown photo ${photoId}`);
    if (!photosEnabled.value) {
      throw new Error('photoStore.replacePhotoFile: cloud sync is required.');
    }

    const compressed = await compress(newFile);
    const folderId = await resolveCanonicalFolderId();
    const token = await requestAccessToken();
    const filename = `beanies-photo-${photoId}.jpg`;
    const { fileId: newDriveFileId } = await createFile(
      token,
      folderId,
      filename,
      compressed.blob,
      compressed.mime
    );

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
      const entities = (doc as unknown as Record<string, Record<string, { photoIds?: UUID[] }>>)[
        collection
      ];
      if (!entities) continue;
      for (const entity of Object.values(entities)) {
        for (const pid of entity?.photoIds ?? []) ids.add(pid);
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
    getImageUrl,
    isUnresolved,
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
