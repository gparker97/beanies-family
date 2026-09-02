import { defineStore } from 'pinia';
import { ref, shallowRef, computed, watch } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { useToday } from '@/composables/useToday';
import { isDocLoaded } from '@/services/automerge/docService';
import * as listRepo from '@/services/automerge/repositories/listRepository';
import * as cycleRepo from '@/services/automerge/repositories/listCycleRepository';
import { buildCycleSnapshot, expiredCycleIds, CYCLE_SWEEP_ENABLED } from '@/utils/listCycles';
import { clockVerdict, readSweepDay, recordSweepDay } from '@/utils/cycleSweepClock';
import { list as projectionList } from '@/services/automerge/projection';
import { computeRecurringReset, isDueSoon, isFiled, isRecurring } from '@/utils/listLifecycle';
import { getListTemplateByKey } from '@/constants/listTemplates';
import { useTranslationStore } from '@/stores/translationStore';
import { toISODateString } from '@/utils/date';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { generateUUID } from '@/utils/id';
import { trackFeature } from '@/services/analytics/plausible';
import type {
  FamilyList,
  FamilyListItem,
  ListCycle,
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
 * `celebrate('list-complete')` on completion (the full-screen bean shower). All lifecycle-conditional reads go
 * through `@/utils/listLifecycle` predicates — never inline `lifecycle === …`.
 *
 * Write invariants: list-level completion/filing is derived ONLY via
 * `deriveCompletion` (from `toggleItem`/`addItem`/`removeItem`); recurrence reset
 * lives ONLY in `reconcileRecurringLists`; the lifecycle flip (which clears the
 * completion triple) lives ONLY in `setLifecycle`. No other action mutates
 * `completed`/`completedBy`/`completedAt`/`lastResetDate`/`cycleCelebrated`.
 * In particular `renameList`/`updateItemText`/`reorderItems` deliberately do NOT
 * derive completion — they change the title/text/order, never which items exist
 * or their done-state.
 */
export const useListStore = defineStore('lists', () => {
  // State
  const lists = ref<FamilyList[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Archived cycles of recurring lists. A `shallowRef` on purpose: the records are
   * immutable by contract (write-once, never patched), so the 2-3x Vue deep-proxy cost
   * documented in PERFORMANCE.md buys nothing. Every update REPLACES the array —
   * `.push`/`.splice` on a shallowRef are non-reactive and must not appear.
   */
  const cycles = shallowRef<ListCycle[]>([]);
  /** True only after a successful `loadCycles`. */
  const cyclesLoaded = ref(false);
  // Deliberately NOT the shared isLoading/error: a history read must never blank or
  // error the live-lists shelf, and `wrapAsync` toasts on whatever refs it is handed.
  const cyclesLoading = ref(false);
  const cyclesError = ref<string | null>(null);

  const { today, isVisible } = useToday();

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

  /**
   * Archived cycles, newest first, narrowed by the same global member filter as lists so
   * history behaves identically to the live shelf.
   */
  const filteredCycles = createMemberFiltered(cycles, (c) => c.ownerId);
  const archivedCycles = computed(() =>
    [...filteredCycles.value].sort((a, b) => b.endedOn.localeCompare(a.endedOn))
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
    await loadCycles();
    // Only AFTER the collections are populated, so a watcher race can't run against an
    // empty set. Idempotent — a same-day re-run is a no-op.
    await runDailyMaintenance();
  }

  /**
   * Archived cycles. Its OWN loading/error refs, deliberately: sharing the store's would
   * let a history read blank or error the live-lists shelf, and `wrapAsync` toasts on
   * whatever refs it is given.
   */
  async function loadCycles(): Promise<void> {
    if (!isDocLoaded()) return;
    await wrapAsync(
      cyclesLoading,
      cyclesError,
      async () => {
        cycles.value = await cycleRepo.getAllCycles();
        cyclesLoaded.value = true;
      },
      // History is a secondary read on a page whose PRIMARY content is the live lists.
      // A failure must not throw a toast over a working page at boot; the shelf renders
      // its own empty state and `cyclesError` records the reason.
      { action: 'listStore:loadCycles', errorToast: false }
    );
    if (cyclesError.value) {
      cycles.value = [];
      cyclesLoaded.value = false;
    }
  }

  /**
   * The ONE daily pass. Re-entrancy-guarded because `loadLists`, the `today` watcher and
   * a PWA resume can overlap, and two concurrent passes over the same list would both
   * read its pre-reset state.
   *
   * Called from BOTH `loadLists` and the watcher, and both are required: `watch(today)`
   * is not `immediate` and `today` is set at module load, so for a user who opens the app
   * fresh each day the watcher never fires in that session.
   */
  let maintaining = false;
  async function runDailyMaintenance(): Promise<void> {
    if (maintaining) return;
    maintaining = true;
    try {
      await reconcileRecurringLists();
      await sweepExpiredCycles();
    } finally {
      maintaining = false;
    }
  }

  /**
   * Delete archived cycles past the keep window.
   *
   * Deliberately its own function rather than a tail of `reconcileRecurringLists`, whose
   * docstring reads "the ONE write path for the clock advanced": hiding an irreversible
   * delete behind a benign name is the kind of thing that survives ten reviews and then
   * surprises somebody. It is named for what it does.
   *
   * Never throws. A sweep failure must not affect tomorrow's reset.
   */
  async function sweepExpiredCycles(): Promise<void> {
    // 1. Kill switch — a data-loss report is answered with a one-line release.
    if (!CYCLE_SWEEP_ENABLED) return;

    // 2. Never sweep a document whose load has not provably completed. `isDocLoaded()` is
    //    the real guard here: the projection arrives in per-collection chunks and this
    //    flips only on the last one. `cyclesLoaded` is a cheap forward-compat check —
    //    what actually stops a mass delete is that the predicate is per-record.
    if (!isDocLoaded() || !cyclesLoaded.value) {
      logSweepSkip('not-loaded');
      return;
    }

    // 3. The clock. A wrong clock can only ever DELAY a deletion.
    const verdict = clockVerdict(today.value, readSweepDay());
    if (verdict !== 'sweep') {
      // Each skip decides for itself whether to advance the cursor, because the two
      // answers have opposite failure modes and one rule cannot serve both:
      //
      //   first-run  — advance. Nothing was deleted; tomorrow is a real sweep.
      //   corrupt    — advance. Advancing IS the repair: it overwrites the bad reading,
      //                which is the only way a poisoned cursor ever unsticks itself.
      //   jumped     — advance. The reading is untrusted for DELETING, but leaving the
      //                cursor behind would re-warn on every app open forever. If the
      //                reading was garbage, `skip-corrupt` repairs it on the correction.
      //   regressed  — do NOT advance. Moving the high-water mark backwards is exactly
      //                the write that would let a wrong clock accelerate a deletion.
      //   same-day   — nothing to do, and deliberately silent: this is the normal path.
      if (verdict !== 'skip-regressed' && verdict !== 'skip-same-day') {
        recordSweepDay(today.value);
      }
      if (verdict === 'skip-first-run') logSweepSkip('first-run');
      else if (verdict === 'skip-jumped') logSweepSkip('clock-jumped');
      else if (verdict === 'skip-corrupt') logSweepSkip('clock-corrupt');
      else if (verdict === 'skip-regressed') logSweepSkip('clock-regressed');
      return;
    }

    try {
      // 4. Read the PROJECTION, not the reactive array: a stale array must never be able
      //    to widen a deletion.
      const stored = projectionList('listCycles');
      // A completed sweep with nothing to do — and it MUST advance the cursor. Leaving it
      // frozen (as an earlier draft did) means every family with no history yet re-reaches
      // the trusted-jump bound every eighth day and fires a false `clock-jumped` warning
      // forever, drowning the one signal that detects a genuinely bad clock.
      if (!stored.length) {
        recordSweepDay(today.value);
        return;
      }

      // 5. The pure predicate — keep-on-doubt, capped, oldest first.
      const ids = expiredCycleIds(stored, today.value);
      if (!ids.length) {
        recordSweepDay(today.value);
        return;
      }

      // 6. RESERVE the day BEFORE deleting anything. `MAX_SWEEP_DELETES` is a per-DAY cap,
      //    and it is only that if the day is actually claimed: recording afterwards means
      //    a failed write (or a kill in the window between the two) leaves the cursor on
      //    yesterday, and maintenance re-runs on every visit and every remote merge — so
      //    the cap degrades into 50-per-invocation and a whole archive can go in one
      //    session. Failing to reserve costs one day of retention; not reserving can cost
      //    the history.
      if (!recordSweepDay(today.value)) {
        logSweepSkip('cursor-write-failed');
        return;
      }

      await cycleRepo.deleteCycles(ids);

      // 7. Only mirror into the store AFTER the write resolved, so a failure leaves the
      //    UI showing what is actually still stored.
      const gone = new Set(ids);
      cycles.value = cycles.value.filter((c) => !gone.has(c.id));

      // 8. The count is the load-bearing signal: a run at or near the cap, sustained over
      //    days, is the fingerprint of a bad clock or a broken predicate — and the only
      //    way this feature's worst failure surfaces before a user reports it.
      logEvent({
        level: 'info',
        surface: 'recurrence',
        message: 'cycle-swept',
        context: {
          recur_surface: 'list',
          recur_outcome: 'swept',
          recur_children_removed: ids.length,
          recur_children_expected: stored.length,
        },
      });
    } catch (e) {
      logEvent({
        level: 'warn',
        surface: 'recurrence',
        message: 'cycle-sweep-failed',
        context: { recur_surface: 'list', recur_outcome: 'write-failed' },
      });
      reportError({
        surface: 'listStore.sweepExpiredCycles',
        message:
          'cycle retention sweep failed — nothing was deleted and the high-water day was not advanced, so it retries on the next app load or day advance',
        error: e,
        severity: 'warning',
        context: { recur_surface: 'list', recur_outcome: 'write-failed' },
      });
    }
  }

  /** A sweep that never runs is as much a bug as one that runs too eagerly. */
  function logSweepSkip(
    kind:
      | 'first-run'
      | 'clock-jumped'
      | 'clock-regressed'
      | 'clock-corrupt'
      | 'cursor-write-failed'
      | 'not-loaded'
  ): void {
    logEvent({
      level: 'warn',
      surface: 'recurrence',
      message: 'cycle-sweep-skipped',
      context: { recur_surface: 'list', recur_outcome: kind },
    });
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
    return trackFeature(result ?? null, 'list');
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
    // Deliberately NOT tracked. `feature_used` counts CREATION for all 16
    // features; instrumenting this update path too would rank lists top as a
    // pure measurement artifact (it is the store's shared write funnel — every
    // item tick, rename and link-clear lands here). It also runs unattended from
    // `reconcileRecurringLists` on a midnight/resume wake, and `feature_used` is
    // an interactive event.
    return result ?? null;
  }

  async function deleteList(id: string): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        // A `delete` on an id that is already gone is a silent no-op in the worker, and
        // `deleteListWithCycles` resolves to `undefined` either way — so without this the
        // action reported success for a list it never touched (the exact silent-failure
        // class `useMemberRemoval` was written to close). Check the PROJECTION, not the
        // reactive array, so a stale array cannot fake either answer.
        if (!projectionList('lists').some((l) => l.id === id)) {
          reportError({
            surface: 'lists',
            message: 'deleteList called for a list that is no longer in the document',
            severity: 'warning',
            context: { action: 'delete_missing_list' },
          });
          return false;
        }
        // Deletes the list AND its whole history in one change, so no orphan window
        // exists. The intentional path, taken by a user who is present.
        await cycleRepo.deleteListWithCycles(id);
        lists.value = lists.value.filter((l) => l.id !== id);
        cycles.value = cycles.value.filter((c) => c.listId !== id);
        return true;
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
      celebrate('list-complete', {
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
   * Rename a list. Trims; an empty/whitespace or unchanged title is a no-op
   * (returns the list unchanged) — a list must always have a title. Deliberately
   * does NOT derive completion: renaming changes neither which items exist nor
   * their done-state, so it must never touch the completion/filing triple.
   */
  async function renameList(listId: string, title: string): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    const next = title.trim();
    if (!next || next === list.title) return list; // no-op revert / unchanged
    return updateList(listId, { title: next });
  }

  /**
   * Edit one item's text. Preserves the item's completion triple (spread). Trims;
   * an empty/whitespace or unchanged value is a no-op (returns the list unchanged)
   * — deletion is the remove button's job, never an emptied edit. Deliberately
   * does NOT derive completion (the set of items and their done-state is unchanged).
   */
  async function updateItemText(
    listId: string,
    itemId: string,
    title: string
  ): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    const next = title.trim();
    const current = list.items.find((i) => i.id === itemId);
    if (!current || !next || next === current.title) return list; // no-op
    const items = list.items.map((it) => (it.id === itemId ? { ...it, title: next } : it));
    return updateList(listId, { items });
  }

  /**
   * Reorder items by moving the item at `fromIndex` to `toIndex`. Pure array
   * move; bounds-guarded (out-of-range or equal indices no-op). Deliberately does
   * NOT derive completion: same items, same done-state, just a different order.
   */
  async function reorderItems(
    listId: string,
    fromIndex: number,
    toIndex: number
  ): Promise<FamilyList | null> {
    const list = lists.value.find((l) => l.id === listId);
    if (!list) return null;
    const n = list.items.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) {
      return list; // no-op on a degenerate move
    }
    const items = [...list.items];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved!);
    return updateList(listId, { items });
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
            // #70: `cadence` must be cleared alongside `frequency`. Leaving it
            // means a recurring -> oneoff -> recurring round-trip resurrects the
            // OLD cadence, which `resolveListRule` reads in preference to the
            // 'weekly' the recurring branch above just wrote.
            cadence: undefined,
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

      const resetPatch = {
        items: list.items.map((i) => ({
          ...i,
          completed: false,
          completedBy: undefined,
          completedAt: undefined,
        })),
        lastResetDate: nextResetDate,
        cycleCelebrated: false,
      };

      // Snapshot the cycle from the list AS IT IS, before the reset. `null` means the
      // list has no items at all — "0 of 0" is noise, not history — so that case falls
      // through to the plain reset below, exactly as before this feature existed.
      const snapshot = buildCycleSnapshot(list, nextResetDate, toISODateString(new Date()));
      if (snapshot) {
        try {
          // Archive + reset as ONE atomic change: a cycle can never be archived without
          // its list being reset, nor a list reset without its cycle being kept.
          await cycleRepo.archiveCycleAndReset(
            snapshot,
            list.id,
            resetPatch,
            toISODateString(new Date())
          );
          // A batch mutation resolves to `undefined`, so success cannot be read from the
          // return value. Verify against the projection instead — otherwise a write that
          // resolves while changing nothing would be recorded as an archive.
          const after = await listRepo.getListById(list.id);
          if (!after) {
            // The list was deleted on another device and the merge landed mid-loop. The
            // reset op carries `onMissing: 'skip'`, so it no-opped while the cycle `set`
            // COMMITTED — the batch is not atomic in this one case. Reap the orphan here:
            // nothing else will, since the other device's `deleteListWithCycles` has
            // already been and gone and `expiredCycleIds` prunes only by age, so it would
            // otherwise sit on the history shelf under a deleted list for 90 days.
            //
            // This is an ordinary race, not a failure: no toast, no reportError. It used
            // to fall into the catch below and tell the user the archive had failed and
            // that state was consistent, neither of which was true.
            await cycleRepo.deleteCycles([snapshot.id]);
            logEvent({
              level: 'info',
              surface: 'recurrence',
              message: 'cycle-archive-skipped-list-deleted',
              context: { recur_surface: 'list', recur_outcome: 'list-deleted' },
            });
            continue;
          }
          if (after.lastResetDate !== nextResetDate) {
            throw new Error('archive+reset verify failed: lastResetDate did not advance');
          }
          cycles.value = [...cycles.value, snapshot];
          lists.value = lists.value.map((l) => (l.id === after.id ? after : l));
          logEvent({
            level: 'info',
            surface: 'recurrence',
            message: 'cycle-archived',
            context: { recur_surface: 'list', recur_outcome: 'archived' },
          });
        } catch (e) {
          // One list's failure must never abort the loop.
          logEvent({
            level: 'warn',
            surface: 'recurrence',
            message: 'cycle-archive-failed',
            context: { recur_surface: 'list', recur_outcome: 'write-failed' },
          });
          reportError({
            surface: 'listStore.reconcileRecurringLists',
            message:
              'archive+reset batch failed — the list did not reset; it retries on the next app load or day advance. State may be SPLIT: the cycle `set` and the list `patch` are separate ops, so the cycle can be present without the reset having landed',
            error: e,
            severity: 'error',
            context: { recur_surface: 'list', recur_outcome: 'write-failed' },
          });
          // Only toast when somebody is actually looking; this runs unattended at
          // midnight and on PWA resume, where a toast would be queued for nobody.
          // Optional-chained deliberately: this is inside a catch on an unattended
          // path, and an error handler that throws is worse than a missing toast.
          if (isVisible?.value) {
            showToast('error', useTranslationStore().t('lists.cycle.archiveFailed'));
          }
        }
        continue;
      }

      const written = await updateList(list.id, resetPatch);
      // #70: this ran on a background wake (midnight / PWA resume), so a failed
      // write had no user present to see a toast — the list silently kept its
      // stale ticks and `lastResetDate` was never stamped, so it would try again
      // forever with no trace. Record it.
      if (!written) {
        logEvent({
          level: 'warn',
          surface: 'recurrence',
          message: 'list-reset-failed',
          context: { recur_surface: 'list', recur_outcome: 'write-failed' },
        });
      }
    }
  }

  function resetState(): void {
    lists.value = [];
    isLoading.value = false;
    error.value = null;
    cycles.value = [];
    cyclesLoaded.value = false;
    cyclesLoading.value = false;
    cyclesError.value = null;
  }

  // Reset recurring lists when the local day advances (PWA wake / midnight /
  // tab restore). Guarded against an empty set; idempotent on same-day re-runs.
  watch(today, () => {
    void runDailyMaintenance();
  });

  return {
    // State
    lists,
    isLoading,
    error,
    cycles,
    cyclesLoaded,
    archivedCycles,
    sweepExpiredCycles,
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
    renameList,
    updateItemText,
    reorderItems,
    setLifecycle,
    clearLinksFor,
    reconcileRecurringLists,
    resetState,
  };
});
