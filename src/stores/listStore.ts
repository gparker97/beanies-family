import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { useToday } from '@/composables/useToday';
import * as listRepo from '@/services/automerge/repositories/listRepository';
import { computeRecurringReset, isFiled, isListDue, isRecurring } from '@/utils/listLifecycle';
import { getListTemplateByKey } from '@/constants/listTemplates';
import { useTranslationStore } from '@/stores/translationStore';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import type {
  FamilyList,
  FamilyListItem,
  CreateFamilyListInput,
  UpdateFamilyListInput,
  ListCategory,
} from '@/types/models';

// Sort comparators — newest-created first / most-recently-completed first
// (same shapes todoStore uses).
const byCreatedDesc = (a: FamilyList, b: FamilyList) => b.createdAt.localeCompare(a.createdAt);
const byCompletedDesc = (a: FamilyList, b: FamilyList) =>
  (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);

/**
 * Beanie Lists store (#33) — mirrors `todoStore`: same state triple, the same
 * `wrapAsync` error discipline (toast + `reportError`, returns result-or-null),
 * `createMemberFiltered` for the global member filter, and the shared
 * `celebrate('goal-reached')` on completion. All lifecycle-conditional reads go
 * through `@/utils/listLifecycle` predicates — never inline `lifecycle === …`.
 *
 * Two write invariants (Pass 3): completion/filing lives ONLY in `toggleItem`;
 * recurrence reset lives ONLY in `reconcileRecurringLists`. No other action
 * mutates `completed`/`lastResetDate`/`cycleCelebrated`.
 */
