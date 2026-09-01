import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList, FamilyListItem } from '@/types/models';

vi.mock('@/services/automerge/repositories/listRepository', () => ({
  getAllLists: vi.fn().mockResolvedValue([]),
  getListById: vi.fn(),
  createList: vi.fn(),
  updateList: vi.fn(),
  deleteList: vi.fn(),
}));
vi.mock('@/services/automerge/repositories/listCycleRepository', () => ({
  getAllCycles: vi.fn().mockResolvedValue([]),
  archiveCycleAndReset: vi.fn().mockResolvedValue(undefined),
  deleteCycles: vi.fn().mockResolvedValue(undefined),
  deleteListWithCycles: vi.fn().mockResolvedValue(undefined),
}));
// The sweep reads the PROJECTION, never the reactive array, so a stale array cannot
// widen a deletion. The suite drives it directly.
const projection = vi.hoisted(() => ({ cycles: [] as unknown[], lists: [] as unknown[] }));
vi.mock('@/services/automerge/projection', () => ({
  list: (name: string) =>
    name === 'listCycles' ? projection.cycles : name === 'lists' ? projection.lists : [],
}));
// Doc is "loaded" for store-logic tests — loadLists/reconcile no-op without it.
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));
// A real ref for `today` (so the store's `watch(today)` is a valid source);
// `__setToday` lets the suite pin it deterministically per run.
vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  const today = ref('2026-06-17');
  const isVisible = ref(true);
  return {
    useToday: () => ({ today, isVisible }),
    __setToday: (v: string) => (today.value = v),
  };
});
// Pass-through member filter (exercised in its own test).
vi.mock('@/composables/useMemberFiltered', () => ({
  createMemberFiltered: <T>(source: { value: T[] }) => ({
    get value() {
      return source.value;
    },
  }),
}));
// Identity translate — createFromTemplate resolves the template name via the store.
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import { useListStore } from '../listStore';
import * as listRepo from '@/services/automerge/repositories/listRepository';
import * as cycleRepo from '@/services/automerge/repositories/listCycleRepository';
import { celebrate } from '@/composables/useCelebration';
import * as todayMod from '@/composables/useToday';

const setToday = (v: string): void =>
  (todayMod as unknown as { __setToday: (v: string) => void }).__setToday(v);

function item(overrides: Partial<FamilyListItem> = {}): FamilyListItem {
  return { id: 'i-1', title: 'Thing', completed: false, ...overrides };
}

