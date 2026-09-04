/**
 * Wiring-level guarantees for the cookbook view (#87). The RULES are tested in
 * `utils/__tests__/recipeOrdering.test.ts`; what is tested here is the order of operations and
 * the persistence policy, both of which are decisions rather than logic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref, nextTick } from 'vue';
import { useCookbookView } from '../useCookbookView';
import { useRecipesStore } from '@/stores/recipesStore';
import type { Recipe } from '@/types/models';

function recipe(partial: Partial<Recipe> & { id: string; name: string }): Recipe {
  return {
    ingredients: [],
    steps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Recipe;
}

const RECIPES = [
  recipe({ id: '1', name: 'Cake', course: 'dessert' }),
  recipe({ id: '2', name: 'Stew', course: 'main' }),
  recipe({ id: '3', name: 'Pie', course: 'main' }),
  recipe({ id: '4', name: 'Mystery' }),
];

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

describe('useCookbookView', () => {
  it('counts courses from the UNFILTERED list, so the pills do not move when filtering', async () => {
    const view = useCookbookView(ref(RECIPES));
    expect(view.courseCounts.value.main).toBe(2);

    view.setCourse('dessert');
    await nextTick();

    // The whole point: selecting dessert must NOT zero the main count, or the control looks
    // broken and there is no way to see what else is there.
    expect(view.courseCounts.value.main).toBe(2);
    expect(view.courseCounts.value.dessert).toBe(1);
    expect(view.visibleCount.value).toBe(1);
  });

  it('filters, then sorts, then groups', async () => {
    const view = useCookbookView(ref(RECIPES));
    view.setCourse('main');
    view.groupBy.value = 'course';
    await nextTick();

    expect(view.shelves.value).toHaveLength(1);
    expect(view.shelves.value[0]!.key).toBe('main');
    expect(view.shelves.value[0]!.items.map((r) => r.name)).toEqual(['Pie', 'Stew']);
  });

  it('shows everything again after clearFilter', async () => {
    const view = useCookbookView(ref(RECIPES));
    view.setCourse('main');
    await nextTick();
    view.clearFilter();
    await nextTick();
    expect(view.visibleCount.value).toBe(4);
  });

  it('persists sort and group, but NOT the course filter', async () => {
    const first = useCookbookView(ref(RECIPES));
    first.sortBy.value = 'recent';
    first.groupBy.value = 'meal';
    first.setCourse('main');
    await nextTick();

    // A fresh mount is what a reload looks like.
    const second = useCookbookView(ref(RECIPES));
    expect(second.sortBy.value).toBe('recent');
    expect(second.groupBy.value).toBe('meal');
    // A restored filter would open the cookbook with most recipes missing — data loss, to a
    // user who cannot see why.
    expect(second.course.value).toBeNull();
    expect(second.visibleCount.value).toBe(4);
  });

  it('ignores an unknown course filter loudly rather than blanking the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = useCookbookView(ref(RECIPES));
    view.setCourse('pudding');
    await nextTick();
    expect(view.course.value).toBeNull();
    expect(view.visibleCount.value).toBe(4);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sorts by cook count from the store, not from a per-recipe computed', async () => {
    const store = useRecipesStore();
    store.cookLogs = [{ recipeId: '2' }, { recipeId: '2' }, { recipeId: '1' }] as never;

    const view = useCookbookView(ref(RECIPES));
    view.sortBy.value = 'cooked';
    await nextTick();

    // '2' (2 cooks), '1' (1 cook), then the two uncooked resolved by the name tie-break —
    // 'Mystery' before 'Pie'. That tie-break is what keeps two family devices showing the
    // same grid when Automerge yields the recipes in a different order.
    expect(view.shelves.value[0]!.items.map((r) => r.name)).toEqual([
      'Stew',
      'Cake',
      'Mystery',
      'Pie',
    ]);
  });

  it('handles an empty cookbook', () => {
    const view = useCookbookView(ref([]));
    expect(view.totalCount.value).toBe(0);
    expect(view.visibleCount.value).toBe(0);
    expect(view.courseCounts.value.unset).toBe(0);
  });
});
