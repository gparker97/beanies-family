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
import { computed, ref, type ComputedRef, type Ref, unref } from 'vue';
import { usePhotoStore, QueueWriteFailedError } from '@/stores/photoStore';
import { useToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import type { PhotoAttachment, UUID } from '@/types/models';
import type { QueuedPhotoUpload } from '@/services/sync/photoUploadQueue';
import { track } from '@/services/analytics/plausible';

export const MAX_PHOTOS_PER_SET = 4;
const ACCEPTED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** PDFs aren't compressed (stored raw), so cap their size. Booking docs are
 *  comfortably under this; oversized ones get a distinct toast. */
export const PDF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Cheap content sniff: look for the `%PDF-` signature within the first 1KB
 *  (tolerates a few leading bytes some generators prepend). Guards against a
 *  non-PDF renamed `.pdf` slipping into Drive. Byte-compared (no TextDecoder
 *  encoding-label pitfalls). */
async function looksLikePdf(file: File): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const sig = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
    outer: for (let i = 0; i + sig.length <= bytes.length; i++) {
      for (let j = 0; j < sig.length; j++) {
        if (bytes[i + j] !== sig[j]) continue outer;
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

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
  /**
   * Which file kinds this surface accepts. `'images'` (default) keeps the
   * original image-only behavior; `'imagesAndPdf'` also accepts PDFs (the
   * travel booking-documents surface). Images are always compressed; PDFs
   * are validated here (size + `%PDF` magic-byte) and stored raw.
   */
  accept?: 'images' | 'imagesAndPdf';
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
  /**
   * Number of in-flight online uploads from this composable instance.
   * UI surfaces render a spinner tile per in-flight upload so the user
   * sees feedback during the compress + Drive round-trip (2–5s).
   */
  uploading: Ref<number>;
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
  const uploading = ref(0);

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
      // Match the inline hint's copy — singular for max=1, interpolated
      // "up to N" otherwise. Same strings as PhotoAttachments.
      const msg =
        max.value === 1
          ? t('photos.maxReached.one')
          : t('photos.maxReached.n').replace('{n}', String(max.value));
      showToast('info', msg);
      return [];
    }

    const allowPdf = options.accept === 'imagesAndPdf';
    const accepted: File[] = [];
    const rejectedType: File[] = []; // wrong type / mislabeled
    const rejectedOversize: File[] = []; // PDF over the size cap
    for (const file of files) {
      const isImage =
        ACCEPTED_MIMES.includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
      const isPdfCandidate =
        allowPdf && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
      if (isImage) {
        accepted.push(file);
      } else if (isPdfCandidate) {
        // Read bytes only for PDF candidates — images skip this latency.
        if (file.size > PDF_MAX_BYTES) {
          rejectedOversize.push(file);
        } else if (!(await looksLikePdf(file))) {
          rejectedType.push(file); // not actually a PDF
        } else {
          accepted.push(file);
        }
      } else {
        rejectedType.push(file);
      }
      if (accepted.length >= remainingSlots) break;
    }

    if (rejectedType.length > 0) showToast('warning', t('photos.invalidType'));
    if (rejectedOversize.length > 0) showToast('warning', t('photos.pdfTooLarge'));

    const createdBy = unref(options.currentMemberId);
    const entityId = unref(options.entityId);
    const completedIds: UUID[] = [];
    const queuedIds: UUID[] = [];
    // Bump the in-flight counter once per accepted file BEFORE any
    // awaits so the UI spinner tiles render immediately. Decrement
    // happens per file in the loop below regardless of success.
    uploading.value += accepted.length;
    for (const file of accepted) {
      try {
        const result = await store.addPhoto(file, options.collection, entityId, createdBy);
        // #71: adoption is counted HERE, at the user-initiated caller, rather
        // than inside `photoStore.addPhoto` — the store action throws on failure
        // and is reachable from non-user paths.
        track('feature_used', { props: { feature: 'photo' } });
        if (result.status === 'completed') {
          completedIds.push(result.photoId);
        } else {
          queuedIds.push(result.photoId);
        }
      } catch (e) {
        // Promoted to console.error (was warn): a user-impacting upload
        // failure deserves error-level logging alongside the toast.
        console.error('[usePhotos] addPhoto failed:', e);
        const errorContext = {
          surface: 'usePhotos.add',
          context: {
            underlying_error: String(e),
            entity_collection: options.collection,
            file_mime: file.type,
            file_size: file.size,
          },
        };
        if (e instanceof QueueWriteFailedError) {
          // Drive failed AND the queue couldn't save the upload for later —
          // photo is genuinely lost. Distinct copy from the generic failure
          // so users know "we couldn't even keep it for retry" vs a transient
          // upload error that may succeed on retry.
          showToast('error', t('photos.queueFailed'), undefined, errorContext);
        } else {
          showToast('error', t('photos.uploadFailed'), undefined, errorContext);
        }
      } finally {
        uploading.value = Math.max(0, uploading.value - 1);
      }
    }

    // Completed uploads are appended to entity.photoIds inside photoStore
    // via `attachPhotoToEntity`, which keeps the Automerge doc itself
    // correct. But the form modals that host this composable keep their
    // own local `photoIds` ref (so the Save handler knows what to
    // persist), and that ref needs to see the new id too — otherwise
    // the just-uploaded photo doesn't render in the drawer until the
    // user closes and reopens it. Emit the refreshed ids back to the
    // caller whenever at least one completed upload succeeded. Queued
    // uploads skip this (no Automerge record yet — queue entry renders
    // via `pending` instead).
    if (completedIds.length > 0) {
      const currentIds = unref(options.photoIds) ?? [];
      // De-dupe in case a caller round-trips this back to the doc.
      const merged = [...currentIds];
      for (const id of completedIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      options.updatePhotoIds(merged);
    }

    // Queued uploads (covers BOTH offline-original AND online-fallback paths
    // — same outcome from the user's POV). The `pending` reactive list
    // renders these as placeholder tiles; the queue flushes them when
    // conditions permit. One info toast covers both cases.
    if (queuedIds.length > 0) {
      showToast('info', t('photos.queuedOffline'));
      if (totalCount.value + queuedIds.length >= store.QUEUE_SOFT_CAP) {
        showToast('warning', t('photos.queueAtCap'));
      }
    }

    return [...completedIds, ...queuedIds];
  }

  function remove(photoId: UUID): void {
    // Tombstone the photo AND drop it from this entity's photoIds so the
    // tile disappears immediately (the 24h GC grace handles the final
    // Drive + Automerge cleanup).
    store.markDeleted(photoId);
    const currentIds = unref(options.photoIds) ?? [];
    options.updatePhotoIds(currentIds.filter((id) => id !== photoId));
  }

  return { photos, pending, canAdd, atCap, uploading, add, remove };
}
