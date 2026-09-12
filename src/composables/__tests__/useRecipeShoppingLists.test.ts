/**
 * Which shopping list a recipe should offer to open (#88).
 *
 * Two surfaces ask this — the recipe page, to decide which action to show, and
 * the review sheet, to decide whether to say a list already exists. They must
 * never disagree, which is why the question lives in one place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, effectScope } from 'vue';

const h = vi.hoisted(() => ({
  lists: [] as Array<Record<string, unknown>>,
  push: vi.fn(),
}));

vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get lists() {
      return h.lists;
    },
  }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: h.push }) }));

import { useRecipeShoppingLists } from '../useRecipeShoppingLists';

function list(over: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    title: 'Shopping',
    linkedRecipeId: 'r1',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** An effect scope per call, so a computed from one test cannot leak into the next. */
const scopes: ReturnType<typeof effectScope>[] = [];
function setup(recipeId: string | undefined = 'r1') {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useRecipeShoppingLists(computed(() => recipeId)))!;
}

beforeEach(() => {
  while (scopes.length) scopes.pop()!.stop();
  h.lists = [];
  h.push.mockClear();
});

describe('which lists belong to this recipe', () => {
  it('returns only this recipe’s lists', () => {
    h.lists = [list({ id: 'mine' }), list({ id: 'theirs', linkedRecipeId: 'r2' })];
    expect(setup().lists.value.map((l) => l.id)).toEqual(['mine']);
  });

  it('ignores lists with no recipe link at all', () => {
    h.lists = [list({ id: 'trip', linkedRecipeId: undefined, linkedVacationId: 'v1' })];
    expect(setup().lists.value).toHaveLength(0);
  });

  it('returns nothing when the recipe id is not yet resolved', () => {
    // The page renders before `recipe` loads; an undefined id must not match
    // every list whose `linkedRecipeId` is also undefined.
    h.lists = [list({ id: 'unlinked', linkedRecipeId: undefined })];
    expect(setup(undefined).lists.value).toHaveLength(0);
  });

  it('orders newest first — a family’s latest shop is the one they mean', () => {
    h.lists = [
      list({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      list({ id: 'new', createdAt: '2026-09-10T00:00:00.000Z' }),
      list({ id: 'mid', createdAt: '2026-05-05T00:00:00.000Z' }),
    ];
    expect(setup().lists.value.map((l) => l.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('the list worth offering to open', () => {
  it('is the newest unfinished one', () => {
    h.lists = [
      list({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      list({ id: 'new', createdAt: '2026-09-10T00:00:00.000Z' }),
    ];
    expect(setup().activeList.value?.id).toBe('new');
  });

  it('🔴 skips a finished shop in favour of one still going', () => {
    // Making "open" the first-class action is only right while there is a live
    // shop. A newer-but-done list must not win over an older live one.
    h.lists = [
      list({ id: 'done', completed: true, createdAt: '2026-09-10T00:00:00.000Z' }),
      list({ id: 'live', createdAt: '2026-09-01T00:00:00.000Z' }),
    ];
    expect(setup().activeList.value?.id).toBe('live');
  });

  it('🔴 is null when every list is finished, so the page offers a NEW one', () => {
    // Pointing "open shopping list" at a list ticked off three months ago is
    // worse than offering to make a fresh one. The finished ones stay reachable
    // from inside the sheet, which lists them all.
    h.lists = [list({ id: 'done', completed: true })];
    const { activeList, lists } = setup();
    expect(activeList.value).toBeNull();
    expect(lists.value).toHaveLength(1);
  });

  it('is null when the recipe has no lists at all', () => {
    expect(setup().activeList.value).toBeNull();
  });
});

describe('opening a list', () => {
  it('navigates to the lists page rather than mounting the drawer here', () => {
    setup().openList('l9');
    expect(h.push).toHaveBeenCalledWith({ name: 'Lists', query: { view: 'l9' } });
  });
});
