/**
 * The one save path behind every shopping-list surface (#116): each guard refuses,
 * explains and reports; both destinations write; the success path is measurable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  currentMember: { id: 'm1' } as { id: string } | undefined,
  lists: [] as Array<{ id: string }>,
  recipes: [{ id: 'r1' }] as Array<{ id: string }>,
  createList: vi.fn(async (_seed: unknown): Promise<unknown> => ({ id: 'new-list' })),
  addItems: vi.fn(async (_id: string, _titles: string[]): Promise<unknown> => ({ id: 'g1' })),
  push: vi.fn(),
  toasts: [] as Array<{ kind: string; title: string; opts?: Record<string, unknown> }>,
  reported: [] as Array<Record<string, unknown>>,
  logged: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({
  showToast: (kind: string, title: string, _msg?: string, opts?: Record<string, unknown>) =>
    h.toasts.push({ kind, title, opts }),
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
  logEvent: (e: Record<string, unknown>) => h.logged.push(e),
}));

import {
  logShoppingSheetOpened,
  newListDestination,
  shoppingSaveLabel,
  useShoppingListCommit,
  type ShoppingListCommit,
} from '../useShoppingListCommit';

const NEW: ShoppingListCommit = {
  destination: newListDestination('m2'),
  titles: ['2 cups flour', '3 eggs'],
  defaultTitle: 'Shopping for Pancakes',
  linkedRecipeId: 'r1',
  kind: 'recipe',
  headingsSkipped: 1,
  sections: 1,
};
const EXISTING: ShoppingListCommit = {
  ...NEW,
  destination: { mode: 'existing', listId: 'g1' },
  linkedRecipeId: undefined,
  kind: 'week',
  sections: 4,
};

const ctx = (i = 0) => (h.logged[i]!.context ?? {}) as Record<string, unknown>;

beforeEach(() => {
  h.currentMember = { id: 'm1' };
  h.lists = [{ id: 'g1' }];
  h.recipes = [{ id: 'r1' }];
  h.createList.mockReset();
  h.createList.mockResolvedValue({ id: 'new-list' });
  h.addItems.mockReset();
  h.addItems.mockResolvedValue({ id: 'g1' });
  h.push.mockClear();
  h.toasts = [];
  h.reported = [];
  h.logged = [];
});

describe('New List', () => {
  it('creates one linked shopping list for the chosen owner, created by whoever is here', async () => {
    const { commit } = useShoppingListCommit();
    const out = await commit(NEW);
    expect(out).toEqual({ id: 'new-list' });
    const seed = h.createList.mock.calls[0]![0] as Record<string, unknown>;
    expect(seed).toMatchObject({
      title: 'Shopping for Pancakes',
      ownerId: 'm2',
      createdBy: 'm1',
      linkedRecipeId: 'r1',
      category: 'out',
      lifecycle: 'oneoff',
    });
    expect((seed.items as Array<{ title: string }>).map((i) => i.title)).toEqual(NEW.titles);
    // 🔴 No due date unless one was picked: a due date arms a reminder.
    expect(Object.keys(seed)).not.toContain('dueDate');
  });

  it('uses the typed name and due date when given', async () => {
    const { commit } = useShoppingListCommit();
    await commit({
      ...NEW,
      destination: { mode: 'new', title: '  Big shop ', ownerId: 'm2', dueDate: '2026-10-01' },
    });
    expect(h.createList.mock.calls[0]![0]).toMatchObject({
      title: 'Big shop',
      dueDate: '2026-10-01',
    });
  });

  it('falls back to the current member when no owner was picked', async () => {
    const { commit } = useShoppingListCommit();
    await commit({ ...NEW, destination: newListDestination('') });
    expect(h.createList.mock.calls[0]![0]).toMatchObject({ ownerId: 'm1' });
  });

  it('links a week list to no recipe', async () => {
    const { commit } = useShoppingListCommit();
    await commit({ ...NEW, linkedRecipeId: undefined, kind: 'week' });
    expect(Object.keys(h.createList.mock.calls[0]![0] as object)).not.toContain('linkedRecipeId');
  });

  it('🔴 a failed create is not toasted again (the store already did)', async () => {
    h.createList.mockResolvedValue(null);
    const { commit } = useShoppingListCommit();
    expect(await commit(NEW)).toBeNull();
    expect(h.toasts).toHaveLength(0);
    expect(h.logged).toHaveLength(0);
  });
});

describe('Add to a List', () => {
  it('appends every title to the chosen list, with no duplicate check', async () => {
    const { commit } = useShoppingListCommit();
    expect(await commit(EXISTING)).toEqual({ id: 'g1' });
    expect(h.addItems).toHaveBeenCalledWith('g1', NEW.titles);
    expect(h.createList).not.toHaveBeenCalled();
  });

  it('🔴 a list deleted mid-review is explained and reported', async () => {
    h.addItems.mockResolvedValue(null);
    h.lists = [];
    const { commit } = useShoppingListCommit();
    expect(await commit(EXISTING)).toBeNull();
    expect(h.toasts[0]).toMatchObject({
      kind: 'error',
      title: 'lists.destination.listGoneError',
    });
    // `silent`: reported below under the precise surface, never twice.
    expect(h.toasts[0]!.opts).toMatchObject({ silent: true });
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]).toMatchObject({
      surface: 'list-from-recipe',
      severity: 'error',
      context: { action: 'add_items_list_missing', kind: 'week' },
    });
  });

  it('a null for a list that still exists is the store’s failure, already reported', async () => {
    h.addItems.mockResolvedValue(null);
    const { commit } = useShoppingListCommit();
    expect(await commit(EXISTING)).toBeNull();
    expect(h.toasts).toHaveLength(0);
    expect(h.reported).toHaveLength(0);
  });
});

describe('guards', () => {
  it('🔴 no current member → writes nothing, explains and reports', async () => {
    h.currentMember = undefined;
    const { commit } = useShoppingListCommit();
    expect(await commit(NEW)).toBeNull();
    expect(h.createList).not.toHaveBeenCalled();
    expect(h.toasts[0]).toMatchObject({ kind: 'error', title: 'lists.fromRecipe.noMemberError' });
    expect(h.reported[0]).toMatchObject({
      surface: 'list-from-recipe',
      context: { action: 'no_current_member' },
    });
  });

  it('🔴 a recipe deleted mid-review → writes nothing, explains and reports', async () => {
    h.recipes = [];
    const { commit } = useShoppingListCommit();
    expect(await commit(NEW)).toBeNull();
    expect(h.createList).not.toHaveBeenCalled();
    expect(h.toasts[0]).toMatchObject({ kind: 'error', title: 'lists.fromRecipe.recipeGoneError' });
    expect(h.reported[0]).toMatchObject({ context: { action: 'recipe_missing' } });
  });

  it('does not check a recipe for a list linked to none', async () => {
    h.recipes = [];
    const { commit } = useShoppingListCommit();
    expect(await commit(EXISTING)).toEqual({ id: 'g1' });
  });

  it('🔴 a double tap writes exactly once', async () => {
    let release!: (v: unknown) => void;
    h.createList.mockImplementation(() => new Promise<unknown>((r) => (release = r)));
    const { commit, isSubmitting } = useShoppingListCommit();
    const first = commit(NEW);
    expect(isSubmitting.value).toBe(true);
    expect(await commit(NEW)).toBeNull();
    release({ id: 'new-list' });
    await first;
    expect(h.createList).toHaveBeenCalledOnce();
    expect(isSubmitting.value).toBe(false);
  });

  it('writes nothing when there are no titles', async () => {
    const { commit } = useShoppingListCommit();
    expect(await commit({ ...NEW, titles: [] })).toBeNull();
    expect(h.createList).not.toHaveBeenCalled();
  });
});

describe('success', () => {
  it('offers a way to GET to the list, with time to tap it', async () => {
    const { commit } = useShoppingListCommit();
    await commit(NEW);
    const opts = h.toasts[0]!.opts!;
    expect(opts.actionLabel).toBe('lists.fromRecipe.view');
    expect(opts.durationMs).toBe(8000);
    (opts.actionFn as () => void)();
    expect(h.push).toHaveBeenCalledWith({ name: 'Lists', query: { view: 'new-list' } });
  });

  it('records a create with its kind, counts, destination and section bucket', async () => {
    const { commit } = useShoppingListCommit();
    await commit(NEW);
    expect(h.logged[0]).toMatchObject({ level: 'info', surface: 'list-from-recipe' });
    expect(ctx()).toEqual({
      action: 'list_created',
      kind: 'recipe',
      count: 1,
      ingredient_count: 2,
      stage: 'new',
      detail: 'one',
    });
  });

  it('records an add, bucketing the sections', async () => {
    const { commit } = useShoppingListCommit();
    await commit(EXISTING);
    expect(ctx()).toMatchObject({ action: 'items_added', stage: 'existing', detail: 'many' });
    await commit({ ...EXISTING, sections: 2 });
    expect(ctx(1).detail).toBe('two');
    await commit({ ...EXISTING, sections: 3 });
    expect(ctx(2).detail).toBe('three');
  });
});

describe('helpers', () => {
  it('logShoppingSheetOpened records the offer on the #88 surface', () => {
    logShoppingSheetOpened({ kind: 'week', sections: 4, lines: 21, exactMerges: 1 });
    expect(h.logged[0]).toMatchObject({ surface: 'list-from-recipe' });
    expect(ctx()).toEqual({
      action: 'sheet_opened',
      kind: 'week',
      count: 4,
      ingredient_count: 21,
      inferred_count: 1,
    });
  });

  it('shoppingSaveLabel says Create List, or how many items are added', () => {
    const t = (k: string) => (k === 'lists.destination.addItems.other' ? 'Add {n} Items' : k);
    expect(shoppingSaveLabel(newListDestination('m1'), 3, t as never)).toBe(
      'lists.destination.createList'
    );
    const existing = { mode: 'existing', listId: 'g1' } as const;
    expect(shoppingSaveLabel(existing, 1, t as never)).toBe('lists.destination.addItems.one');
    expect(shoppingSaveLabel(existing, 7, t as never)).toBe('Add 7 Items');
  });
});
