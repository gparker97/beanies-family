/**
 * The edit-meal drawer's ingredients (#116): as written, with this meal's Cook ×N and the
 * (×N) suffix for the LIVE eaters, re-batched without losing hand edits, and added to a
 * list on its own (never through the meal's Save).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Recipe } from '@/types/models';

const h = vi.hoisted(() => ({
  destinations: [] as Array<Record<string, unknown>>,
  lists: [] as Array<Record<string, unknown>>,
  commit: vi.fn(async (_args: unknown): Promise<unknown> => ({ id: 'new-list' })),
  logged: [] as Array<Record<string, unknown>>,
  mealPlanStoreUsed: false,
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      ({
        'lists.destination.addShort': 'Add {n}',
        'lists.destination.addTo': 'Add to {list}',
        'mealPlanner.shopping.cook.times': 'Cook ×{n}',
        'mealPlanner.shopping.cook.once': 'Cook Once',
        'mealPlanner.shopping.forEating': 'For {n}, serves {s}',
      })[k] ?? k,
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'm1' } }),
}));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get shoppingDestinations() {
      return h.destinations;
    },
    get lists() {
      return h.lists;
    },
  }),
}));
// Tripwire: the panel must never reach for the meal (its Add is independent of Save).
vi.mock('@/stores/mealPlanStore', () => ({
  useMealPlanStore: () => {
    h.mealPlanStoreUsed = true;
    return {};
  },
}));
vi.mock('@/services/telemetry', () => ({
  logEvent: (e: Record<string, unknown>) => h.logged.push(e),
}));
vi.mock('@/composables/useShoppingListCommit', async (orig) => {
  const { ref } = await import('vue');
  return {
    ...(await orig<typeof import('@/composables/useShoppingListCommit')>()),
    useShoppingListCommit: () => ({ commit: h.commit, isSubmitting: ref(false) }),
  };
});

import MealIngredientsPanel from '../MealIngredientsPanel.vue';

const RECIPE = {
  id: 'r1',
  name: 'Beef Tacos',
  servings: '4',
  ingredients: ['For the filling:', '500 g ground beef', '8 taco shells', 'Salt, to taste'],
  steps: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Recipe;

function mounted(eating: number, recipe: Recipe = RECIPE) {
  return mount(MealIngredientsPanel, {
    props: { recipe, eating },
    global: {
      stubs: {
        FamilyChipPicker: { props: ['modelValue', 'mode', 'compact'], template: '<div />' },
        BeanieDatePicker: { props: ['modelValue', 'label', 'placeholder'], template: '<div />' },
      },
    },
  });
}
const texts = (w: ReturnType<typeof mounted>) =>
  w.findAll('[data-testid="ingredient-text"]').map((n) => (n.element as HTMLTextAreaElement).value);
const addBtn = (w: ReturnType<typeof mounted>) => w.find('[data-testid="meal-ingredients-add"]');

beforeEach(() => {
  h.destinations = [];
  h.lists = [];
  h.commit.mockReset();
  h.commit.mockResolvedValue({ id: 'new-list' });
  h.logged = [];
  h.mealPlanStoreUsed = false;
});

describe('MealIngredientsPanel', () => {
  it('lines as written with this meal’s count: 5 eating, serves 4 → Cook ×2, (×2) on each', () => {
    const w = mounted(5);
    expect(texts(w)).toEqual([
      '500 g ground beef (×2)',
      '8 taco shells (×2)',
      'Salt, to taste (×2)',
    ]);
    expect(w.find('[data-testid="cook-count-pill"]').text()).toContain('Cook ×2');
    expect(w.text()).toContain('For 5, serves 4');
  });

  it('Cook Once and no suffix when one batch feeds everyone', () => {
    const w = mounted(4);
    expect(texts(w)).toEqual(['500 g ground beef', '8 taco shells', 'Salt, to taste']);
    expect(w.find('[data-testid="cook-count-pill"]').text()).toContain('Cook Once');
  });

  it('no servings: one batch, and says so', () => {
    const w = mounted(5, { ...RECIPE, servings: undefined } as Recipe);
    expect(texts(w)).toEqual(['500 g ground beef', '8 taco shells', 'Salt, to taste']);
    expect(w.text()).toContain('mealPlanner.shopping.noServingsPerMeal');
  });

  it('re-batches as the picker changes, keeping hand edits, added lines and ticks', async () => {
    const w = mounted(5);
    await w.findAll('[data-testid="ingredient-text"]')[1]!.setValue('20 corn tortillas');
    await w.findAllComponents({ name: 'TickButton' })[2]!.vm.$emit('toggle');
    await w.find('[data-testid="ingredient-add"]').setValue('Limes');
    await w.find('[data-testid="ingredient-add"]').trigger('keydown', { key: 'Enter' });
    await w.setProps({ eating: 9 }); // ×3
    expect(texts(w)).toEqual([
      '500 g ground beef (×3)',
      '20 corn tortillas',
      'Salt, to taste (×3)',
      'Limes',
    ]);
    const ticks = w.findAllComponents({ name: 'TickButton' }).map((b) => b.props('selected'));
    expect(ticks).toEqual([true, true, false, true]);
  });

  it('defaults to the newest shopping list, and says so in the summary', () => {
    h.destinations = [
      { id: 'todo', title: 'Chores', emoji: '✅', category: 'home' },
      { id: 'g1', title: 'Weekly Groceries', emoji: '🛒', category: 'out' },
    ];
    h.lists = h.destinations;
    const w = mounted(5);
    expect(w.find('[data-testid="meal-ingredients-dest-toggle"]').text()).toContain(
      'Add to 🛒 Weekly Groceries'
    );
  });

  it('defaults to a New List when there is no shopping list', () => {
    const w = mounted(5);
    expect(w.find('[data-testid="meal-ingredients-dest-toggle"]').text()).toContain(
      'lists.destination.addToNew'
    );
  });

  it('the summary opens the destination control, with aria-expanded', async () => {
    const w = mounted(5);
    const toggle = w.find('[data-testid="meal-ingredients-dest-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(w.findComponent({ name: 'ShoppingListDestination' }).exists()).toBe(false);
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(w.findComponent({ name: 'ShoppingListDestination' }).exists()).toBe(true);
  });

  it('🔴 Add writes on its own, linked to the recipe, and never touches the meal', async () => {
    const w = mounted(5);
    expect(addBtn(w).text()).toBe('Add 3');
    await addBtn(w).trigger('click');
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.commit.mock.calls[0]![0]).toMatchObject({
      kind: 'meal',
      linkedRecipeId: 'r1',
      titles: ['500 g ground beef (×2)', '8 taco shells (×2)', 'Salt, to taste (×2)'],
      headingsSkipped: 1,
      sections: 1,
      destination: { mode: 'new', ownerId: 'm1' },
    });
    expect(h.mealPlanStoreUsed).toBe(false);
  });

  it('🔴 after Add it points at the list written and reads Added, so a second tap makes no second list', async () => {
    const w = mounted(5);
    await addBtn(w).trigger('click');
    await flushPromises();
    expect(addBtn(w).text()).toBe('lists.destination.added');
    expect(addBtn(w).attributes('disabled')).toBeDefined();
    await addBtn(w).trigger('click');
    expect(h.commit).toHaveBeenCalledOnce();
    // A change re-arms it, now adding to the list just made.
    await w.findAllComponents({ name: 'TickButton' })[0]!.vm.$emit('toggle');
    expect(addBtn(w).text()).toBe('Add 2');
    await addBtn(w).trigger('click');
    expect(h.commit.mock.calls[1]![0]).toMatchObject({
      destination: { mode: 'existing', listId: 'new-list' },
    });
  });

  it('🔴 a change made while the write is in flight is not marked Added', async () => {
    let resolve!: (v: unknown) => void;
    h.commit.mockImplementation(() => new Promise((r) => (resolve = r)));
    const w = mounted(5); // ×2
    await addBtn(w).trigger('click');
    expect(h.commit.mock.calls[0]![0]).toMatchObject({
      titles: ['500 g ground beef (×2)', '8 taco shells (×2)', 'Salt, to taste (×2)'],
    });
    await w.setProps({ eating: 9 }); // ×3 while the write is pending
    resolve({ id: 'new-list' });
    await flushPromises();
    expect(texts(w)).toEqual([
      '500 g ground beef (×3)',
      '8 taco shells (×3)',
      'Salt, to taste (×3)',
    ]);
    expect(addBtn(w).text()).toBe('Add 3');
    expect(addBtn(w).attributes('disabled')).toBeUndefined();
    // Still pointed at the list just written, so the re-Add appends rather than making another.
    await addBtn(w).trigger('click');
    expect(h.commit.mock.calls[1]![0]).toMatchObject({
      destination: { mode: 'existing', listId: 'new-list' },
      titles: ['500 g ground beef (×3)', '8 taco shells (×3)', 'Salt, to taste (×3)'],
    });
  });

  it('a failed Add leaves the button ready for a retry', async () => {
    h.commit.mockResolvedValue(null);
    const w = mounted(5);
    await addBtn(w).trigger('click');
    await flushPromises();
    expect(addBtn(w).text()).toBe('Add 3');
  });

  it('is passive: opening the drawer logs no sheet_opened (only an Add logs)', () => {
    mounted(5);
    expect(
      h.logged.some((e) => (e.context as { action?: string })?.action === 'sheet_opened')
    ).toBe(false);
  });

  it('🔴 an unrelated recipe update (same ingredients, new updatedAt) keeps edits and Added', async () => {
    const w = mounted(5);
    await w.findAll('[data-testid="ingredient-text"]')[1]!.setValue('20 corn tortillas');
    await addBtn(w).trigger('click');
    await flushPromises();
    expect(addBtn(w).text()).toBe('lists.destination.added');

    await w.setProps({
      recipe: {
        ...RECIPE,
        name: 'Beef Tacos (renamed)',
        ingredients: [...(RECIPE.ingredients as string[])],
        updatedAt: '2026-09-02T00:00:00.000Z',
      } as Recipe,
    });
    expect(texts(w)).toEqual([
      '500 g ground beef (×2)',
      '20 corn tortillas',
      'Salt, to taste (×2)',
    ]);
    expect(addBtn(w).text()).toBe('lists.destination.added');
    expect(addBtn(w).attributes('disabled')).toBeDefined();
  });

  it('rebuilds the lines when the recipe’s ingredients change', async () => {
    const w = mounted(5);
    await w.findAll('[data-testid="ingredient-text"]')[1]!.setValue('20 corn tortillas');
    await w.setProps({
      recipe: { ...RECIPE, ingredients: ['500 g ground beef', '2 limes'] } as Recipe,
    });
    expect(texts(w)).toEqual(['500 g ground beef (×2)', '2 limes (×2)']);
  });

  it('a servings change re-batches, keeping hand edits', async () => {
    const w = mounted(5);
    await w.findAll('[data-testid="ingredient-text"]')[1]!.setValue('20 corn tortillas');
    await w.setProps({ recipe: { ...RECIPE, servings: '2' } as Recipe }); // 5 / 2 → ×3
    expect(texts(w)).toEqual([
      '500 g ground beef (×3)',
      '20 corn tortillas',
      'Salt, to taste (×3)',
    ]);
  });
});
