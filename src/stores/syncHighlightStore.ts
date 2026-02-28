import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useFamilyStore } from './familyStore';
import { useGoalsStore } from './goalsStore';
import { useRecurringStore } from './recurringStore';
import { useTodoStore } from './todoStore';
import { useTransactionsStore } from './transactionsStore';

const HIGHLIGHT_DURATION_MS = 3000;

export const useSyncHighlightStore = defineStore('syncHighlight', () => {
  // Snapshot of id → updatedAt taken before a cross-device reload
  let snapshot = new Map<string, string>();

  // Sets of IDs that appeared/changed in the most recent sync
  const newItemIds = ref(new Set<string>());
  const modifiedItemIds = ref(new Set<string>());

  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Capture a flat id → updatedAt map from all entity stores.
   * Called just before reloadAllStores() during a cross-device sync.
   */
  function snapshotBeforeReload(): void {
    const map = new Map<string, string>();

    const stores = [
      useFamilyStore().members,
      useAccountsStore().accounts,
      useTransactionsStore().transactions,
      useAssetsStore().assets,
      useGoalsStore().goals,
      useRecurringStore().recurringItems,
      useTodoStore().todos,
    ];

    for (const items of stores) {
      for (const item of items) {
        map.set(item.id, item.updatedAt);
      }
    }

    snapshot = map;
  }

  /**
   * Compare post-reload state against the snapshot.
   * New IDs → newItemIds set. Changed updatedAt → modifiedItemIds set.
   * Merges with any still-active highlights from rapid consecutive syncs.
   */
  function detectChanges(): void {
    const stores = [
      useFamilyStore().members,
      useAccountsStore().accounts,
      useTransactionsStore().transactions,
      useAssetsStore().assets,
      useGoalsStore().goals,
      useRecurringStore().recurringItems,
      useTodoStore().todos,
    ];

    // Merge with existing highlights (rapid consecutive syncs)
    const nextNew = new Set(newItemIds.value);
    const nextModified = new Set(modifiedItemIds.value);

    for (const items of stores) {
      for (const item of items) {
        const prev = snapshot.get(item.id);
        if (prev === undefined) {
          nextNew.add(item.id);
        } else if (prev !== item.updatedAt) {
          nextModified.add(item.id);
        }
      }
    }

    newItemIds.value = nextNew;
    modifiedItemIds.value = nextModified;

    // Reset snapshot — no longer needed
    snapshot = new Map();

    // Restart expiry timer
    scheduleExpiry();
  }

  function scheduleExpiry(): void {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      newItemIds.value = new Set();
      modifiedItemIds.value = new Set();
      expiryTimer = null;
    }, HIGHLIGHT_DURATION_MS);
  }

  function isNewFromSync(id: string): boolean {
    return newItemIds.value.has(id);
  }

  function isModifiedFromSync(id: string): boolean {
    return modifiedItemIds.value.has(id);
  }

  function clearHighlights(): void {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    newItemIds.value = new Set();
    modifiedItemIds.value = new Set();
    snapshot = new Map();
  }

  return {
    newItemIds,
    modifiedItemIds,
    snapshotBeforeReload,
    detectChanges,
    isNewFromSync,
    isModifiedFromSync,
    clearHighlights,
  };
});
