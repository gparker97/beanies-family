/**
 * The review sheet (#88). Nothing is created until the user saves — and several ways
 * saving can go wrong.
 *
 * The plan's first draft asserted this feature "adds no new failure mode of its
 * own", on the grounds that the mapper is pure and total. The mapper is; the sheet
 * is not. Each failure-mode test below is one of the modes that claim missed.
 *
 * Since #116 the sheet is the shared checklist + destination + `useShoppingListCommit`
 * (mounted for real here, with the stores mocked), so these tests exercise the sheet
 * end to end. The composable's own suite covers every guard in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const h = vi.hoisted(() => ({
  currentMember: { id: 'm1' } as { id: string } | undefined,
  members: [{ id: 'm1' }, { id: 'm2' }] as Array<{ id: string }>,
  native: true,
  lists: [] as Array<Record<string, unknown>>,
  destinations: [] as Array<Record<string, unknown>>,
  recipes: [{ id: 'r1' }] as Array<{ id: string }>,
  createList: vi.fn(async (_seed: unknown): Promise<unknown> => ({ id: 'new-list' })),
  addItems: vi.fn(async (_id: string, _titles: string[]): Promise<unknown> => ({ id: 'l9' })),
  push: vi.fn(),
  toasts: [] as string[],
  toastOptions: [] as Array<Record<string, unknown> | undefined>,
  reported: [] as Array<Record<string, unknown>>,
  logged: [] as string[],
  loggedKinds: [] as string[],
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    // Keys echo back, EXCEPT the ones whose template the assertions care about —
    // otherwise a test that checks the rendered "1/2" can only check the key name,
    // which would pass even if the numbers were wrong.
    t: (k: string) =>
      ({
        'lists.progress': '{done}/{total}',
        'mealPlanner.shopping.cook.times': 'Cook ×{n}',
        'mealPlanner.shopping.cook.once': 'Cook Once',
        'mealPlanner.shopping.forEating': 'For {n}, serves {s}',
      })[k] ?? k,
  }),
}));
vi.mock('@/composables/useToast', () => ({
  showToast: (kind: string, title: string, _msg?: string, opts?: Record<string, unknown>) => {
    h.toasts.push(`${kind}:${title}`);
    h.toastOptions.push(opts);
  },
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return h.currentMember;
    },
    get members() {
      return h.members;
    },
  }),
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => h.native }));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({ getMemberName: (id: string, fallback: string) => id || fallback }),
}));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get lists() {
      return h.lists;
    },
    get shoppingDestinations() {
      return h.destinations;
    },
    createList: h.createList,
    addItems: h.addItems,
  }),
}));
vi.mock('@/stores/recipesStore', () => ({
  useRecipesStore: () => ({
    get recipes() {
      return h.recipes;
    },
  }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/utils/errorReporter', () => ({
  reportError: (e: Record<string, unknown>) => h.reported.push(e),
}));
vi.mock('@/services/telemetry', () => ({
  logEvent: (e: { context?: { action?: string; kind?: string } }) => {
    h.logged.push(e.context?.action ?? '');
    if (e.context?.action === 'sheet_opened') h.loggedKinds.push(e.context.kind ?? '');
  },
}));

import RecipeListSheet from '../RecipeListSheet.vue';

interface TestRecipe {
  id: string;
  name: string;
  ingredients: string[];
  servings?: string;
}
const RECIPE: TestRecipe = {
  id: 'r1',
  name: 'Pancakes',
  ingredients: ['For the batter:', '2 cups flour', '3 eggs'],
};

function mountSheet(recipe: TestRecipe = RECIPE, extra: { eating?: number; layer?: string } = {}) {
  return mount(RecipeListSheet, {
    props: { open: true, recipe: recipe as never, ...extra } as never,
    global: {
      stubs: {
        BeanieFormModal: {
          name: 'BeanieFormModal',
          props: ['open', 'title', 'saveLabel', 'saveDisabled', 'isSubmitting', 'layer'],
          template: '<div><slot /></div>',
        },
        InferredHint: { name: 'InferredHint', props: ['text'], template: '<p>{{ text }}</p>' },
        // Stubbed: this file is about the SHEET's rules, not the pickers' internals.
        FamilyChipPicker: {
          name: 'FamilyChipPicker',
          props: ['modelValue', 'mode', 'compact'],
          template: '<div />',
        },
        BeanieDatePicker: {
          name: 'BeanieDatePicker',
          props: ['modelValue', 'label', 'placeholder', 'min'],
          template: '<div />',
        },
      },
    },
  });
}

const save = (w: ReturnType<typeof mountSheet>) =>
  w.findComponent({ name: 'BeanieFormModal' }).vm.$emit('save');

beforeEach(() => {
  h.currentMember = { id: 'm1' };
  h.members = [{ id: 'm1' }, { id: 'm2' }];
  h.native = true;
  h.lists = [];
  h.destinations = [];
  h.recipes = [{ id: 'r1' }];
  h.toasts = [];
  h.toastOptions = [];
  h.reported = [];
  h.logged = [];
  h.loggedKinds = [];
  h.createList.mockClear();
  h.createList.mockResolvedValue({ id: 'new-list' });
  h.addItems.mockClear();
  h.addItems.mockResolvedValue({ id: 'l9' });
  h.push.mockClear();
});

const lineTexts = (w: ReturnType<typeof mountSheet>) =>
  w.findAll('[data-testid="ingredient-text"]').map((n) => (n.element as HTMLTextAreaElement).value);
const seedTitles = () =>
  (h.createList.mock.calls[0]![0] as unknown as { items: Array<{ title: string }> }).items.map(
    (i) => i.title
  );

describe('the prefilled checklist', () => {
  it('lists the non-heading lines, in recipe order, at the recipe’s own amounts', () => {
    expect(lineTexts(mountSheet())).toEqual(['2 cups flour', '3 eggs']);
  });

  it('says how many heading lines were skipped, singular and plural', () => {
    // The fixture has exactly one heading, so this also pins that the singular key
    // is chosen — `fillTemplate` is a plain replace with no plural machinery.
    expect(mountSheet().findComponent({ name: 'InferredHint' }).props('text')).toContain(
      'headingsSkipped.one'
    );
    const many = mountSheet({
      ...RECIPE,
      ingredients: ['For the batter:', 'Flour', 'To serve:', 'Syrup'],
    });
    expect(many.findComponent({ name: 'InferredHint' }).props('text')).toContain(
      'headingsSkipped.other'
    );
  });

  it('says nothing when no heading was skipped', () => {
    const w = mountSheet({ ...RECIPE, ingredients: ['Flour'] });
    expect(w.findComponent({ name: 'InferredHint' }).props('text')).toBe('');
  });

  it('creates exactly one list, with the edited, ticked and added lines', async () => {
    const w = mountSheet();
    await w.findAll('[data-testid="ingredient-text"]')[0]!.setValue('3 cups flour');
    // Untick the eggs: we have some.
    await w.findAllComponents({ name: 'TickButton' })[1]!.vm.$emit('toggle');
    await w.find('[data-testid="ingredient-add"]').setValue('Milk');
    await w.find('[data-testid="ingredient-add"]').trigger('keydown', { key: 'Enter' });
    await save(w);
    expect(h.createList).toHaveBeenCalledOnce();
    expect(seedTitles()).toEqual(['3 cups flour', 'Milk']);
  });

  it('🔴 keeps a line the USER types ending in a colon', async () => {
    // The heading rule runs once, at open. Re-running it on save would silently
    // delete input the user deliberately typed.
    const w = mountSheet();
    await w.find('[data-testid="ingredient-add"]').setValue('Marinade:');
    await w.find('[data-testid="ingredient-add"]').trigger('keydown', { key: 'Enter' });
    await save(w);
    expect(seedTitles()).toEqual(['2 cups flour', '3 eggs', 'Marinade:']);
  });

  it('names the list after the recipe when the name is left blank', async () => {
    const w = mountSheet();
    await save(w);
    expect((h.createList.mock.calls[0]![0] as { title: string }).title).toBe(
      'lists.fromRecipe.listTitle'
    );
    expect((h.createList.mock.calls[0]![0] as { linkedRecipeId: string }).linkedRecipeId).toBe(
      'r1'
    );
  });
});

describe('add to a list the family already has (#116)', () => {
  const groceries = {
    id: 'g1',
    title: 'Weekly Groceries',
    emoji: '🛒',
    category: 'out',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    items: [],
  };

  it('appends the ticked lines to the chosen list, and says how many', async () => {
    h.lists = [groceries];
    h.destinations = [groceries];
    h.addItems.mockResolvedValue({ id: 'g1' });
    const w = mountSheet();
    await w.find('[data-testid="destination-existing"]').trigger('click');
    expect(w.findComponent({ name: 'BeanieFormModal' }).props('saveLabel')).toBe(
      'lists.destination.addItems.other'
    );
    await save(w);
    expect(h.createList).not.toHaveBeenCalled();
    expect(h.addItems).toHaveBeenCalledWith('g1', ['2 cups flour', '3 eggs']);
    await flushPromises();
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('is disabled, and says why, when the family has no list to add to', () => {
    const w = mountSheet();
    expect(w.find('[data-testid="destination-existing"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="destination-none"]').exists()).toBe(true);
  });
});

function existingList(over: Record<string, unknown> = {}) {
  return {
    id: 'l9',
    title: 'Shopping for Pancakes',
    emoji: '🛒',
    linkedRecipeId: 'r1',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    items: [{ completed: true }, { completed: false }],
    ...over,
  };
}

describe('review mode — a list already exists', () => {
  it('🔴 does NOT navigate on open; it shows the choice instead', () => {
    // The whole point of the redesign: a button reading "Shopping List" must not
    // silently take the user out of the cookbook.
    h.lists = [existingList()];
    mountSheet();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('shows the ingredients READ-ONLY — no checklist to type into', () => {
    h.lists = [existingList()];
    const w = mountSheet();
    expect(w.find('textarea').exists()).toBe(false);
    expect(w.text()).toContain('2 cups flour');
  });

  it('makes OPENING the primary action', () => {
    h.lists = [existingList()];
    const w = mountSheet();
    expect(w.findComponent({ name: 'BeanieFormModal' }).props('saveLabel')).toBe(
      'lists.fromRecipe.openExisting'
    );
    save(w);
    expect(h.push).toHaveBeenCalledWith({ name: 'Lists', query: { view: 'l9' } });
  });

  it('🔴 marks the ingredients box read-only, in words and in style', () => {
    // greg: "it looks editable". A read-only box that wears the editable box's
    // clothes is worse than no box — so it says so, and it drops the white fill
    // and the 2px border that make an editable one look typeable.
    h.lists = [existingList()];
    const w = mountSheet();
    expect(w.text()).toContain('lists.fromRecipe.readOnly');
    const box = w.find('ul[aria-readonly="true"]');
    expect(box.exists()).toBe(true);
    expect(box.classes().join(' ')).not.toContain('bg-white');
    expect(box.classes()).not.toContain('border-2');
  });

  it('🔴 the read-only look CLEARS when they start another list', () => {
    h.lists = [existingList()];
    const w = mountSheet();
    return w
      .find('[data-testid="recipe-list-start-another"]')
      .trigger('click')
      .then(() => {
        expect(w.find('ul[aria-readonly="true"]').exists()).toBe(false);
        expect(w.find('[data-testid="ingredient-text"]').exists()).toBe(true);
      });
  });

  it('🔴 each existing list carries a visible "open" affordance', () => {
    // It was a button that did not look like one; the row gave no sign it was
    // tappable at all.
    h.lists = [existingList()];
    expect(mountSheet().text()).toContain('lists.embed.open');
  });

  it('shows each list’s progress, so a finished shop is obvious unopened', () => {
    h.lists = [existingList()];
    expect(mountSheet().text()).toContain('1/2');
  });

  it('🔴 reviews a COMPLETED list too — it still answers "have I made one?"', () => {
    h.lists = [existingList({ completed: true })];
    const w = mountSheet();
    expect(w.find('textarea').exists()).toBe(false);
  });

  it('🔴 unlocks editing in place, without navigating or a second modal', async () => {
    h.lists = [existingList()];
    const w = mountSheet();
    await w.find('[data-testid="recipe-list-start-another"]').trigger('click');
    expect(w.find('[data-testid="ingredient-text"]').exists()).toBe(true);
    expect(w.findComponent({ name: 'BeanieFormModal' }).props('saveLabel')).toBe(
      'lists.destination.createList'
    );
    expect(h.push).not.toHaveBeenCalled();
    await save(w);
    expect(h.createList).toHaveBeenCalledOnce();
  });

  it('goes straight to create when no list exists', () => {
    h.lists = [{ id: 'l9', linkedRecipeId: 'other' }];
    const w = mountSheet();
    expect(w.find('[data-testid="ingredient-text"]').exists()).toBe(true);
    expect(w.findComponent({ name: 'BeanieFormModal' }).props('saveLabel')).toBe(
      'lists.destination.createList'
    );
  });
});

describe('failure modes', () => {
  it('🔴 no current member → creates NOTHING, explains, and reports', async () => {
    // A list with a dangling ownerId is worse than a failure the user can retry.
    h.currentMember = undefined;
    const w = mountSheet();
    await save(w);
    expect(h.createList).not.toHaveBeenCalled();
    expect(h.toasts.some((x) => x.startsWith('error:'))).toBe(true);
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]!.severity).toBe('error');
  });

  it('🔴 a double-tap creates exactly ONE list', async () => {
    let release!: (v: unknown) => void;
    h.createList.mockImplementation(() => new Promise<unknown>((r) => (release = r)));
    const w = mountSheet();
    void save(w);
    void save(w);
    release({ id: 'new-list' });
    await w.vm.$nextTick();
    expect(h.createList).toHaveBeenCalledOnce();
  });

  it('🔴 a successful create offers a way to GET to the list', async () => {
    // Before this, a create ended in a message with nowhere to go: the user was
    // told the list existed and left on the recipe with no route to it.
    const w = mountSheet();
    await save(w);
    const opts = h.toastOptions[0];
    expect(opts?.actionLabel).toBe('lists.fromRecipe.view');
    (opts?.actionFn as () => void)();
    expect(h.push).toHaveBeenCalledWith({ name: 'Lists', query: { view: 'new-list' } });
  });

  it('gives the user time to tap it', async () => {
    // An action nobody has time to reach is not an action; `durationMs` exists
    // for exactly this.
    const w = mountSheet();
    await save(w);
    expect(h.toastOptions[0]?.durationMs).toBeGreaterThan(4000);
  });

  it('🔴 a failed create does NOT toast again and does NOT close', async () => {
    // `wrapAsync` has already toasted and reported; a second toast pages twice,
    // and closing would throw away the draft the user just edited.
    h.createList.mockResolvedValue(null);
    const w = mountSheet();
    await save(w);
    expect(h.toasts).toHaveLength(0);
    expect(w.emitted('close')).toBeUndefined();
  });

  it('🔴 a recipe deleted mid-sheet is refused rather than left dangling', async () => {
    h.recipes = [];
    const w = mountSheet();
    await save(w);
    expect(h.createList).not.toHaveBeenCalled();
    expect(h.toasts.some((x) => x.startsWith('error:'))).toBe(true);
    // #116: now reported too, not just toasted, so the race is visible in CloudWatch.
    expect(h.reported[0]!.context).toMatchObject({ action: 'recipe_missing' });
  });

  it('refuses to create an empty list', async () => {
    const w = mountSheet();
    // Every line unticked: nothing to write, and Save says so by being unavailable.
    await w.find('[data-testid="ingredients-toggle-all"]').trigger('click');
    expect(w.findComponent({ name: 'BeanieFormModal' }).props('saveDisabled')).toBe(true);
    await save(w);
    expect(h.createList).not.toHaveBeenCalled();
  });
});

describe('telemetry', () => {
  it('records the open and the create, so the ratio is measurable', async () => {
    const w = mountSheet();
    expect(h.logged).toContain('sheet_opened');
    await save(w);
    expect(h.logged).toContain('list_created');
  });

  it('does not record a create that did not happen', async () => {
    h.createList.mockResolvedValue(null);
    const w = mountSheet();
    await save(w);
    expect(h.logged).not.toContain('list_created');
  });
});

describe('who shops and by when', () => {
  const seedOf = () => h.createList.mock.calls[0][0] as Record<string, unknown>;

  it('defaults the owner to the current member and leaves the date empty', async () => {
    const w = mountSheet();
    await save(w);
    expect(seedOf().ownerId).toBe('m1');
    // 🔴 No default due date. A due date arms a reminder, so defaulting one would
    // notify a family about a deadline they never set.
    expect(Object.keys(seedOf())).not.toContain('dueDate');
  });

  it('creates the list for the member the user picked', async () => {
    const w = mountSheet();
    await w.findComponent({ name: 'FamilyChipPicker' }).vm.$emit('update:modelValue', 'm2');
    await save(w);
    expect(seedOf().ownerId).toBe('m2');
    // 🔴 …but the CREATOR is still whoever is standing here. The `list-completed`
    // bell entry fires for the creator when someone else finishes their list.
    expect(seedOf().createdBy).toBe('m1');
  });

  it('carries the chosen due date through to the seed', async () => {
    const w = mountSheet();
    await w.findComponent({ name: 'BeanieDatePicker' }).vm.$emit('update:modelValue', '2026-09-20');
    await save(w);
    expect(seedOf().dueDate).toBe('2026-09-20');
  });

  it('says what the due date will do, and only once one is set', async () => {
    const w = mountSheet();
    const hints = () => w.findAllComponents({ name: 'InferredHint' });
    // Two hints render: the skipped-headings one, then the due-date one.
    expect(hints().at(-1)!.props('text')).toBe('');
    await w.findComponent({ name: 'BeanieDatePicker' }).vm.$emit('update:modelValue', '2026-09-20');
    expect(hints().at(-1)!.props('text')).toContain('dueHint');
  });

  it('uses ONE wording on every platform', async () => {
    // The hint used to split native vs web, because off-native no OS reminder is
    // armed. Lists now file a `list-due` bell entry too, and the drawer works
    // everywhere, so the promise holds on both and the split is gone.
    h.native = false;
    const w = mountSheet();
    await w.findComponent({ name: 'BeanieDatePicker' }).vm.$emit('update:modelValue', '2026-09-20');
    expect(w.findAllComponents({ name: 'InferredHint' }).at(-1)!.props('text')).toContain(
      'lists.fromRecipe.dueHint'
    );
  });

  it('🔴 puts NO floor on the due date, so "today" is selectable', async () => {
    // This shipped broken. A `:min` was added here (and nowhere else) on the
    // reasoning that a past date arms no reminder — but it was computed with
    // `toISODateString`, which returns a full ISO TIMESTAMP despite its name, and
    // `BeanieDatePicker` compares `min` to a `YYYY-MM-DD` lexicographically:
    // '2026-09-13' < '2026-09-13T06:05:52.123Z' is TRUE, so today and every past
    // day were disabled while tomorrow onwards worked.
    //
    // The floor is gone rather than corrected: a list due today is the most common
    // case of all, back-dating is legitimate, and `ListDetailModal` — the same
    // field on the other surface — has never had one.
    const w = mountSheet();
    expect(w.findComponent({ name: 'BeanieDatePicker' }).props('min')).toBeFalsy();
  });

  it('accepts today as a due date, end to end', async () => {
    // The user-facing assertion, independent of how the floor is implemented.
    const today = new Date().toISOString().slice(0, 10);
    const w = mountSheet();
    await w.findComponent({ name: 'BeanieDatePicker' }).vm.$emit('update:modelValue', today);
    await save(w);
    expect((h.createList.mock.calls[0][0] as Record<string, unknown>).dueDate).toBe(today);
  });

  it('🔴 renders exactly ONE label for the date field', async () => {
    // BeanieDatePicker renders its own visible <label> from `:label`; a sibling
    // <p> stacked the same words twice in two faces and announced it twice.
    const w = mountSheet();
    const labels = w.findAll('p, label').map((n) => n.text());
    expect(labels.filter((x) => x.includes('dueDateLabel'))).toHaveLength(0);
    expect(w.findComponent({ name: 'BeanieDatePicker' }).props('label')).toBe(
      'lists.detail.dueDateLabel'
    );
  });

  // The "owner left the family mid-sheet" race is no longer the sheet's to check:
  // `listStore.createList` refuses an unresolved owner for every caller, with its own
  // toast and report (`lists` / `create_unknown_owner`), covered in `listStore.test.ts`
  // ("refuses to create a list whose owner is not in the family").

  it('🔴 resets owner and due date when reopened for another recipe', async () => {
    const w = mountSheet();
    await w.findComponent({ name: 'FamilyChipPicker' }).vm.$emit('update:modelValue', 'm2');
    await w.findComponent({ name: 'BeanieDatePicker' }).vm.$emit('update:modelValue', '2026-09-20');
    // The sheet instance is reused across recipes; inheriting the last one's due
    // date would schedule a reminder for a shop the user never dated.
    await w.setProps({ open: false });
    await w.setProps({ open: true, recipe: { ...RECIPE, id: 'r1', name: 'Waffles' } as never });
    await save(w);
    expect(seedOf().ownerId).toBe('m1');
    expect(Object.keys(seedOf())).not.toContain('dueDate');
  });
});

describe('one meal: the `eating` prop (#116)', () => {
  const TACOS: TestRecipe = {
    id: 'r1',
    name: 'Beef Tacos',
    servings: '4',
    ingredients: ['For the filling:', '500 g ground beef', '8 taco shells'],
  };
  const pill = (w: ReturnType<typeof mountSheet>) => w.find('[data-testid="cook-count-pill"]');

  it('5 eating, serves 4: Cook ×2, (×2) on each line, logged and written as a meal', async () => {
    const w = mountSheet(TACOS, { eating: 5 });
    expect(lineTexts(w)).toEqual(['500 g ground beef (×2)', '8 taco shells (×2)']);
    expect(pill(w).text()).toContain('Cook ×2');
    expect(w.text()).toContain('For 5, serves 4');
    expect(h.loggedKinds).toEqual(['meal']);
    await save(w);
    expect(seedTitles()).toEqual(['500 g ground beef (×2)', '8 taco shells (×2)']);
    expect(h.logged).toContain('list_created');
  });

  it('one batch: Cook Once and no suffix', () => {
    const w = mountSheet(TACOS, { eating: 4 });
    expect(lineTexts(w)).toEqual(['500 g ground beef', '8 taco shells']);
    expect(pill(w).text()).toContain('Cook Once');
  });

  it('no servings: one batch, and says so', () => {
    const w = mountSheet({ ...TACOS, servings: undefined }, { eating: 5 });
    expect(lineTexts(w)).toEqual(['500 g ground beef', '8 taco shells']);
    expect(w.text()).toContain('mealPlanner.shopping.noServingsPerMeal');
  });

  it('review mode shows the same batched lines a new list would contain', () => {
    h.lists = [existingList()];
    const w = mountSheet(TACOS, { eating: 5 });
    expect(w.find('textarea').exists()).toBe(false);
    expect(w.find('ul[aria-readonly="true"]').text()).toContain('500 g ground beef (×2)');
  });

  it('forwards the stacking layer to the modal', () => {
    const w = mountSheet(TACOS, { eating: 5, layer: 'overlay' });
    expect(w.findComponent({ name: 'BeanieFormModal' }).props('layer')).toBe('overlay');
  });

  it('without `eating` nothing changes: x1, kind recipe, no pill', async () => {
    const w = mountSheet(TACOS);
    expect(lineTexts(w)).toEqual(['500 g ground beef', '8 taco shells']);
    expect(pill(w).exists()).toBe(false);
    expect(h.loggedKinds).toEqual(['recipe']);
    expect(w.findComponent({ name: 'BeanieFormModal' }).props('layer')).toBe('base');
  });
});
