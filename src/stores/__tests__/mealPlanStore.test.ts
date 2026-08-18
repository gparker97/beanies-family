/**
 * Unit tests for the meal-planner store (#27) — the core logic that the UI relies
 * on: position assignment, copy-week (date-shift + cooked-reset + recipe-reference),
 * and recipe dereference. The Automerge repository + doc service + telemetry are
 * mocked so these exercise the store's own reconciliation, not persistence.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MealPlanEntry } from '@/types/models';

const todayRef = { value: '2026-08-20' };
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: todayRef }) }));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const repoState = { all: [] as MealPlanEntry[] };
const createMealPlan = vi.fn(async (input: Record<string, unknown>) => ({
  ...input,
  id: `id-${createMealPlan.mock.calls.length}`,
  createdAt: 'ts',
  updatedAt: 'ts',
}));
const getAllMealPlans = vi.fn(async () => repoState.all);
const updateMealPlan = vi.fn(async (id: string, patch: Record<string, unknown>) => ({
  id,
  ...patch,
}));
const deleteMealPlan = vi.fn(async () => true);
const replaceWeek = vi.fn(async () => {});

vi.mock('@/services/automerge/repositories/mealPlanRepository', () => ({
  getAllMealPlans: (...a: unknown[]) => getAllMealPlans(...(a as [])),
  createMealPlan: (...a: unknown[]) => createMealPlan(...(a as [Record<string, unknown>])),
  updateMealPlan: (...a: unknown[]) => updateMealPlan(...(a as [string, Record<string, unknown>])),
  deleteMealPlan: (...a: unknown[]) => deleteMealPlan(...(a as [])),
  replaceWeek: (...a: unknown[]) => replaceWeek(...(a as [])),
}));

import { useMealPlanStore } from '@/stores/mealPlanStore';

type Store = ReturnType<typeof useMealPlanStore>;

function seed(meal: Partial<MealPlanEntry>): MealPlanEntry {
  return {
    id: 'seed',
    date: '2026-08-18',
    slot: 'dinner',
    position: 0,
    kind: 'recipe',
    cooked: false,
    createdAt: 'ts',
    updatedAt: 'ts',
    ...meal,
  };
}

const WEEK_A = [
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
  '2026-08-24',
];
const WEEK_B = [
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
  '2026-08-30',
  '2026-08-31',
];

let store: Store;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  repoState.all = [];
  store = useMealPlanStore();
});

describe('mealPlanStore', () => {
  it('assigns position (max in day+slot) + 1 on insert', async () => {
    await store.createMeal({ date: '2026-08-20', slot: 'snack', kind: 'other', cooked: false });
    await store.createMeal({ date: '2026-08-20', slot: 'snack', kind: 'other', cooked: false });
    const snacks = store.mealsForDate('2026-08-20');
    expect(snacks.map((m) => m.position)).toEqual([0, 1]);
  });

  it('copyWeek references recipes, resets cooked, and shifts dates by whole weeks', async () => {
    repoState.all = [
      seed({
        id: 'm1',
        date: '2026-08-18',
        slot: 'dinner',
        recipeId: 'r1',
        cooked: true,
        cookLogId: 'log1',
      }),
    ];
    await store.loadMealPlans();

    const ok = await store.copyWeek(WEEK_A, WEEK_B);
    expect(ok).toBe(true);

    // replaceWeek gets the target week's dates + the shifted, reset entries.
    const [toDates, entries] = replaceWeek.mock.calls[0] as unknown as [string[], MealPlanEntry[]];
    expect(toDates).toEqual(WEEK_B);
    expect(entries).toHaveLength(1);
    const copied = entries[0]!;
    expect(copied.date).toBe('2026-08-25'); // Mon → Mon
    expect(copied.recipeId).toBe('r1'); // referenced, not cloned
    expect(copied.cooked).toBe(false); // reset
    expect(copied.cookLogId).toBeUndefined(); // cook log NOT carried
    expect(copied.id).not.toBe('m1'); // fresh id
    // Local state reconciled: the copied meal is now present in week B.
    expect(store.mealsForWeek(WEEK_B).map((m) => m.date)).toEqual(['2026-08-25']);
  });

  it('mealsForWeek orders by date then slot (never slot-grouped — guards the share)', async () => {
    repoState.all = [
      seed({ id: 'mon-b', date: '2026-08-18', slot: 'breakfast' }),
      seed({ id: 'tue-b', date: '2026-08-19', slot: 'breakfast' }),
      seed({ id: 'mon-d', date: '2026-08-18', slot: 'dinner' }),
    ];
    await store.loadMealPlans();
    // Correct: all of Monday (breakfast, dinner) before Tuesday — NOT all breakfasts then dinners.
    expect(store.mealsForWeek(WEEK_A).map((m) => m.id)).toEqual(['mon-b', 'mon-d', 'tue-b']);
  });

  it('moveMeal recomputes position for the target cell', async () => {
    repoState.all = [
      seed({ id: 'src', date: '2026-08-18', slot: 'dinner', position: 0 }),
      seed({ id: 'tgt', date: '2026-08-19', slot: 'dinner', position: 0 }),
    ];
    await store.loadMealPlans();
    await store.moveMeal('src', '2026-08-19', 'dinner');
    const moved = store.meals.find((m) => m.id === 'src')!;
    expect(moved.date).toBe('2026-08-19');
    expect(moved.position).toBe(1); // after the existing tgt (position 0), not colliding
  });

  it('weekHasMeals reflects the target week', async () => {
    repoState.all = [seed({ date: '2026-08-26' })];
    await store.loadMealPlans();
    expect(store.weekHasMeals(WEEK_B)).toBe(true);
    expect(store.weekHasMeals(WEEK_A)).toBe(false);
  });

  it('nullifyRecipe clears recipeId on referencing entries ("recipe removed")', async () => {
    repoState.all = [seed({ id: 'm1', recipeId: 'r1' }), seed({ id: 'm2', recipeId: 'r2' })];
    await store.loadMealPlans();
    store.nullifyRecipe('r1');
    expect(store.meals.find((m) => m.id === 'm1')?.recipeId).toBeUndefined();
    expect(store.meals.find((m) => m.id === 'm2')?.recipeId).toBe('r2');
  });

  it('todaysCookAssignments surfaces only uncooked recipe meals with a cook', async () => {
    repoState.all = [
      seed({ id: 'a', date: '2026-08-20', recipeId: 'r1', cookMemberId: 'greg', cooked: false }),
      seed({ id: 'b', date: '2026-08-20', recipeId: 'r2', cookMemberId: 'greg', cooked: true }), // cooked
      seed({ id: 'c', date: '2026-08-20', recipeId: 'r3', cooked: false }), // no cook
      seed({ id: 'd', date: '2026-08-20', kind: 'eat_out', cookMemberId: 'greg', cooked: false }), // type
    ];
    await store.loadMealPlans();
    expect(store.todaysCookAssignments.map((m) => m.id)).toEqual(['a']);
  });
});
