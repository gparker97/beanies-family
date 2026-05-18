/**
 * Optimistic photoIds binding for any entity that owns photos.
 *
 * Wraps the local `photoIds` ref + the optimistic-update + rollback +
 * user-facing toast for the every entity that has a `photoIds?: UUID[]`
 * field. Replaces the per-modal `void store.update(id, { photoIds })`
 * pattern, which today silently loses photos when the store-side
 * update rejects after an upload has already succeeded — the photo
 * lands on Drive but never gets pinned to the entity, then the next
 * GC sweep deletes the orphan and the user's photo is gone with no
 * indication anything went wrong.
 *
 * Used by milestones, medications, recipes, cookLogs, and now activities.
 *
 * Usage:
 * ```ts
 * const { photoIds, updatePhotoIds } = usePhotoEntityBinding({
 *   entityId: eager.entityId,                          // ComputedRef from useEagerEntityCreate
 *   initialPhotoIds: () => props.activity?.photoIds,
 *   watchSource: () => props.activity?.id,
 *   update: activityStore.updateActivity,
 *   surface: 'ActivityModal',
 * });
 * ```
 */
import { ref, watch, type Ref } from 'vue';
import type { UUID } from '@/types/models';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';

export interface PhotoEntityBindingOptions {
  /**
   * Reactive entity id — pass the eager-create composable's `entityId`
   * directly, or a `computed(() => props.entity?.id ?? null)` for
   * edit-only modals.
   */
  entityId: Readonly<Ref<UUID | null>>;
  /** Source of truth for the entity's persisted photoIds (e.g. props.entity?.photoIds). */
  initialPhotoIds: () => UUID[] | undefined;
  /**
   * Reactive source to watch for prop swaps (e.g. `() => props.entity?.id`).
   * When this changes, local photoIds is re-synced from `initialPhotoIds()`.
   */
  watchSource: () => unknown;
  /**
   * Store-side update for the entity. Must accept `{ photoIds }`.
   * Returning null/undefined indicates failure (the store's wrapAsync
   * has already reported it to errorReporter); this composable then
   * rolls back the optimistic update and toasts the user.
   */
  update: (id: UUID, patch: { photoIds: UUID[] }) => Promise<unknown | null>;
  /**
   * Telemetry tag for `reportError` (kebab-case, e.g. 'activity-modal').
   * Used only for the should-never-happen "no entity id" defensive branch.
   */
  surface: string;
}

/**
 * Shallow content equality for UUID arrays. Avoids spurious re-renders when
 * the source emits a fresh array reference with the same content.
 */
function sameContent(a: readonly UUID[], b: readonly UUID[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function usePhotoEntityBinding(opts: PhotoEntityBindingOptions) {
  const { t } = useTranslation();
  const photoIds = ref<UUID[]>(opts.initialPhotoIds() ?? []);

  /**
   * Counter of in-flight `updatePhotoIds` awaits. While > 0, the deep watch
   * on `initialPhotoIds` skips its re-sync so we don't clobber an active
   * optimistic snapshot. Resolved ops re-sync from source one more time on
   * the way out to catch any background changes that arrived mid-await.
   */
  let pendingOps = 0;

  /**
   * Prop-swap re-sync — the entity itself changed (e.g. modal was re-bound
   * to a different activity). Pull fresh photoIds from the new source.
   */
  watch(opts.watchSource, () => {
    photoIds.value = opts.initialPhotoIds() ?? [];
  });

  /**
   * Background re-sync — the entity's photoIds changed in the doc while
   * this binding was alive (e.g. a long-running photo upload completed
   * after the modal's drawer closed; BaseSidePanel's v-if unmounted the
   * slot, so PhotoAttachments couldn't emit `update:photo-ids` back here;
   * but `photoStore.attachPhotoToEntity` already wrote the photoId into
   * `entity.photoIds` directly). Without this watch, the binding's local
   * ref stays stale until a full page refresh.
   *
   * Suppressed during in-flight optimistic ops (pendingOps > 0). The
   * finally-block in `updatePhotoIds` re-syncs once on the way out so
   * we don't lose background changes that landed mid-await.
   *
   * Caught 2026-05-18 from greg's repro: add photo → close drawer mid-
   * upload → reopen → photo not visible until refresh.
   */
  watch(
    () => opts.initialPhotoIds(),
    (newIds) => {
      if (pendingOps > 0) return;
      const next = newIds ?? [];
      if (sameContent(photoIds.value, next)) return;
      photoIds.value = [...next];
    },
    { deep: true }
  );

  async function updatePhotoIds(ids: UUID[]): Promise<void> {
    const id = opts.entityId.value;
    if (!id) {
      // Defensive: every consumer's UI gates the photo block on entityId
      // existing, so this is "should never happen". Report so we catch
      // it in prod via #beanies-errors instead of silently dropping.
      reportError({
        surface: opts.surface,
        message: 'updatePhotoIds called without an entity id',
        context: { action: 'updatePhotoIds' },
      });
      return;
    }

    pendingOps++;
    const previous = photoIds.value;
    // Snapshot the source at op-start so we can detect concurrent background
    // changes that arrived while the deep watch was suppressed.
    const sourceAtStart = opts.initialPhotoIds() ?? [];
    photoIds.value = ids; // optimistic — render new tile immediately

    try {
      const result = await opts.update(id, { photoIds: ids });
      if (result === null || result === undefined) {
        // Store-level error already in errorReporter via wrapAsync.
        // Without this toast the user sees a "saved" photo that orphans
        // in Drive on next reload. showToast('error') re-fires the
        // reporter with our surface tag for support context.
        photoIds.value = previous;
        showToast('error', t('photos.linkFailed.title'), t('photos.linkFailed.body'), {
          surface: opts.surface,
          context: { action: 'updatePhotoIds' },
        });
      }
    } finally {
      pendingOps--;
      // After the last in-flight op resolves, catch any background change
      // to the source that landed during the await (the deep watch was
      // suppressed during pendingOps > 0). Only re-sync if the source
      // ACTUALLY changed since op-start — otherwise we'd clobber the
      // persisted optimistic value when the source's reactive reflection
      // is delayed (e.g. tests that don't propagate update() to the source).
      if (pendingOps === 0) {
        const sourceNow = opts.initialPhotoIds() ?? [];
        if (!sameContent(sourceAtStart, sourceNow)) {
          photoIds.value = [...sourceNow];
        }
      }
    }
  }

  return { photoIds, updatePhotoIds };
}
