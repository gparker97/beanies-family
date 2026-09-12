/**
 * The review sheet (#88). Nothing is created until the user saves — and four ways
 * saving can go wrong.
 *
 * The plan's first draft asserted this feature "adds no new failure mode of its
 * own", on the grounds that the mapper is pure and total. The mapper is; the sheet
 * is not. Each test below is one of the modes that claim missed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

const h = vi.hoisted(() => ({
  currentMember: { id: 'm1' } as { id: string } | undefined,
  lists: [] as Array<Record<string, unknown>>,
  recipes: [{ id: 'r1' }] as Array<{ id: string }>,
  createList: vi.fn(async (_seed: unknown): Promise<unknown> => ({ id: 'new-list' })),
  push: vi.fn(),
  toasts: [] as string[],
  reported: [] as Array<Record<string, unknown>>,
  logged: [] as string[],
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({
  showToast: (kind: string, title: string) => h.toasts.push(`${kind}:${title}`),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return h.currentMember;
    },
  }),
}));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get lists() {
      return h.lists;
    },
    createList: h.createList,
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
  logEvent: (e: { context?: { action?: string } }) => h.logged.push(e.context?.action ?? ''),
}));

import RecipeListSheet from '../RecipeListSheet.vue';

interface TestRecipe {
  id: string;
  name: string;
  ingredients: string[];
}
const RECIPE: TestRecipe = {
  id: 'r1',
  name: 'Pancakes',
  ingredients: ['For the batter:', '2 cups flour', '3 eggs'],
};

function mountSheet(recipe: TestRecipe = RECIPE) {
  return mount(RecipeListSheet, {
    props: { open: true, recipe: recipe as never },
    global: {
      stubs: {
        BeanieFormModal: {
          name: 'BeanieFormModal',
          props: ['open', 'title', 'saveLabel', 'saveDisabled', 'isSubmitting'],
          template: '<div><slot /></div>',
        },
        InferredHint: { name: 'InferredHint', props: ['text'], template: '<p>{{ text }}</p>' },
      },
    },
  });
}

const save = (w: ReturnType<typeof mountSheet>) =>
  w.findComponent({ name: 'BeanieFormModal' }).vm.$emit('save');

beforeEach(() => {
  h.currentMember = { id: 'm1' };
  h.lists = [];
  h.recipes = [{ id: 'r1' }];
  h.toasts = [];
  h.reported = [];
  h.logged = [];
  h.createList.mockClear();
  h.createList.mockResolvedValue({ id: 'new-list' });
  h.push.mockClear();
});

describe('the prefilled draft', () => {
  it('seeds the textarea with the non-heading lines, in recipe order', () => {
    expect(mountSheet().find('textarea').element.value).toBe('2 cups flour\n3 eggs');
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

  it('creates exactly one list, with the edited items', async () => {
    const w = mountSheet();
    await w.find('textarea').setValue('Flour\nEggs\nMilk');
    await save(w);
    expect(h.createList).toHaveBeenCalledOnce();
    const seed = h.createList.mock.calls[0]![0] as unknown as { items: Array<{ title: string }> };
    expect(seed.items.map((i) => i.title)).toEqual(['Flour', 'Eggs', 'Milk']);
  });

  it('🔴 keeps a line the USER types ending in a colon', async () => {
    // The heading rule runs once, at open. Re-running it on save would silently
    // delete input the user deliberately typed.
    const w = mountSheet();
    await w.find('textarea').setValue('Marinade:\nSoy sauce');
    await save(w);
    const seed = h.createList.mock.calls[0]![0] as unknown as { items: Array<{ title: string }> };
    expect(seed.items.map((i) => i.title)).toEqual(['Marinade:', 'Soy sauce']);
  });
});

describe('the existing-list notice', () => {
  it('offers to open a list already built from this recipe', async () => {
    h.lists = [{ id: 'l9', title: 'Shopping for Pancakes', emoji: '🛒', linkedRecipeId: 'r1' }];
    const w = mountSheet();
    expect(w.text()).toContain('lists.fromRecipe.existing');
    await w.findAll('button')[0]!.trigger('click');
    // NAVIGATES rather than mounting a second copy of the 700-line list drawer.
    expect(h.push).toHaveBeenCalledWith({ name: 'Lists', query: { view: 'l9' } });
  });

  it('says nothing when no list exists for this recipe', () => {
    h.lists = [{ id: 'l9', linkedRecipeId: 'other' }];
    expect(mountSheet().text()).not.toContain('lists.fromRecipe.existing');
  });

  it('🔴 still allows a SECOND list — offered, never enforced', async () => {
    h.lists = [{ id: 'l9', title: 'Old shop', emoji: '🛒', linkedRecipeId: 'r1' }];
    const w = mountSheet();
    await save(w);
    expect(h.createList).toHaveBeenCalledOnce();
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
  });

  it('refuses to create an empty list', async () => {
    const w = mountSheet();
    await w.find('textarea').setValue('   \n  ');
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
