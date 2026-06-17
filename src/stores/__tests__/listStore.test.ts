import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList, FamilyListItem } from '@/types/models';

vi.mock('@/services/automerge/repositories/listRepository', () => ({
  getAllLists: vi.fn().mockResolvedValue([]),
  createList: vi.fn(),
  updateList: vi.fn(),
  deleteList: vi.fn(),
}));
vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));
// A real ref for `today` (so the store's `watch(today)` is a valid source);
// `__setToday` lets the suite pin it deterministically per run.
vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  const today = ref('2026-06-17');
  return { useToday: () => ({ today }), __setToday: (v: string) => (today.value = v) };
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
    vi.mocked(listRepo.deleteList).mockResolvedValue(true);

    const ok = await store.deleteList('x');

    expect(ok).toBe(true);
    expect(store.lists).toEqual([]);
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

  it('reconcileRecurringLists resets a rolled-over list, no-ops same-day, and skips an empty set', async () => {
    const store = useListStore();
    // Empty set → no calls.
    await store.reconcileRecurringLists();
    expect(listRepo.updateList).not.toHaveBeenCalled();

    const l = list({
      id: 'r',
      lifecycle: 'recurring',
      frequency: 'daily',
      lastResetDate: '2026-06-16', // yesterday relative to mockToday 2026-06-17
      cycleCelebrated: true,
      items: [item({ id: 'i1', completed: true }), item({ id: 'i2', completed: true })],
    });
    store.lists = [l];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });

    await store.reconcileRecurringLists();

    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.lastResetDate).toBe('2026-06-17');
    expect(patch.cycleCelebrated).toBe(false);
    expect((patch.items as FamilyListItem[]).every((i) => !i.completed)).toBe(true);

    // Second same-day run → no further reset.
    vi.mocked(listRepo.updateList).mockClear();
    await store.reconcileRecurringLists();
    expect(listRepo.updateList).not.toHaveBeenCalled();
  });

  it('loadLists surfaces a repo failure via wrapAsync (returns no throw, error set)', async () => {
    const store = useListStore();
    vi.mocked(listRepo.getAllLists).mockRejectedValue(new Error('boom'));

    await store.loadLists();

    expect(store.error).toBe('boom');
    expect(store.lists).toEqual([]);
  });
});
