/**
 * The week's shopping list (#116): one section per recipe, ingredients as written with a
 * Cook ×N count and (×N) suffixes, identical lines merged at open into "In More Than One
 * Meal", ✨ Find Duplicates (the AI call mocked at `useFindDuplicates`), Split, then one
 * save through the shared commit.
 *
 * The fixture is the plan's acceptance week in a family of five: Tikka (Mon, 4 picked,
 * serves 4), Tacos (Tue 3 picked + 2 guests, Fri 3 picked, "Serves 4") and a Thu stir-fry
 * with nobody picked (everyone, serves 4) → Cook Once, Cook ×3 and Cook ×2. Tikka and the
 * stir-fry share "1 cup basmati rice" (×1 + ×2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

type FindResult = { status: string; groups: Array<{ name: string; lineIds: string[] }> };

const h = vi.hoisted(() => ({
  meals: [] as Array<Record<string, unknown>>,
  recipes: [] as Array<Record<string, unknown>>,
  destinations: [] as Array<Record<string, unknown>>,
  commit: vi.fn(async (_args: unknown): Promise<unknown> => ({ id: 'new-list' })),
  logged: [] as Array<Record<string, unknown>>,
  lang: 'en' as 'en' | 'zh',
  canReadAny: true,
  isConfigured: true,
  tier: 'managed' as 'managed' | 'byok',
  find: vi.fn(),
  running: { value: false },
  toasts: [] as Array<{ title: string; options?: { actionLabel?: string; actionFn?: () => void } }>,
}));

vi.mock('@/composables/useToast', () => ({
  showToast: (_type: string, title: string, _msg?: string, options?: Record<string, unknown>) =>
    h.toasts.push({ title, options: options as never }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      ({
        'mealPlanner.shopping.subtitle': 'Week of {date}, {recipes}, {meals}',
        'mealPlanner.shopping.recipes.other': '{n} recipes',
        'mealPlanner.shopping.meals.other': '{n} meals',
        'mealPlanner.shopping.listTitle': 'Shopping for {date}',
        'mealPlanner.shopping.eatingPill': '{day}, {n} Eating',
        'mealPlanner.shopping.everyonePill': '{day}, Everyone ({n})',
        'mealPlanner.shopping.cook.times': 'Cook ×{n}',
        'mealPlanner.shopping.cook.once': 'Cook Once',
        'mealPlanner.shopping.dupes.found.other': '{n} found',
        'mealPlanner.shopping.dupes.found.one': '1 found',
        'ingredients.splitAria': 'Split {item}',
        'mealPlanner.shopping.dupes.splitDone': 'Split into {n} lines',
        'recipes.servesN': 'Serves {n}',
        'lists.destination.addItems.other': 'Add {n} Items',
      })[k] ?? k,
  }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({
    get currentLanguage() {
      return h.lang;
    },
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    currentMember: { id: 'a' },
    humans: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })),
  }),
}));
vi.mock('@/stores/mealPlanStore', () => ({
  useMealPlanStore: () => ({ mealsForWeek: () => h.meals }),
}));
vi.mock('@/stores/recipesStore', () => ({
  useRecipesStore: () => ({
    get recipes() {
      return h.recipes;
    },
  }),
}));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get shoppingDestinations() {
      return h.destinations;
    },
  }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({ getMemberName: (id: string) => id }),
}));
vi.mock('@/services/telemetry', () => ({
  logEvent: (e: Record<string, unknown>) => h.logged.push(e),
}));
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (e: Record<string, unknown>) => h.logged.push(e),
}));
vi.mock('@/composables/useMagicReader', async () => {
  const { computed } = await import('vue');
  return { useMagicReader: () => ({ canReadAny: computed(() => h.canReadAny) }) };
});
vi.mock('@/composables/useAiCapability', async () => {
  const { computed } = await import('vue');
  return {
    useAiCapability: () => ({
      isConfigured: computed(() => h.isConfigured),
      tier: computed(() => h.tier),
    }),
  };
});
vi.mock('@/composables/useFindDuplicates', async () => {
  const { ref } = await import('vue');
  const running = ref(false);
  return {
    useFindDuplicates: () => {
      h.running = running;
      return { running, find: h.find };
    },
  };
});
vi.mock('@/composables/useShoppingListCommit', async (orig) => {
  const { ref } = await import('vue');
  return {
    ...(await orig<typeof import('@/composables/useShoppingListCommit')>()),
    useShoppingListCommit: () => ({ commit: h.commit, isSubmitting: ref(false) }),
  };
});

// The real reducer, wrapped so a test can see whether the candidate walk ran at all.
vi.mock('@/utils/shoppingMerge', async (orig) => {
  const actual = await orig<typeof import('@/utils/shoppingMerge')>();
  return { ...actual, dedupeCandidates: vi.fn(actual.dedupeCandidates) };
});
import { dedupeCandidates } from '@/utils/shoppingMerge';

import MealWeekShoppingDrawer from '../MealWeekShoppingDrawer.vue';

const recipe = (id: string, name: string, servings: string, ingredients: string[]) => ({
  id,
  name,
  servings,
  ingredients,
  steps: [],
  createdAt: 'x',
  updatedAt: 'x',
});
const meal = (date: string, recipeId: string, eaters?: string[], extra = {}) => ({
  id: `${date}-${recipeId}`,
  kind: 'recipe',
  recipeId,
  date,
  slot: 'dinner',
  eaterMemberIds: eaters,
  ...extra,
});

// 2026-09-28 is a Monday.
const WEEK = [
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
];

function mounted() {
  return mount(MealWeekShoppingDrawer, {
    props: { open: true, weekDates: WEEK },
    attachTo: document.body,
    global: {
      stubs: {
        BeanieFormModal: {
          name: 'BeanieFormModal',
          props: ['open', 'title', 'saveLabel', 'saveDisabled', 'isSubmitting'],
          template: '<div><slot /></div>',
        },
        FamilyChipPicker: { props: ['modelValue', 'mode', 'compact'], template: '<div />' },
        BeanieDatePicker: { props: ['modelValue', 'label', 'placeholder'], template: '<div />' },
      },
    },
  });
}
type W = ReturnType<typeof mounted>;
const modal = (w: W) => w.findComponent({ name: 'BeanieFormModal' });
const save = (w: W) => modal(w).vm.$emit('save');
const sections = (w: W) => w.findAll('[data-testid="week-shopping-section"]');
const texts = (el: { findAll: W['findAll'] }) =>
  el
    .findAll('[data-testid="ingredient-text"]')
    .map((n) => (n.element as HTMLTextAreaElement).value);
const merged = (w: W) => w.find('[data-testid="week-shopping-merged"]');
const card = (w: W) => w.find('[data-testid="find-duplicates"]');
const actions = () => h.logged.map((e) => (e.context as { action?: string })?.action);

beforeEach(() => {
  h.recipes = [
    recipe('tikka', 'Chicken Tikka Masala', '4', ['600 g chicken thighs', '1 cup basmati rice']),
    recipe('tacos', 'Beef Tacos', 'Serves 4', [
      'For the filling:',
      '500 g ground beef',
      '8 taco shells',
    ]),
    recipe('stir', 'Veggie Stir-Fry', '4', ['2 green bell peppers', '1 cup basmati rice']),
    recipe('bolo', 'Bolognese', '4', ['250 g lean ground beef']),
  ];
  h.meals = [
    meal('2026-09-28', 'tikka', ['a', 'b', 'c', 'd']),
    meal('2026-09-29', 'tacos', ['a', 'b', 'c'], { guestNames: ['Nan', 'Pop'] }),
    meal('2026-09-30', 'gone', ['a']), // recipe deleted: ignored
    { id: 'out', kind: 'eat_out', date: '2026-09-30', slot: 'dinner' }, // not a recipe: ignored
    meal('2026-10-01', 'stir'), // nobody picked: everyone (5)
    meal('2026-10-02', 'tacos', ['a', 'b', 'c']),
  ];
  h.destinations = [];
  h.commit.mockReset();
  h.commit.mockResolvedValue({ id: 'new-list' });
  h.logged = [];
  h.lang = 'en';
  h.canReadAny = true;
  h.isConfigured = true;
  h.tier = 'managed';
  h.find.mockReset();
  h.find.mockResolvedValue({ status: 'done', groups: [] } satisfies FindResult);
  h.toasts = [];
});

describe('MealWeekShoppingDrawer', () => {
  it('one section per recipe, in first-served order, with the week in the subtitle', () => {
    const w = mounted();
    expect(sections(w).map((s) => s.find('h3').text())).toEqual([
      'Chicken Tikka Masala',
      'Beef Tacos',
      'Veggie Stir-Fry',
    ]);
    expect(w.find('[data-testid="week-shopping-subtitle"]').text()).toBe(
      'Week of Sep 28, 3 recipes, 4 meals'
    );
  });

  it('Cook Once, Cook ×3 and Cook ×2 ("Thu, Everyone (5)"), with a pill per meal', () => {
    const w = mounted();
    const [tikka, tacos, stir] = sections(w);
    expect(tikka!.find('[data-testid="cook-count-pill"]').text()).toContain('Cook Once');
    expect(tikka!.text()).toContain('Serves 4');
    expect(tacos!.find('[data-testid="cook-count-pill"]').text()).toContain('Cook ×3');
    expect(tacos!.findAll('[data-testid="meal-pill"]').map((p) => p.text())).toEqual([
      'Tue, 5 Eating',
      'Fri, 3 Eating',
    ]);
    expect(stir!.find('[data-testid="cook-count-pill"]').text()).toContain('Cook ×2');
    expect(stir!.find('[data-testid="meal-pill"]').text()).toBe('Thu, Everyone (5)');
  });

  it('lines exactly as written: every Tacos line ends in (×3), Tikka lines have no suffix', () => {
    const w = mounted();
    const [tikka, tacos, stir] = sections(w);
    expect(texts(tikka!)).toEqual(['600 g chicken thighs']);
    expect(texts(tacos!)).toEqual(['500 g ground beef (×3)', '8 taco shells (×3)']);
    expect(texts(stir!)).toEqual(['2 green bell peppers (×2)']);
  });

  it('identical lines merge at open: 1 cup basmati rice ×1 + ×2 → (×3), with both recipes', () => {
    const w = mounted();
    expect(texts(merged(w))).toEqual(['1 cup basmati rice (×3)']);
    expect(
      merged(w)
        .findAll('[data-testid="merged-source-pill"]')
        .map((p) => p.text())
    ).toEqual(['Chicken Tikka Masala', 'Veggie Stir-Fry']);
    // Exact merges carry no ✨, and the merged section offers no "Add an item".
    expect(merged(w).find('[data-testid="merged-by-magic"]').exists()).toBe(false);
    expect(merged(w).find('[data-testid="ingredient-add"]').exists()).toBe(false);
  });

  it('Split puts the lines back into their recipes, and is logged', async () => {
    const w = mounted();
    await merged(w).find('[data-testid="merged-split"]').trigger('click');
    expect(merged(w).exists()).toBe(false);
    const [tikka, , stir] = sections(w);
    expect(texts(tikka!)).toEqual(['600 g chicken thighs', '1 cup basmati rice']);
    expect(texts(stir!)).toEqual(['2 green bell peppers (×2)', '1 cup basmati rice (×2)']);
    const split = h.logged.find((e) => (e.context as { action?: string }).action === 'split');
    expect(split).toMatchObject({ surface: 'meal-shopping-dupes', context: { kind: 'exact' } });
  });

  it('Split offers Undo in the house toast, which puts the merged line back exactly', async () => {
    const w = mounted();
    await merged(w).find('[data-testid="merged-split"]').trigger('click');
    expect(merged(w).exists()).toBe(false);
    const toast = h.toasts.at(-1)!;
    expect(toast.title).toBe('Split into 2 lines');
    expect(toast.options!.actionLabel).toBe('action.undo');
    toast.options!.actionFn!();
    await flushPromises();
    expect(texts(merged(w))).toEqual(['1 cup basmati rice (×3)']);
    expect(texts(sections(w)[0]!)).toEqual(['600 g chicken thighs']);
    expect(actions()).toContain('undo_split');
  });

  it('Undo is skipped (and logged) when a part was edited after the Split', async () => {
    const w = mounted();
    await merged(w).find('[data-testid="merged-split"]').trigger('click');
    const rice = sections(w)[0]!.findAll('[data-testid="ingredient-text"]')[1]!;
    await rice.setValue('2 cups brown rice');
    h.toasts.at(-1)!.options!.actionFn!();
    await flushPromises();
    expect(merged(w).exists()).toBe(false);
    expect(texts(sections(w)[0]!)).toContain('2 cups brown rice');
    const skipped = h.logged.find(
      (e) => (e.context as { action?: string }).action === 'undo_split_skipped'
    );
    expect(skipped!.context).toMatchObject({ stage: 'changed', kind: 'exact' });
  });

  it('Undo after the drawer was closed is skipped', async () => {
    const w = mounted();
    await merged(w).find('[data-testid="merged-split"]').trigger('click');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    h.toasts.at(-1)!.options!.actionFn!();
    const skipped = h.logged.find(
      (e) => (e.context as { action?: string }).action === 'undo_split_skipped'
    );
    expect(skipped!.context).toMatchObject({ stage: 'closed' });
  });

  it('Split has an accessible name naming the line', () => {
    const w = mounted();
    expect(merged(w).find('[data-testid="merged-split"]').attributes('aria-label')).toBe(
      'Split 1 cup basmati rice (×3)'
    );
  });

  it('a section whose every line was merged collapses to its header', () => {
    h.recipes = [recipe('x', 'X', '4', ['salt']), recipe('y', 'Y', '4', ['Salt', 'pepper'])];
    h.meals = [meal('2026-09-28', 'x', ['a']), meal('2026-09-29', 'y', ['a'])];
    const w = mounted();
    expect(sections(w)[0]!.find('[data-testid="ingredients-all-merged"]').exists()).toBe(true);
    expect(texts(merged(w))).toEqual(['salt (×2)']); // a merged exact line is always ≥ ×2
  });

  it('saves merged lines + every ticked section line, never a merged part twice', async () => {
    const w = mounted();
    await save(w);
    expect(h.commit).toHaveBeenCalledOnce();
    const args = h.commit.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      kind: 'week',
      sections: 3,
      headingsSkipped: 1,
      defaultTitle: 'Shopping for Sep 28',
      destination: { mode: 'new', ownerId: 'a', dueDate: '' },
    });
    expect(args.linkedRecipeId).toBeUndefined();
    expect(args.titles).toEqual([
      '1 cup basmati rice (×3)',
      '600 g chicken thighs',
      '500 g ground beef (×3)',
      '8 taco shells (×3)',
      '2 green bell peppers (×2)',
    ]);
    await flushPromises();
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('Create List by default; "Add N Items" once a list is picked; a section’s Untick All counts', async () => {
    h.destinations = [
      { id: 'g1', title: 'Weekly Groceries', emoji: '🛒', category: 'out', items: [] },
    ];
    const w = mounted();
    expect(modal(w).props('saveLabel')).toBe('lists.destination.createList');
    await w.find('[data-testid="destination-existing"]').trigger('click');
    expect(modal(w).props('saveLabel')).toBe('Add 5 Items');
    await sections(w)[1]!.find('[data-testid="ingredients-toggle-all"]').trigger('click');
    expect(modal(w).props('saveLabel')).toBe('Add 3 Items');
  });

  it('stays open when the save did not happen', async () => {
    h.commit.mockResolvedValue(null);
    const w = mounted();
    await save(w);
    await flushPromises();
    expect(w.emitted('close')).toBeUndefined();
  });

  it('records the offer: sections, lines and how many exact merges were made', () => {
    mounted();
    expect(h.logged[0]!.context).toEqual({
      action: 'sheet_opened',
      kind: 'week',
      count: 3,
      ingredient_count: 6,
      inferred_count: 1,
    });
  });

  it('dates follow the UI language, not English only', () => {
    h.lang = 'zh';
    const w = mounted();
    expect(sections(w)[1]!.text()).toContain('周二, 5 Eating');
    expect(w.find('[data-testid="week-shopping-subtitle"]').text()).toContain('9月28日');
  });

  it('no servings: one batch per meal, and says so', () => {
    h.recipes = [recipe('soup', 'Soup', '', ['1 onion']), recipe('pie', 'Pie', '', ['1 egg'])];
    h.meals = [
      meal('2026-09-28', 'soup', ['a']),
      meal('2026-09-30', 'soup', ['a']),
      meal('2026-09-30', 'pie', ['a']),
    ];
    const w = mounted();
    const soup = sections(w)[0]!;
    expect(soup.find('[data-testid="cook-count-pill"]').text()).toContain('Cook ×2');
    expect(soup.text()).toContain('mealPlanner.shopping.noServingsPerMeal');
  });

  describe('✨ Find Duplicates', () => {
    it('shows with 2+ recipes and AI available, with "Free" on the managed tier only', async () => {
      const w = mounted();
      expect(card(w).exists()).toBe(true);
      expect(card(w).text()).toContain('mealPlanner.shopping.dupes.find');
      expect(w.find('[data-testid="find-duplicates-free"]').exists()).toBe(true);
      h.tier = 'byok';
      const byok = mounted();
      expect(byok.find('[data-testid="find-duplicates"]').exists()).toBe(true);
      expect(byok.find('[data-testid="find-duplicates-free"]').exists()).toBe(false);
    });

    it.each([
      ['no magic beans reader for this member', () => (h.canReadAny = false)],
      ['AI not configured', () => (h.isConfigured = false)],
      [
        'only one recipe',
        () => {
          h.meals = [meal('2026-09-28', 'tikka', ['a'])];
        },
      ],
    ])('no card at all when %s (identical lines still merge)', (_label, arrange) => {
      arrange();
      vi.mocked(dedupeCandidates).mockClear();
      const w = mounted();
      expect(card(w).exists()).toBe(false);
      // Gated before the lines are walked, so an edit or tick never pays for a walk nobody uses.
      expect(dedupeCandidates).not.toHaveBeenCalled();
      w.unmount();
    });

    it('sends only unmerged lines (source text, no suffix) under opaque ids', async () => {
      const w = mounted();
      await card(w).trigger('click');
      expect(h.find).toHaveBeenCalledOnce();
      const [payload, controller] = h.find.mock.calls[0]!;
      expect(payload).toEqual([
        { id: 'L1', text: '600 g chicken thighs' },
        { id: 'L2', text: '500 g ground beef' },
        { id: 'L3', text: '8 taco shells' },
        { id: 'L4', text: '2 green bell peppers' },
      ]);
      expect(controller).toBeInstanceOf(AbortController);
      // Nothing was left out for the byte bound; find_started reports it as inferred_count.
      expect(h.find.mock.calls[0]![2]).toEqual({ skipped: 0 });
    });

    it('builds the payload at tap time only, never on render or edits', async () => {
      vi.mocked(dedupeCandidates).mockClear();
      const w = mounted();
      expect(card(w).exists()).toBe(true);
      await sections(w)[1]!.find('[data-testid="ingredients-toggle-all"]').trigger('click');
      expect(dedupeCandidates).not.toHaveBeenCalled();
      await card(w).trigger('click');
      expect(dedupeCandidates).toHaveBeenCalledOnce();
      w.unmount();
    });

    it('done: merges the groups, the card goes, "✨ N found" is shown, focus moves and reads it once', async () => {
      h.recipes.push(recipe('bolo', 'Bolognese', '4', ['250 g lean ground beef']));
      h.meals.push(meal('2026-10-03', 'bolo', ['a', 'b', 'c', 'd', 'e'])); // ×2
      h.find.mockResolvedValue({
        status: 'done',
        groups: [
          { name: 'Ground beef', lineIds: ['L2', 'L5'] },
          { name: 'Bogus', lineIds: ['L1', 'L99'] },
        ],
      });
      const w = mounted();
      await card(w).trigger('click');
      await flushPromises();
      expect(texts(merged(w))).toEqual([
        '1 cup basmati rice (×3)',
        'Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)',
      ]);
      expect(merged(w).findAll('[data-testid="merged-by-magic"]')).toHaveLength(1);
      expect(card(w).exists()).toBe(false);
      expect(w.find('[data-testid="dupes-found"]').text()).toContain('1 found');
      const header = w.find('[data-testid="week-shopping-merged-title"]');
      expect(document.activeElement).toBe(header.element);
      // The focused header carries "1 found", so the live region stays quiet: one read, not two.
      expect(header.text()).toContain('1 found');
      expect(w.find('[data-testid="dupes-announce"]').text()).toBe('');
      expect(w.find('[data-testid="dupes-announce"]').attributes('aria-live')).toBe('polite');
      expect(header.classes()).toEqual(
        expect.arrayContaining(['focus-visible:ring-2', 'focus-visible:ring-[#AED6F1]'])
      );
      const applied = h.logged.find(
        (e) => (e.context as { action?: string }).action === 'groups_applied'
      );
      expect(applied!.context).toMatchObject({ count: 1, inferred_count: 1 });
      // Bolognese's only line went into the merge.
      expect(sections(w)[3]!.find('[data-testid="ingredients-all-merged"]').exists()).toBe(true);
      w.unmount();
    });

    it('done with nothing new: a quiet "No other duplicates" tile, which takes focus', async () => {
      const w = mounted();
      // The fixture's exact rice merge puts a merged header on screen too; focus must still go
      // to the tile that replaced the card, not to that header.
      expect(merged(w).exists()).toBe(true);
      await card(w).trigger('click');
      await flushPromises();
      expect(card(w).exists()).toBe(false);
      expect(w.find('[data-testid="dupes-none"]').text()).toContain(
        'mealPlanner.shopping.dupes.none'
      );
      const tile = w.find('[data-testid="dupes-none"]');
      expect(document.activeElement).toBe(tile.element);
      // Focus reads the tile; the live region does not repeat it.
      expect(w.find('[data-testid="dupes-announce"]').text()).toBe('');
      // outline-none, so the ring is what shows where focus went (both modes).
      expect(tile.classes()).toEqual(
        expect.arrayContaining([
          'focus-visible:ring-2',
          'focus-visible:ring-[#AED6F1]',
          'dark:focus-visible:ring-offset-surface-raised',
        ])
      );
      w.unmount();
    });

    it.each(['failed', 'declined', 'offline'])(
      '%s: the card stays for another tap',
      async (status) => {
        h.find.mockResolvedValue({ status, groups: [] });
        const w = mounted();
        await card(w).trigger('click');
        await flushPromises();
        expect(card(w).exists()).toBe(true);
        expect(w.find('[data-testid="dupes-none"]').exists()).toBe(false);
        expect(actions()).not.toContain('groups_applied');
      }
    );

    it('closing the drawer aborts the run and drops its late answer', async () => {
      let resolve!: (v: FindResult) => void;
      h.find.mockImplementation(() => new Promise((r) => (resolve = r)));
      const w = mounted();
      await card(w).trigger('click');
      const controller = h.find.mock.calls[0]![1] as AbortController;
      await w.setProps({ open: false });
      expect(controller.signal.aborted).toBe(true);
      resolve({ status: 'done', groups: [{ name: 'Beef', lineIds: ['L2', 'L4'] }] });
      await flushPromises();
      expect(actions()).not.toContain('groups_applied');
      // Reopening starts fresh, with a new run token.
      await w.setProps({ open: true });
      expect(card(w).exists()).toBe(true);
      await card(w).trigger('click');
      expect(h.find.mock.calls[1]![1]).not.toBe(controller);
    });

    it('busy: the card works visibly (sweep, sparks, fast sheen) and a second tap does nothing', async () => {
      h.find.mockImplementation(() => new Promise(() => {}));
      const w = mounted();
      await card(w).trigger('click');
      h.running.value = true;
      await flushPromises();
      const label = w.find('[data-testid="find-duplicates-running"]');
      expect(label.text()).toBe('mealPlanner.shopping.dupes.running');
      expect(label.classes()).toContain('magic-text-shimmer');
      expect(w.find('[data-testid="find-duplicates-sparkle"]').classes()).toContain(
        'magic-sparkle'
      );
      expect(card(w).classes()).toContain('magic-shimmer-busy');
      expect(card(w).attributes('aria-busy')).toBe('true');
      await card(w).trigger('click');
      expect(h.find).toHaveBeenCalledOnce();
      h.running.value = false;
    });
  });
});
