import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DeletionTombstone, EntityType } from '@/types/models';
import { toISODateString } from '@/utils/date';

/**
 * In-memory store for deletion tombstones.
 * Tombstones track which records were deleted so that the merge algorithm
 * can propagate deletions across devices instead of re-adding them.
 *
 * Tombstones are persisted only inside the .beanpod sync file (not in IndexedDB).
 * On load, they are hydrated from the file; on save, they are included in the export.
 */
export const useTombstoneStore = defineStore('tombstones', () => {
  const tombstones = ref<DeletionTombstone[]>([]);

  /**
   * Record a deletion. Called by entity stores after a successful delete.
   */
  function recordDeletion(entityType: EntityType, id: string): void {
    // Avoid duplicates
    if (tombstones.value.some((t) => t.id === id && t.entityType === entityType)) return;
    tombstones.value.push({
      id,
      entityType,
      deletedAt: toISODateString(new Date()),
    });
  }

  /**
   * Get all tombstones (for export into sync file).
   */
  function getTombstones(): DeletionTombstone[] {
    return tombstones.value;
  }

  /**
   * Replace all tombstones (after merge or load from file).
   */
  function setTombstones(ts: DeletionTombstone[]): void {
    tombstones.value = ts;
  }

  /**
   * Clear all tombstones (on sign-out).
   */
  function resetState(): void {
    tombstones.value = [];
  }

  return {
    tombstones,
    recordDeletion,
    getTombstones,
    setTombstones,
    resetState,
  };
});
