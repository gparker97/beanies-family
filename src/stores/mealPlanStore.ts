import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { useToday } from '@/composables/useToday';
import { isDocLoaded } from '@/services/automerge/docService';
import * as mealRepo from '@/services/automerge/repositories/mealPlanRepository';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import { logEvent } from '@/services/telemetry/logEvent';
import type {
  MealPlanEntry,
  CreateMealPlanInput,
  UpdateMealPlanInput,
  MealSlot,
} from '@/types/models';

/** Canonical slot order for stable rendering (snacks last). */
const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };

const bySlotThenPosition = (a: MealPlanEntry, b: MealPlanEntry) =>
  SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || a.position - b.position;

// Week/multi-day ordering MUST lead with the date, else a share (which prints a
// day heading only when the date changes) repeats headings and scrambles output.
const byDateSlotPosition = (a: MealPlanEntry, b: MealPlanEntry) =>
  a.date.localeCompare(b.date) ||
  SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] ||
  a.position - b.position;

/**
 * Meal-planner store (#27) — mirrors `listStore`/`recipesStore`: the same state
 * triple, the same `wrapAsync` error discipline (toast + `reportError`, returns
 * result-or-null), and a `useToday()` singleton for "today's meals". The board is
 * a shared family plan, so getters are NOT member-filtered; per-member visibility
 * is applied downstream (the daily-briefing `'meal'` item via `classifyOwnerAudience`).
 */