export const useListStore = defineStore('lists', () => {
  // State
  const lists = ref<FamilyList[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const { today } = useToday();

  // ========== GETTERS ==========

  const activeLists = computed(() => lists.value.filter((l) => !isFiled(l)).sort(byCreatedDesc));
  const completedLists = computed(() =>
    lists.value.filter((l) => isFiled(l)).sort(byCompletedDesc)
  );

  /** Active lists that are due today or overdue (built on the shared predicate). */
  const dueSoonLists = computed(() =>
    activeLists.value.filter((l) => {
      const due = isListDue(l, today.value);
      return due === 'overdue' || due === 'today';
    })
  );

  /** Active lists grouped by category (insertion order = active sort order). */
  const listsByCategory = computed(() => {
    const map = new Map<ListCategory, FamilyList[]>();
    for (const l of activeLists.value) {
      const arr = map.get(l.category) ?? [];
      arr.push(l);
      map.set(l.category, arr);
    }
    return map;
  });

  // Filtered by the global member filter (single owner → scalar id;
  // createMemberFiltered already treats a no-id as always-included).
  const filteredLists = createMemberFiltered(lists, (l) => l.ownerId);
  const filteredActiveLists = computed(() =>
    filteredLists.value.filter((l) => !isFiled(l)).sort(byCreatedDesc)
  );
  const filteredCompletedLists = computed(() =>
    filteredLists.value.filter((l) => isFiled(l)).sort(byCompletedDesc)
  );

  // ========== ACTIONS ==========

  async function loadLists(): Promise<void> {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        lists.value = await listRepo.getAllLists();
      },
      { action: 'listStore:loadLists' }
    );
    // Reconcile only AFTER the collection is populated, so a watcher race can't
    // run against an empty set. Idempotent — a same-day re-run is a no-op.
    await reconcileRecurringLists();
  }

  async function createList(input: CreateFamilyListInput): Promise<FamilyList | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const list = await listRepo.createList(input);
        lists.value = [...lists.value, list];
        return list;
      },
      { action: 'listStore:createList' }
    );
    return result ?? null;
  }

  /**
   * Seed a new list from a curated template. `memberId` becomes the creator and
   * the default owner (override `ownerId` via `overrides`). The template's name
   * is resolved to the current language at creation (then it's editable user
   * data); a recurring template stamps `lastResetDate` = today so its seeded
   * items aren't immediately reset.
   */
  async function createFromTemplate(
    key: string,
    memberId: string,
    overrides: Partial<CreateFamilyListInput> = {}
  ): Promise<FamilyList | null> {
    const tmpl = getListTemplateByKey(key);
    if (!tmpl) return null;
    const translate = useTranslationStore();
    const seed: CreateFamilyListInput = {
      title: translate.t(tmpl.nameKey),
      emoji: tmpl.icon,
      category: tmpl.category,
      ownerId: memberId,
      items: tmpl.starterItems.map((title) => ({ id: generateUUID(), title, completed: false })),
      lifecycle: tmpl.lifecycle,
      frequency: tmpl.frequency,
      lastResetDate: tmpl.lifecycle === 'recurring' ? today.value : undefined,
      cycleCelebrated: false,
      templateKey: tmpl.key,
      completed: false,
      createdBy: memberId,
      ...overrides,
    };
    return createList(seed);
  }

  async function updateList(id: string, input: UpdateFamilyListInput): Promise<FamilyList | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const updated = await listRepo.updateList(id, input);
        if (updated) {
          lists.value = lists.value.map((l) => (l.id === id ? updated : l));
        }
        return updated;
      },
      { action: 'listStore:updateList' }
    );
    return result ?? null;
  }

  async function deleteList(id: string): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const success = await listRepo.deleteList(id);
        if (success) {
          lists.value = lists.value.filter((l) => l.id !== id);
        }
        return success;
      },
      { action: 'listStore:deleteList' }
    );
    return result ?? false;
  }

  /**
   * The ONE write path for "an item changed." Toggling the last open item
   * closed triggers completion: a one-off list is filed (+ celebrate once); a
   * recurring list celebrates once per cycle (`cycleCelebrated` guard) but is
   * never filed. Un-checking an item on a filed one-off un-files it.
   */
  async function toggleItem(
    listId: string,
    itemId: string,
    byMemberId: string
  ): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;

    const now = toISODateString(new Date());
    const items: FamilyListItem[] = list.items.map((it) => {
      if (it.id !== itemId) return it;
      const completed = !it.completed;
      return {
        ...it,
        completed,
        completedBy: completed ? byMemberId : undefined,
        completedAt: completed ? now : undefined,
      };
    });

    const allDone = items.length > 0 && items.every((i) => i.completed);
    const patch: UpdateFamilyListInput = { items };

    // Celebrate only on the transition INTO all-done, and (recurring) only once
    // per cycle. Capture the decision before persisting.
    let shouldCelebrate = false;
    if (allDone) {
      if (!isRecurring(list)) {
        patch.completed = true;
        patch.completedBy = byMemberId;
        patch.completedAt = now;
        shouldCelebrate = true;
      } else if (!list.cycleCelebrated) {
        patch.cycleCelebrated = true;
        shouldCelebrate = true;
      }
    } else if (!isRecurring(list) && list.completed) {
      // A filed one-off had an item re-opened → un-file it.
      patch.completed = false;
      patch.completedBy = undefined;
      patch.completedAt = undefined;
    }

    const updated = await updateList(listId, patch);
    if (updated && shouldCelebrate) {
      const originalItems = list.items;
      const wasRecurring = isRecurring(list);
      celebrate('goal-reached', {
        onUndo: () => {
          void updateList(listId, {
            items: originalItems,
            completed: false,
            completedBy: undefined,
            completedAt: undefined,
            ...(wasRecurring ? { cycleCelebrated: false } : {}),
          });
        },
      });
    }
    return updated;
  }

  /** Add an open item. Adding an open item un-files a filed one-off list. */
  async function addItem(listId: string, title: string): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    const item: FamilyListItem = { id: generateUUID(), title, completed: false };
    const patch: UpdateFamilyListInput = { items: [...list.items, item] };
    if (!isRecurring(list) && list.completed) {
      patch.completed = false;
      patch.completedBy = undefined;
      patch.completedAt = undefined;
    }
    return updateList(listId, patch);
  }

  /** Remove an item. Completion is never derived here (lives only in toggleItem). */
  async function removeItem(listId: string, itemId: string): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    return updateList(listId, { items: list.items.filter((i) => i.id !== itemId) });
  }

  /**
   * The ONE write path for "the clock advanced." Resets every recurring list
   * whose period has rolled over (uncheck all + bump `lastResetDate` + clear
   * `cycleCelebrated`). Idempotent and guarded against an empty set.
   */
  async function reconcileRecurringLists(): Promise<void> {
    if (!lists.value.length) return;
    const todayStr = today.value;
    for (const list of lists.value) {
      if (!isRecurring(list)) continue;
      const { shouldReset, nextResetDate } = computeRecurringReset(list, todayStr);
      if (!shouldReset) continue;
      await updateList(list.id, {
        items: list.items.map((i) => ({
          ...i,
          completed: false,
          completedBy: undefined,
          completedAt: undefined,
        })),
        lastResetDate: nextResetDate,
        cycleCelebrated: false,
      });
    }
  }

  function resetState(): void {
    lists.value = [];
    isLoading.value = false;
    error.value = null;
  }

  // Reset recurring lists when the local day advances (PWA wake / midnight /
  // tab restore). Guarded against an empty set; idempotent on same-day re-runs.
  watch(today, () => {
    void reconcileRecurringLists();
  });

  return {
    // State
    lists,
    isLoading,
    error,
    // Getters
    activeLists,
    completedLists,
    dueSoonLists,
    listsByCategory,
    filteredLists,
    filteredActiveLists,
    filteredCompletedLists,
    // Actions
    loadLists,
    createList,
    createFromTemplate,
    updateList,
    deleteList,
    toggleItem,
    addItem,
    removeItem,
    reconcileRecurringLists,
    resetState,
  };
});
