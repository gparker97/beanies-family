import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { useToday } from '@/composables/useToday';
import { isDocLoaded } from '@/services/automerge/docService';
import * as listRepo from '@/services/automerge/repositories/listRepository';
import { computeRecurringReset, isDueSoon, isFiled, isRecurring } from '@/utils/listLifecycle';
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
  ListLifecycle,
} from '@/types/models';

// Sort comparators — newest-created first / most-recently-completed first
// (same shapes todoStore uses).
const byCreatedDesc = (a: FamilyList, b: FamilyList) => b.createdAt.localeCompare(a.createdAt);
const byCompletedDesc = (a: FamilyList, b: FamilyList) =>
  (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);

/**
 * Derive the list-level completion/filing keys that must change so a list's
 * completion state stays consistent with `items`. The single source of truth
 * for "did this list newly complete / un-complete", shared by
 * `toggleItem`/`addItem`/`removeItem`.
 *
 *  - one-off: file on the transition into all-done (guard: `!list.completed`),
 *    un-file when no longer all-done. `byMemberId` stamps `completedBy`; omit it
 *    on actor-less paths (item removal) — the list still files (leaves the active
 *    shelf) but with no `completedBy`, so no "finished by" notification fires.
 *  - recurring: mark `cycleCelebrated` on the transition into all-done (once).
 *    NEVER cleared here — clearing `cycleCelebrated` is a per-caller concern (a
 *    new cycle in `reconcileRecurringLists`, or new work added in `addItem`),
 *    so toggling an item off does NOT re-arm the celebration (once per cycle).
 *
 * Returns the patch (EMPTY when nothing changed — callers merge `items`
 * themselves) plus whether this was a real completion transition worth a
 * celebration (only `toggleItem` reads `shouldCelebrate`).
 */
function deriveCompletion(
  list: FamilyList,
  items: FamilyListItem[],
  byMemberId?: string
): { patch: UpdateFamilyListInput; shouldCelebrate: boolean } {
  const allDone = items.length > 0 && items.every((i) => i.completed);
  const patch: UpdateFamilyListInput = {};
  let shouldCelebrate = false;

  if (isRecurring(list)) {
    if (allDone && !list.cycleCelebrated) {
      patch.cycleCelebrated = true;
      shouldCelebrate = true;
    }
  } else if (allDone && !list.completed) {
    patch.completed = true;
    patch.completedBy = byMemberId;
    patch.completedAt = toISODateString(new Date());
    shouldCelebrate = true;
  } else if (!allDone && list.completed) {
    patch.completed = false;
    patch.completedBy = undefined;
    patch.completedAt = undefined;
  }
  return { patch, shouldCelebrate };
}

/**
 * Beanie Lists store (#33) — mirrors `todoStore`: same state triple, the same
 * `wrapAsync` error discipline (toast + `reportError`, returns result-or-null),
 * `createMemberFiltered` for the global member filter, and the shared
 * `celebrate('goal-reached')` on completion. All lifecycle-conditional reads go
 * through `@/utils/listLifecycle` predicates — never inline `lifecycle === …`.
 *
 * Write invariants: list-level completion/filing is derived ONLY via
 * `deriveCompletion` (from `toggleItem`/`addItem`/`removeItem`); recurrence reset
 * lives ONLY in `reconcileRecurringLists`; the lifecycle flip (which clears the
 * completion triple) lives ONLY in `setLifecycle`. No other action mutates
 * `completed`/`completedBy`/`completedAt`/`lastResetDate`/`cycleCelebrated`.
 */
