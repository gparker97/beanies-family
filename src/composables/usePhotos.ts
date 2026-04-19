/**
 * Entity-agnostic photo attachment composable.
 *
 * Wraps photoStore + validates max-count / mime / size for any entity that
 * has a `photoIds?: UUID[]` field. Views pass the entity's collection
 * name, id, and current photoIds; the composable returns a reactive list
 * of attached photos (merged with in-flight queued uploads) plus
 * `add` / `remove` actions.
 *
 * Usage:
 *   const { photos, pending, add, remove, canAdd, atCap } = usePhotos({
 *     collection: 'activities',
 *     entityId: computed(() => props.activity.id),
 *     photoIds: computed(() => props.activity.photoIds ?? []),
 *   });
 */
import { computed, type ComputedRef, type Ref, unref } from 'vue';
import { usePhotoStore } from '@/stores/photoStore';
import { useToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import type { PhotoAttachment, UUID } from '@/types/models';
import type { QueuedPhotoUpload } from '@/services/sync/photoUploadQueue';

export const MAX_PHOTOS_PER_SET = 4;
const ACCEPTED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export interface UsePhotosOptions {
  /** The Automerge collection name the entity lives in, e.g. 'activities'. */
  collection: string;
  /** The entity's UUID. May be reactive. */
  entityId: Ref<UUID> | ComputedRef<UUID> | UUID;
  /** The entity's current `photoIds` array. May be reactive. */
  photoIds: Ref<UUID[]> | ComputedRef<UUID[]> | UUID[];
  /** Who is attaching (for `PhotoAttachment.createdBy`). */
  currentMemberId?: Ref<UUID | undefined> | ComputedRef<UUID | undefined> | UUID | undefined;
  /**
   * Called when the entity's photoIds should change (new IDs appended on add,
   * specific ID removed on remove). Integration plans pass the entity store's
   * update function here, e.g. `(ids) => activityStore.update(entity.id, { photoIds: ids })`.
   */
  updatePhotoIds: (ids: UUID[]) => void;
  /**
   * Per-entity cap override. Defaults to MAX_PHOTOS_PER_SET (4).
   * Medication bottles and cook-log dish snaps pass `max: 1`.
   * Avatar uploads bypass this composable entirely via a dedicated
   * `photoStore.addAvatarPhoto` path (different compression profile).
   */
  max?: number;
}

export interface UsePhotosReturn {
  /** Photos attached to this entity (tombstones filtered out). */
  photos: ComputedRef<PhotoAttachment[]>;
  /** Queued uploads for this entity that haven't finished yet. */
  pending: ComputedRef<QueuedPhotoUpload[]>;
  /** Whether more photos can be added right now (count under cap + cloud on). */
  canAdd: ComputedRef<boolean>;
  /** True when the set is full (helps the UI disable the add control). */
  atCap: ComputedRef<boolean>;
  /** Attach one or more files (files come from useFilePicker / useFileDrop). */
  add: (files: File[]) => Promise<UUID[]>;
  /** Mark a photo deleted (tombstone) and drop its reference from this entity. */
  remove: (photoId: UUID) => void;
}

export function usePhotos(options: UsePhotosOptions): UsePhotosReturn {
  const store = usePhotoStore();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const photos = computed<PhotoAttachment[]>(() => {
    const ids = unref(options.photoIds) ?? [];
    const byId = store.photos;
    return ids.map((id) => byId[id]).filter((p): p is PhotoAttachment => !!p && !p.deletedAt);
  });

  const pending = computed<QueuedPhotoUpload[]>(() => {
    return store.pendingUploadsFor(options.collection, unref(options.entityId));
  });

  const max = computed(() => options.max ?? MAX_PHOTOS_PER_SET);

  // Use the raw photoIds length (not resolved photo count) so the cap
  // logic counts "slots the user has filled" consistently — even for IDs
  // whose Automerge record hasn't synced yet.
  const totalCount = computed(() => (unref(options.photoIds) ?? []).length + pending.value.length);
  const atCap = computed(() => totalCount.value >= max.value);
  const canAdd = computed(() => store.photosEnabled && !atCap.value);

  async function add(files: File[]): Promise<UUID[]> {
    if (!store.photosEnabled) {
      showToast('warning', t('photos.cloudRequired'));
      return [];
    }
    const remainingSlots = max.value - totalCount.value;
    if (remainingSlots <= 0) {
      showToast('info', t('photos.maxReached'));
      return [];
    }

    const accepted: File[] = [];
    const rejected: File[] = [];
    for (const file of files) {
      if (ACCEPTED_MIMES.includes(file.type) || file.name.match(/\.(jpe?g|png|webp|heic|heif)$/i)) {
        accepted.push(file);
      } else {
        rejected.push(file);
      }
      if (accepted.length >= remainingSlots) break;
    }

    if (rejected.length > 0) showToast('warning', t('photos.invalidType'));

    const createdBy = unref(options.currentMemberId);
    const entityId = unref(options.entityId);
    const wasOffline = !navigator.onLine;
    const ids: UUID[] = [];
    for (const file of accepted) {
      try {
        const id = await store.addPhoto(file, options.collection, entityId, createdBy);
        ids.push(id);
      } catch (e) {
        console.warn('[usePhotos] addPhoto failed', e);
        showToast('error', t('photos.uploadFailed'));
      }
    }

    // Online uploads already appended to entity.photoIds via photoStore's
    // `attachPhotoToEntity`. Offline uploads skip that step (no Automerge
    // record is written until flush), so the entity doesn't need to change
    // for the tile to appear — the UI renders the queue entry via `pending`.
    // No updatePhotoIds call needed on add.

    if (wasOffline && ids.length > 0) {
      showToast('info', t('photos.queuedOffline'));
      if (totalCount.value + ids.length >= store.QUEUE_SOFT_CAP) {
        showToast('warning', t('photos.queueAtCap'));
      }
    }

    return ids;
  }

  function remove(photoId: UUID): void {
    // Tombstone the photo AND drop it from this entity's photoIds so the
    // tile disappears immediately (the 24h GC grace handles the final
    // Drive + Automerge cleanup).
    store.markDeleted(photoId);
    const currentIds = unref(options.photoIds) ?? [];
    options.updatePhotoIds(currentIds.filter((id) => id !== photoId));
  }

  return { photos, pending, canAdd, atCap, add, remove };
}