function list(overrides: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1',
    title: 'Groceries',
    emoji: '🛒',
    category: 'out',
    ownerId: 'm-1',
    items: [],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('listStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    setToday('2026-06-17');
    vi.mocked(listRepo.getAllLists).mockResolvedValue([]);
  });

  it('partitions lists into active / completed / due-soon / by-category', () => {
    const store = useListStore();
    store.lists = [
      list({ id: 'a', category: 'out', createdAt: '2026-06-03T00:00:00.000Z' }),
      list({
        id: 'b',
        category: 'kids',
        dueDate: '2026-06-17',
        createdAt: '2026-06-02T00:00:00.000Z',
      }),
      list({
        id: 'c',
        category: 'out',
        dueDate: '2026-06-10',
        createdAt: '2026-06-01T00:00:00.000Z',
      }),
      list({ id: 'd', completed: true, completedAt: '2026-06-05T00:00:00.000Z' }),
      list({
        id: 'r',
        category: 'home',
        lifecycle: 'recurring',
        frequency: 'daily',
        createdAt: '2026-06-04T00:00:00.000Z',
      }),
    ];

    expect(store.activeLists.map((l) => l.id)).toEqual(['r', 'a', 'b', 'c']); // newest-created first, filed 'd' excluded
    expect(store.completedLists.map((l) => l.id)).toEqual(['d']);
    expect(store.dueSoonLists.map((l) => l.id).sort()).toEqual(['b', 'c']); // due today + overdue
    expect(store.listsByCategory.get('out')!.map((l) => l.id)).toEqual(['a', 'c']);
    expect(store.listsByCategory.get('kids')!.map((l) => l.id)).toEqual(['b']);
  });

  it('dueListsCount counts overdue + due-today lists, excluding recurring / future / undated / filed', () => {
    const store = useListStore();
    store.lists = [
      list({ id: 'o', dueDate: '2026-06-10' }), // overdue
      list({ id: 't', dueDate: '2026-06-17' }), // today (mockToday)
      list({ id: 'fut', dueDate: '2026-06-30' }), // future → excluded
      list({ id: 'nd' }), // undated → excluded
      list({ id: 'rec', lifecycle: 'recurring', frequency: 'daily' }), // recurring → excluded
      list({ id: 'filed', dueDate: '2026-06-10', completed: true }), // overdue but filed → excluded
    ];
    expect(store.dueListsCount).toBe(2);
  });

  it('createList appends and returns the created list', async () => {
    const store = useListStore();
    const created = list({ id: 'new' });
    vi.mocked(listRepo.createList).mockResolvedValue(created);

    const result = await store.createList({ ...created } as never);

    expect(result).toEqual(created);
    expect(store.lists.map((l) => l.id)).toEqual(['new']);
  });

  it('createFromTemplate seeds correctly (grocery → 5 items recurring/weekly; honey-do → 0; unknown → null)', async () => {
    const store = useListStore();
    vi.mocked(listRepo.createList).mockImplementation(
      async (input) =>
        ({ ...(input as object), id: 'seed', createdAt: 'x', updatedAt: 'x' }) as FamilyList
    );

    const g = await store.createFromTemplate('grocery', 'm-1');
    expect(g!.lifecycle).toBe('recurring');
    expect(g!.frequency).toBe('weekly');
    expect(g!.items).toHaveLength(5);
    expect(g!.templateKey).toBe('grocery');
    expect(g!.lastResetDate).toBe('2026-06-17'); // recurring stamps today
    expect(g!.createdBy).toBe('m-1');
    expect(g!.ownerId).toBe('m-1');

    const h = await store.createFromTemplate('honey-do', 'm-1');
    expect(h!.lifecycle).toBe('oneoff');
    expect(h!.items).toHaveLength(0);
    expect(h!.lastResetDate).toBeUndefined();

    expect(await store.createFromTemplate('does-not-exist', 'm-1')).toBeNull();
  });

  it('deleteList removes the list', async () => {
    const store = useListStore();
    store.lists = [list({ id: 'x' })];
    // The store confirms against the PROJECTION, not its own array: a `delete` on an id
    // that is already gone is a silent no-op in the worker, so trusting the array would
    // report success for a list nothing touched.
    projection.lists = [list({ id: 'x' })];
    vi.mocked(listRepo.deleteList).mockResolvedValue(true);

    const ok = await store.deleteList('x');

    expect(ok).toBe(true);
    expect(store.lists).toEqual([]);
  });

  it('deleteList reports failure when the list is no longer in the document', async () => {
    const store = useListStore();
    store.lists = [list({ id: 'x' })];
    projection.lists = [];

    expect(await store.deleteList('x')).toBe(false);
    expect(cycleRepo.deleteListWithCycles).not.toHaveBeenCalled();
  });

  it('toggleItem files a one-off list when the last item is checked and celebrates once', async () => {
    const store = useListStore();
    const l = list({
      id: 'l',
      items: [item({ id: 'i1', completed: true }), item({ id: 'i2', completed: false })],
    });
    store.lists = [l];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.toggleItem('l', 'i2', 'm-2');

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.completed).toBe(true);
    expect(patch.completedBy).toBe('m-2');
    expect(patch.completedAt).toBeDefined();
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(store.completedLists.map((l) => l.id)).toEqual(['l']);
  });

  it('toggleItem on a recurring list celebrates once per cycle and never files it', async () => {
    const store = useListStore();
    const l = list({
      id: 'r',
      lifecycle: 'recurring',
      frequency: 'daily',
      lastResetDate: '2026-06-17',
      items: [item({ id: 'i1', completed: true }), item({ id: 'i2', completed: false })],
    });
    store.lists = [l];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.toggleItem('r', 'i2', 'm-2'); // all done now

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.completed).toBeUndefined(); // recurring lists are never filed
    expect(patch.cycleCelebrated).toBe(true);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(store.completedLists).toEqual([]); // not filed

    // Re-open then re-close within the same cycle → no second celebration.
    await store.toggleItem('r', 'i2', 'm-2'); // un-check
    await store.toggleItem('r', 'i2', 'm-2'); // re-check (cycleCelebrated already true)
    expect(celebrate).toHaveBeenCalledTimes(1);
  });

  it('toggleItem un-files a filed one-off when an item is re-opened', async () => {
    const store = useListStore();
    const l = list({
      id: 'l',
      completed: true,
      completedBy: 'm-1',
      completedAt: '2026-06-16T00:00:00.000Z',
      items: [item({ id: 'i1', completed: true })],
    });
    store.lists = [l];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.toggleItem('l', 'i1', 'm-1'); // un-check the only item

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.completed).toBe(false);
    expect(store.completedLists).toEqual([]);
    expect(store.activeLists.map((l) => l.id)).toEqual(['l']);
  });

  it('reconcileRecurringLists archives the cycle and resets in ONE atomic call, no-ops same-day, and skips an empty set', async () => {
    const store = useListStore();
    // Empty set → no calls.
    await store.reconcileRecurringLists();
    expect(cycleRepo.archiveCycleAndReset).not.toHaveBeenCalled();

    const l = list({
      id: 'r',
      lifecycle: 'recurring',
      frequency: 'daily',
      lastResetDate: '2026-06-16', // yesterday relative to mockToday 2026-06-17
      cycleCelebrated: true,
      items: [item({ id: 'i1', completed: true }), item({ id: 'i2', completed: false })],
    });
    store.lists = [l];
    // The post-write verification read: the batch resolves to `undefined`, so the store
    // confirms against the projection rather than trusting the return value.
    vi.mocked(listRepo.getListById).mockResolvedValue({
      ...l,
      lastResetDate: '2026-06-17',
    } as FamilyList);

    await store.reconcileRecurringLists();

    // A list WITH items takes the atomic archive path, never the plain updateList reset.
    expect(listRepo.updateList).not.toHaveBeenCalled();
    const [cycle, listId, patch] = vi.mocked(cycleRepo.archiveCycleAndReset).mock.calls[0]!;
    expect(listId).toBe('r');
    expect((patch as Partial<FamilyList>).lastResetDate).toBe('2026-06-17');
    expect((patch as Partial<FamilyList>).cycleCelebrated).toBe(false);
    expect(
      ((patch as Partial<FamilyList>).items as FamilyListItem[]).every((i) => !i.completed)
    ).toBe(true);

    // The snapshot preserves what was and was not done, and spans the real cycle.
    expect(cycle.id).toBe('r:2026-06-17');
    expect(cycle.startedOn).toBe('2026-06-16');
    expect(cycle.endedOn).toBe('2026-06-17');
    expect(cycle.done).toBe(1);
    expect(cycle.total).toBe(2);
    expect(cycle.items.map((m) => m.done)).toEqual([true, false]);
    // A shallowRef must be REPLACED, not pushed into, or the UI never sees it.
    expect(store.cycles.map((c) => c.id)).toEqual(['r:2026-06-17']);

    // Second same-day run → no further reset.
    vi.mocked(cycleRepo.archiveCycleAndReset).mockClear();
    await store.reconcileRecurringLists();
    expect(cycleRepo.archiveCycleAndReset).not.toHaveBeenCalled();
  });

  it('falls back to a plain reset for a recurring list with no items — "0 of 0" is not history', async () => {
    const store = useListStore();
    store.lists = [
      list({
        id: 'empty',
        lifecycle: 'recurring',
        frequency: 'daily',
        lastResetDate: '2026-06-16',
        items: [],
      }),
    ];
    vi.mocked(listRepo.updateList).mockResolvedValue({} as FamilyList);

    await store.reconcileRecurringLists();

    expect(cycleRepo.archiveCycleAndReset).not.toHaveBeenCalled();
    expect(listRepo.updateList).toHaveBeenCalled();
  });

  it('does NOT record an archive when the batch resolves but the list did not reset', async () => {
    const store = useListStore();
    const l = list({
      id: 'r2',
      lifecycle: 'recurring',
      frequency: 'daily',
      lastResetDate: '2026-06-16',
      items: [item({ id: 'i1' })],
    });
    store.lists = [l];
    // Batch resolves (as it always does — it echoes `undefined`) but the projection still
    // shows the old cursor. That must read as a failure, not a success.
    vi.mocked(listRepo.getListById).mockResolvedValue(l as FamilyList);

    await store.reconcileRecurringLists();

    expect(cycleRepo.archiveCycleAndReset).toHaveBeenCalled();
    expect(store.cycles).toEqual([]);
  });

  it('clearLinksFor clears matching trip/activity links (no orphan on delete)', async () => {
    const store = useListStore();
    store.lists = [
      list({ id: 'a', linkedVacationId: 'v1' }),
      list({ id: 'b', linkedActivityId: 'act1' }),
      list({ id: 'c' }),
    ];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.clearLinksFor('trip', 'v1');
    expect(store.lists.find((l) => l.id === 'a')!.linkedVacationId).toBeUndefined();
    expect(store.lists.find((l) => l.id === 'b')!.linkedActivityId).toBe('act1'); // untouched

    await store.clearLinksFor('activity', 'act1');
    expect(store.lists.find((l) => l.id === 'b')!.linkedActivityId).toBeUndefined();
  });

  it('loadLists surfaces a repo failure via wrapAsync (returns no throw, error set)', async () => {
    const store = useListStore();
    vi.mocked(listRepo.getAllLists).mockRejectedValue(new Error('boom'));

    await store.loadLists();

    expect(store.error).toBe('boom');
    expect(store.lists).toEqual([]);
  });

  // ── deriveCompletion shared by toggle/add/remove (F5/F10) ──────────────────

  it('removeItem files a one-off when the last open item is deleted — no celebrate, no completedBy', async () => {
    const store = useListStore();
    store.lists = [
      list({ id: 'l', items: [item({ id: 'i1', completed: true }), item({ id: 'i2' })] }),
    ];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.removeItem('l', 'i2'); // delete the only open item → 100% done

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.completed).toBe(true);
    expect(patch.completedBy).toBeUndefined(); // no acting member on a remove
    expect(patch.completedAt).toBeDefined();
    expect(celebrate).not.toHaveBeenCalled(); // filing via remove never throws confetti
    expect(store.completedLists.map((l) => l.id)).toEqual(['l']);
  });

  it('addItem clears cycleCelebrated on a completed recurring list (re-completion can celebrate again)', async () => {
    const store = useListStore();
    store.lists = [
      list({
        id: 'r',
        lifecycle: 'recurring',
        frequency: 'daily',
        cycleCelebrated: true,
        items: [item({ id: 'i1', completed: true })],
      }),
    ];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.addItem('r', 'Grab lunchbox');

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.cycleCelebrated).toBe(false);
  });

  it('removeItem on an already-celebrated recurring list leaves completion fields untouched (no-op patch)', async () => {
    const store = useListStore();
    store.lists = [
      list({
        id: 'r',
        lifecycle: 'recurring',
        frequency: 'daily',
        cycleCelebrated: true,
        items: [item({ id: 'i1', completed: true }), item({ id: 'i2', completed: true })],
      }),
    ];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.removeItem('r', 'i1'); // still all-done, already celebrated

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch).not.toHaveProperty('cycleCelebrated');
    expect(patch).not.toHaveProperty('completed');
  });

  // ── setLifecycle clears the completion triple both directions (F3) ─────────

  it('setLifecycle one-off → recurring clears completion stamps and sets recurrence', async () => {
    const store = useListStore();
    store.lists = [
      list({
        id: 'l',
        completed: true,
        completedBy: 'm-1',
        completedAt: '2026-06-16T00:00:00.000Z',
        items: [item({ id: 'i1', completed: true })],
      }),
    ];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.setLifecycle('l', 'recurring');

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.lifecycle).toBe('recurring');
    expect(patch.completed).toBeUndefined();
    expect(patch.completedBy).toBeUndefined();
    expect(patch.completedAt).toBeUndefined();
    expect(patch.cycleCelebrated).toBe(false);
    expect(patch.lastResetDate).toBe('2026-06-17');
    expect(store.completedLists).toEqual([]); // no longer filed
  });

  it('setLifecycle recurring → one-off clears stale stamps so it does not auto-file', async () => {
    const store = useListStore();
    store.lists = [
      list({
        id: 'r',
        lifecycle: 'recurring',
        frequency: 'daily',
        completed: true, // stale (recurring lists should never carry this)
        completedAt: '2026-06-16T00:00:00.000Z',
        items: [item({ id: 'i1', completed: true })],
      }),
    ];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.setLifecycle('r', 'oneoff');

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.lifecycle).toBe('oneoff');
    expect(patch.completed).toBeUndefined();
    expect(patch.completedAt).toBeUndefined();
    expect(store.completedLists).toEqual([]); // not filed despite the stale flag
  });

  // ── edit + reorder (2026-06-20) ──────────────────────────────────────────
  const mergeUpdate = (store: ReturnType<typeof useListStore>): void => {
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });
  };

  describe('renameList', () => {
    it('trims and updates ONLY the title (never completion/filing)', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'l', title: 'Old', completed: true, completedAt: 'x' })];
      mergeUpdate(store);
      await store.renameList('l', '  New name  ');
      const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
      expect(patch).toEqual({ title: 'New name' });
      expect('completed' in patch).toBe(false);
    });

    it('no-ops on empty/whitespace or unchanged title (no write)', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'l', title: 'Same' })];
      mergeUpdate(store);
      await store.renameList('l', '   ');
      await store.renameList('l', 'Same');
      expect(listRepo.updateList).not.toHaveBeenCalled();
    });

    it('returns null for an unknown list id', async () => {
      const store = useListStore();
      store.lists = [];
      expect(await store.renameList('nope', 'x')).toBeNull();
    });
  });

  describe('updateItemText', () => {
    it('edits the target item and preserves its completion triple', async () => {
      const store = useListStore();
      store.lists = [
        list({
          id: 'l',
          items: [
            item({
              id: 'i1',
              title: 'old',
              completed: true,
              completedBy: 'm-2',
              completedAt: 'ts',
            }),
            item({ id: 'i2', title: 'keep' }),
          ],
        }),
      ];
      mergeUpdate(store);
      await store.updateItemText('l', 'i1', 'new text');
      const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
      expect(patch.items).toEqual([
        { id: 'i1', title: 'new text', completed: true, completedBy: 'm-2', completedAt: 'ts' },
        { id: 'i2', title: 'keep', completed: false },
      ]);
      // never re-derives list completion
      expect('completed' in patch).toBe(false);
    });

    it('no-ops on empty text, unchanged text, or a missing item', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'l', items: [item({ id: 'i1', title: 'thing' })] })];
      mergeUpdate(store);
      await store.updateItemText('l', 'i1', '  ');
      await store.updateItemText('l', 'i1', 'thing');
      await store.updateItemText('l', 'missing', 'x');
      expect(listRepo.updateList).not.toHaveBeenCalled();
    });
  });

  describe('reorderItems', () => {
    const seed = () => {
      const store = useListStore();
      store.lists = [
        list({
          id: 'l',
          items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
          completed: false,
        }),
      ];
      mergeUpdate(store);
      return store;
    };
    const orderOf = (): string[] =>
      ((vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>).items ?? []).map(
        (i) => i.id
      );

    it('moves first→last', async () => {
      const store = seed();
      await store.reorderItems('l', 0, 2);
      expect(orderOf()).toEqual(['b', 'c', 'a']);
    });

    it('moves last→first', async () => {
      const store = seed();
      await store.reorderItems('l', 2, 0);
      expect(orderOf()).toEqual(['c', 'a', 'b']);
    });

    it('moves an adjacent pair', async () => {
      const store = seed();
      await store.reorderItems('l', 1, 2);
      expect(orderOf()).toEqual(['a', 'c', 'b']);
    });

    it('no-ops on equal / negative / out-of-range indices', async () => {
      const store = seed();
      await store.reorderItems('l', 1, 1);
      await store.reorderItems('l', -1, 2);
      await store.reorderItems('l', 0, 9);
      expect(listRepo.updateList).not.toHaveBeenCalled();
    });

    it('never changes completion/filing state', async () => {
      const store = seed();
      await store.reorderItems('l', 0, 2);
      const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
      expect('completed' in patch).toBe(false);
      expect('completedAt' in patch).toBe(false);
    });
  });

  describe('sweepExpiredCycles — the irreversible half', () => {
    const OLD = {
      id: 'c-old',
      listId: 'r',
      endedOn: '2026-01-01',
      createdAt: '2026-01-01T09:00:00.000Z',
    };
    const FRESH = {
      id: 'c-new',
      listId: 'r',
      endedOn: '2026-06-16',
      createdAt: '2026-06-16T09:00:00.000Z',
    };

    beforeEach(() => {
      localStorage.clear();
      projection.cycles = [];
    });

    /** A device only sweeps once it has a trusted high-water day. */
    function primeClock(day = '2026-06-16') {
      localStorage.setItem('beanies_cycle_sweep_day', day);
    }

    it('deletes expired cycles and mirrors the store only after the write resolves', async () => {
      const store = useListStore();
      store.cycles = [OLD, FRESH] as never;
      store.cyclesLoaded = true;
      projection.cycles = [OLD, FRESH];
      primeClock();

      await store.sweepExpiredCycles();

      expect(cycleRepo.deleteCycles).toHaveBeenCalledWith(['c-old']);
      expect(store.cycles.map((c) => c.id)).toEqual(['c-new']);
    });

    it('does NOTHING when the cycles collection has not loaded', async () => {
      const store = useListStore();
      store.cyclesLoaded = false;
      projection.cycles = [OLD];
      primeClock();

      await store.sweepExpiredCycles();

      expect(cycleRepo.deleteCycles).not.toHaveBeenCalled();
    });

    it("does NOTHING on a device's first run, whatever is stored", async () => {
      const store = useListStore();
      store.cyclesLoaded = true;
      projection.cycles = [OLD];
      // No high-water day recorded.

      await store.sweepExpiredCycles();

      expect(cycleRepo.deleteCycles).not.toHaveBeenCalled();
      // ...but the day is now recorded, so tomorrow can sweep.
      expect(localStorage.getItem('beanies_cycle_sweep_day')).toBe('2026-06-17');
    });

    it('does NOTHING twice in one day — maintenance runs on every app open', async () => {
      const store = useListStore();
      store.cyclesLoaded = true;
      store.cycles = [OLD] as never;
      projection.cycles = [OLD];
      primeClock();

      await store.sweepExpiredCycles();
      vi.mocked(cycleRepo.deleteCycles).mockClear();
      await store.sweepExpiredCycles();

      expect(cycleRepo.deleteCycles).not.toHaveBeenCalled();
    });

    it('does NOTHING after a clock jump it cannot trust', async () => {
      const store = useListStore();
      store.cyclesLoaded = true;
      projection.cycles = [OLD];
      primeClock('2026-01-01'); // months behind "today" (2026-06-17)

      await store.sweepExpiredCycles();

      expect(cycleRepo.deleteCycles).not.toHaveBeenCalled();
    });

    it('deletes nothing when the collection is empty — a partial load cannot cascade', async () => {
      const store = useListStore();
      store.cyclesLoaded = true;
      projection.cycles = [];
      primeClock();

      await store.sweepExpiredCycles();

      expect(cycleRepo.deleteCycles).not.toHaveBeenCalled();
    });

    it('never touches lists, whatever their age', async () => {
      const store = useListStore();
      store.cyclesLoaded = true;
      // A two-year-old completed one-off list the user made themselves.
      const ancient = list({ id: 'ancient', lifecycle: 'oneoff', completed: true });
      store.lists = [ancient];
      projection.cycles = [OLD];
      primeClock();

      await store.sweepExpiredCycles();

      expect(store.lists).toEqual([ancient]);
      expect(listRepo.deleteList).not.toHaveBeenCalled();
      expect(cycleRepo.deleteListWithCycles).not.toHaveBeenCalled();
    });

    it('survives a failed delete without losing the UI, and still burns the day', async () => {
      const store = useListStore();
      store.cyclesLoaded = true;
      store.cycles = [OLD] as never;
      projection.cycles = [OLD];
      primeClock();
      vi.mocked(cycleRepo.deleteCycles).mockRejectedValueOnce(new Error('worker down'));

      await expect(store.sweepExpiredCycles()).resolves.toBeUndefined();

      // The store still shows what is actually stored — the UI must never claim a
      // deletion the document did not take.
      expect(store.cycles.map((c) => c.id)).toEqual(['c-old']);
      // The day IS burned, deliberately. The cursor is RESERVED before the delete, because
      // `MAX_SWEEP_DELETES` is a per-DAY cap and is only that if the day is claimed up
      // front: maintenance re-runs on every page visit and every remote merge, so
      // recording afterwards degrades the cap to 50-per-invocation and a whole archive can
      // go inside one session. A failed sweep costs one day of retention; the alternative
      // costs the history.
      expect(localStorage.getItem('beanies_cycle_sweep_day')).toBe('2026-06-17');
    });

    it('records the day when there is no history at all, so it cannot sawtooth', async () => {
      const store = useListStore();
      store.cyclesLoaded = true;
      projection.cycles = [];
      primeClock();

      await store.sweepExpiredCycles();

      // Every family has an empty `listCycles` on day one. Leaving the cursor frozen here
      // meant re-reaching the trusted-jump bound every eighth day forever, firing a false
      // `clock-jumped` warning that drowned the real bad-clock signal.
      expect(localStorage.getItem('beanies_cycle_sweep_day')).toBe('2026-06-17');
    });
  });
});