export const useListStore = defineStore('lists', () => {
  // State
  const lists = ref<FamilyList[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const { today } = useToday();

  // ========== GETTERS ==========

  // Every display getter honors the global member filter (single owner → scalar
  // id; `createMemberFiltered` treats a no-id as always-included and returns the
  // full set when the filter is 'all', so default behavior is unchanged). The
  // Lists page reads these the same way To-Dos/Activities read their filtered
  // getters, so selecting a member narrows /lists identically.
  const filteredLists = createMemberFiltered(lists, (l) => l.ownerId);

  const activeLists = computed(() =>
    filteredLists.value.filter((l) => !isFiled(l)).sort(byCreatedDesc)
  );
  const completedLists = computed(() =>
    filteredLists.value.filter((l) => isFiled(l)).sort(byCompletedDesc)
  );

  /** Active lists that are due today or overdue (built on the shared predicate). */
  const dueSoonLists = computed(() => activeLists.value.filter((l) => isDueSoon(l, today.value)));

  /**
   * Count of lists overdue or due today, across ALL members — drives the nav
   * attention badge. Unfiltered (like the todo/goal/travel badges, which show
   * the whole family); recurring + future-dated lists are excluded by
   * `isDueSoon`, filed lists by `isFiled`. Reaches 0 when nothing's due.
   */
  const dueListsCount = computed(
    () => lists.value.filter((l) => !isFiled(l) && isDueSoon(l, today.value)).length
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

  // ========== ACTIONS ==========

  async function loadLists(): Promise<void> {
    // No-op when the Automerge doc isn't loaded yet (e.g. a page mounts during
    // a Drive reconnect, before the central load sequence runs). Reading the
    // collection would throw "No Automerge document loaded" and surface a
    // spurious red toast. The central load re-runs loadLists once the doc is
    // ready. Matches the isDocLoaded() guard in notifications/overlap stores.
    if (!isDocLoaded()) return;
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

    // Completion/filing is derived in one place (shared with add/remove).
    const { patch: completion, shouldCelebrate } = deriveCompletion(list, items, byMemberId);
    const updated = await updateList(listId, { items, ...completion });
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

  /**
   * Add an open item. Adding new work re-opens the list: a filed one-off is
   * un-filed (via `deriveCompletion`), and a recurring list that was marked
   * done this cycle has `cycleCelebrated` cleared so finishing the new item
   * celebrates again (unlike toggling an existing item off, which is a
   * correction and keeps the once-per-cycle guard).
   */
  async function addItem(listId: string, title: string): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    const item: FamilyListItem = { id: generateUUID(), title, completed: false };
    const items = [...list.items, item];
    const { patch } = deriveCompletion(list, items);
    if (isRecurring(list) && list.cycleCelebrated) patch.cycleCelebrated = false;
    return updateList(listId, { items, ...patch });
  }

  /**
   * Remove an item, re-deriving completion (shared with toggle/add). Deleting the
   * last open item makes a one-off all-done, so it files (moves to Completed) —
   * but with NO `completedBy` (no acting member on a remove), so no "finished by"
   * notification fires and no celebration plays. `shouldCelebrate` is ignored.
   */
  async function removeItem(listId: string, itemId: string): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    const items = list.items.filter((i) => i.id !== itemId);
    const { patch } = deriveCompletion(list, items);
    return updateList(listId, { items, ...patch });
  }

  /**
   * Switch a list between one-off and recurring — the ONE place the lifecycle
   * flip lives. Always clears the completion triple (`completed`/`completedBy`/
   * `completedAt`) via explicit `undefined` so a stale completion can't leak
   * across the flip (a recurring list must never be filed; a one-off must
   * re-derive filing from its items), and sets/clears the recurrence fields.
   * Delegates to `updateList`, inheriting its `wrapAsync` toast + `reportError`.
   */
  async function setLifecycle(
    listId: string,
    lifecycle: ListLifecycle
  ): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    const cleared = { completed: undefined, completedBy: undefined, completedAt: undefined };
    const patch: UpdateFamilyListInput =
      lifecycle === 'recurring'
        ? {
            ...cleared,
            lifecycle: 'recurring',
            frequency: list.frequency ?? 'weekly',
            dueDate: undefined,
            lastResetDate: today.value,
            cycleCelebrated: false,
          }
        : {
            ...cleared,
            lifecycle: 'oneoff',
            frequency: undefined,
            lastResetDate: undefined,
            cycleCelebrated: undefined,
          };
    return updateList(listId, patch);
  }

  /**
   * Clear any list link to a now-deleted trip/activity, so the travel-page embed
   * simply stops rendering it (no orphan, no crash). Called from the
   * vacation/activity delete paths.
   */
  async function clearLinksFor(kind: 'trip' | 'activity', id: string): Promise<void> {
    for (const l of lists.value) {
      if (kind === 'trip' && l.linkedVacationId === id) {
        await updateList(l.id, { linkedVacationId: undefined });
      } else if (kind === 'activity' && l.linkedActivityId === id) {
        await updateList(l.id, { linkedActivityId: undefined });
      }
    }
  }

  /**
   * The ONE write path for "the clock advanced." Resets every recurring list
   * whose period has rolled over (uncheck all + bump `lastResetDate` + clear
   * `cycleCelebrated`). Idempotent and guarded against an empty set.
   */
  async function reconcileRecurringLists(): Promise<void> {
    if (!isDocLoaded() || !lists.value.length) return;
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
    // Getters (member-filtered, except dueListsCount which is whole-family)
    activeLists,
    completedLists,
    dueSoonLists,
    dueListsCount,
    listsByCategory,
    // Actions
    loadLists,
    createList,
    createFromTemplate,
    updateList,
    deleteList,
    toggleItem,
    addItem,
    removeItem,
    setLifecycle,
    clearLinksFor,
    reconcileRecurringLists,
    resetState,
  };
});
