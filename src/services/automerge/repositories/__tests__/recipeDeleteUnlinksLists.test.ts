/**
 * Deleting a recipe UNLINKS its shopping lists. It never deletes them (#88).
 *
 * The list is the family's own work — they edited it, they shopped from it — and it
 * outlives the recipe it was seeded from. This file exists because that is the one
 * way this feature could destroy user data, and "does not delete them" is worth
 * asserting directly rather than inferring from the absence of a bug report.
 *
 * The unlink rides in the SAME atomic batch as the recipe delete, beside the
 * meal-plan deref that was already there. The alternative — `listStore.clearLinksFor`
 * — is a loop of N separate writes that ignores every return value, so a failed
 * unlink would leave a permanently orphaned link with no telemetry, in a window
 * after the recipe had already atomically gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  batches: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../projection', () => ({
  list: (collection: string) => h.rows[collection] ?? [],
  getById: vi.fn(),
}));
vi.mock('../../worker/docClient', () => ({
  mutate: vi.fn(async (m: Record<string, unknown>) => {
    h.batches.push(m);
  }),
}));

import { deleteRecipeCascade } from '../recipeRepository';

type Op = { op: string; collection: string; id: string; deleteKeys?: string[]; onMissing?: string };

const opsOf = (): Op[] => (h.batches[0]?.ops as Op[]) ?? [];

beforeEach(() => {
  h.rows = {
    recipes: [{ id: 'r1' }],
    cookLogs: [],
    mealPlans: [],
    lists: [
      { id: 'list-1', linkedRecipeId: 'r1' },
      { id: 'list-2', linkedRecipeId: 'r1' },
      { id: 'list-other', linkedRecipeId: 'r2' },
      { id: 'list-trip', linkedVacationId: 'v1' },
    ],
  };
  h.batches = [];
  vi.clearAllMocks();
});

describe('deleteRecipeCascade — linked lists', () => {
  it('🔴 emits ZERO delete ops on the lists collection', async () => {
    // The data-loss assertion. Everything else in this file is detail.
    await deleteRecipeCascade('r1');
    expect(opsOf().filter((o) => o.op === 'delete' && o.collection === 'lists')).toHaveLength(0);
  });

  it('unlinks every list that pointed at this recipe', async () => {
    await deleteRecipeCascade('r1');
    const unlinks = opsOf().filter((o) => o.collection === 'lists');
    expect(unlinks.map((o) => o.id).sort()).toEqual(['list-1', 'list-2']);
    for (const u of unlinks) {
      expect(u.op).toBe('patch');
      expect(u.deleteKeys).toEqual(['linkedRecipeId']);
      // A list deleted on another device mid-gesture must not fail the recipe delete.
      expect(u.onMissing).toBe('skip');
    }
  });

  it('leaves other recipes’ lists and trip-linked lists alone', async () => {
    await deleteRecipeCascade('r1');
    const touched = opsOf()
      .filter((o) => o.collection === 'lists')
      .map((o) => o.id);
    expect(touched).not.toContain('list-other');
    expect(touched).not.toContain('list-trip');
  });

  it('🔴 rides in the SAME single batch as the recipe delete', async () => {
    // Atomicity is the whole reason this lives in the repo rather than the store:
    // one `Automerge.change`, so a mid-batch throw commits nothing and there is no
    // window where the recipe is gone but its links are not.
    await deleteRecipeCascade('r1');
    expect(h.batches).toHaveLength(1);
    expect(h.batches[0]!.op).toBe('batch');
    expect(opsOf().some((o) => o.op === 'delete' && o.collection === 'recipes')).toBe(true);
  });

  it('does nothing list-shaped when no list is linked', async () => {
    h.rows.lists = [{ id: 'list-trip', linkedVacationId: 'v1' }];
    await deleteRecipeCascade('r1');
    expect(opsOf().filter((o) => o.collection === 'lists')).toHaveLength(0);
    // Anti-vacuity: the batch still ran and still deleted the recipe.
    expect(opsOf().some((o) => o.op === 'delete' && o.collection === 'recipes')).toBe(true);
  });
});
