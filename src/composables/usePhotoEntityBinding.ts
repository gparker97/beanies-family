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

export function usePhotoEntityBinding(opts: PhotoEntityBindingOptions) {
  const { t } = useTranslation();
  const photoIds = ref<UUID[]>(opts.initialPhotoIds() ?? []);

  watch(opts.watchSource, () => {
    photoIds.value = opts.initialPhotoIds() ?? [];
  });

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

    const previous = photoIds.value;
    photoIds.value = ids; // optimistic — render new tile immediately

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
  }

  return { photoIds, updatePhotoIds };
}