export const useMealPlanStore = defineStore('mealPlans', () => {
  const meals = ref<MealPlanEntry[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const { today } = useToday();

  // ========== GETTERS ==========

  /** Meals for one day, sorted by slot then position. */
  function mealsForDate(dateISO: string): MealPlanEntry[] {
    return meals.value.filter((m) => m.date === dateISO).sort(bySlotThenPosition);
  }

  /** Meals across a set of week dates, sorted by date → slot → position. */
  function mealsForWeek(weekDates: string[]): MealPlanEntry[] {
    const set = new Set(weekDates);
    return meals.value.filter((m) => set.has(m.date)).sort(byDateSlotPosition);
  }

  /** Today's meals — drives the nook "today's meals" card. */
  const todaysMeals = computed(() => mealsForDate(today.value));

  /** Today's uncooked recipe meals with a cook — the daily-briefing source (see useCriticalItems). */
  const todaysCookAssignments = computed(() =>
    todaysMeals.value.filter(
      (m) => m.kind === 'recipe' && !!m.recipeId && !!m.cookMemberId && !m.cooked
    )
  );

  // ========== ACTIONS ==========

  async function loadMealPlans(): Promise<void> {
    // No-op until the Automerge doc is loaded (mirrors listStore) — the central
    // load sequence re-runs this once the doc is ready.
    if (!isDocLoaded()) return;
    await wrapAsync(
      isLoading,
      error,
      async () => {
        meals.value = await mealRepo.getAllMealPlans();
      },
      { action: 'mealPlanStore:loadMealPlans' }
    );
  }

  /** Next `position` for a day+slot: `(max existing) + 1`; deletes leave gaps (fine). */
  function nextPosition(dateISO: string, slot: MealSlot): number {
    const existing = meals.value.filter((m) => m.date === dateISO && m.slot === slot);
    return existing.length ? Math.max(...existing.map((m) => m.position)) + 1 : 0;
  }

  async function createMeal(
    input: CreateMealPlanInput,
    opts?: { quickAdd?: boolean }
  ): Promise<MealPlanEntry | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const entry = await mealRepo.createMealPlan({
          ...input,
          position: nextPosition(input.date, input.slot),
        });
        meals.value = [...meals.value, entry];
        logEvent({
          level: 'info',
          surface: 'meal-planner',
          message: 'meal created',
          context: {
            action: 'meal-created',
            kind: entry.kind,
            slot: entry.slot,
            quick_add: opts?.quickAdd ?? false,
          },
        });
        return entry;
      },
      { action: 'mealPlanStore:createMeal' }
    );
    return result ?? null;
  }

  /**
   * Move a placed meal to a new day+slot, recomputing its `position` for the
   * target cell (so it lands after any meals already there, never colliding on
   * position 0). Used by drag-to-move on the board.
   */
  async function moveMeal(id: string, date: string, slot: MealSlot): Promise<MealPlanEntry | null> {
    return updateMeal(id, { date, slot, position: nextPosition(date, slot) });
  }

  async function updateMeal(id: string, input: UpdateMealPlanInput): Promise<MealPlanEntry | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const updated = await mealRepo.updateMealPlan(id, input);
        if (updated) meals.value = meals.value.map((m) => (m.id === id ? updated : m));
        return updated;
      },
      { action: 'mealPlanStore:updateMeal' }
    );
    return result ?? null;
  }

  async function deleteMeal(id: string): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const ok = await mealRepo.deleteMealPlan(id);
        if (ok) meals.value = meals.value.filter((m) => m.id !== id);
        return ok;
      },
      { action: 'mealPlanStore:deleteMeal' }
    );
    return result ?? false;
  }

  /**
   * Copy an ENTIRE week's meals into another week (overwriting the target). The
   * caller passes the source + target week dates (same index = same weekday), so
   * the store needs no week-start math. Recipes are REFERENCED, not cloned;
   * `cooked`/`cookLogId` reset; cook + eaters + note + serveTime carried. The
   * target week's existing meals are replaced in one atomic batch; already-recorded
   * cook logs are untouched (they live in the `cookLogs` collection).
   */
  async function copyWeek(fromDates: string[], toDates: string[]): Promise<boolean> {
    // Guard the index-alignment contract — a misaligned pair would persist a
    // dateless orphan meal (toDates[i] === undefined). Callers pass aligned
    // 7-day arrays; this fails loud rather than corrupting the doc.
    if (fromDates.length !== toDates.length) {
      logEvent({
        level: 'warn',
        surface: 'meal-planner',
        message: 'copyWeek called with misaligned date arrays',
        context: { action: 'copy-misaligned' },
      });
      return false;
    }
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const now = toISODateString(new Date());
        const source = mealsForWeek(fromDates);
        const entries: MealPlanEntry[] = source.map((m) => ({
          ...m,
          id: generateUUID(),
          date: toDates[fromDates.indexOf(m.date)]!,
          cooked: false,
          cookLogId: undefined,
          createdAt: now,
          updatedAt: now,
        }));
        await mealRepo.replaceWeek(toDates, entries);
        // Reconcile local state: drop the replaced week, add the new entries.
        const toSet = new Set(toDates);
        meals.value = [...meals.value.filter((m) => !toSet.has(m.date)), ...entries];
        return true;
      },
      { action: 'mealPlanStore:copyWeek' }
    );
    return result ?? false;
  }

  /**
   * Remove every meal on the given dates in one atomic batch (reuses replaceWeek
   * with no new entries). Used by "clear day" (one date) and "clear week" (seven).
   * Cook logs are untouched — they live in their own collection.
   */
  async function clearDates(dates: string[]): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        await mealRepo.replaceWeek(dates, []);
        const set = new Set(dates);
        meals.value = meals.value.filter((m) => !set.has(m.date));
        logEvent({
          level: 'info',
          surface: 'meal-planner',
          message: 'meals cleared',
          context: { action: dates.length > 1 ? 'week-cleared' : 'day-cleared' },
        });
        return true;
      },
      { action: 'mealPlanStore:clearDates' }
    );
    return result ?? false;
  }

  /** Whether the target week already holds meals — drives the copy overwrite warning. */
  function weekHasMeals(weekDates: string[]): boolean {
    const set = new Set(weekDates);
    return meals.value.some((m) => set.has(m.date));
  }

  /**
   * Reconcile local reactive state after a recipe was deleted (the repo batch
   * already nullified `recipeId` on referencing meal-plan entries). Called by
   * `recipesStore.deleteRecipeCascade` so the board doesn't show stale refs.
   */
  function nullifyRecipe(recipeId: string): void {
    meals.value = meals.value.map((m) =>
      m.recipeId === recipeId ? { ...m, recipeId: undefined } : m
    );
  }

  function resetState(): void {
    meals.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    meals,
    isLoading,
    error,
    mealsForDate,
    mealsForWeek,
    todaysMeals,
    todaysCookAssignments,
    weekHasMeals,
    loadMealPlans,
    createMeal,
    updateMeal,
    deleteMeal,
    moveMeal,
    copyWeek,
    clearDates,
    nullifyRecipe,
    resetState,
  };
});
