import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList, FamilyListItem } from '@/types/models';

vi.mock('@/services/automerge/repositories/listRepository', () => ({
  getAllLists: vi.fn().mockResolvedValue([]),
  getListById: vi.fn(),
  createList: vi.fn(),
  updateList: vi.fn(),
  deleteList: vi.fn(),
  patchLists: vi.fn(),
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
// Captured so the store's telemetry can be asserted (`notify_parents_set`).
const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
// Identity translate — createFromTemplate resolves the template name via the store.
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import { useListStore } from '../listStore';
import { listAssignees } from '@/utils/assignees';
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

  it('🔴 refuses to create a list whose owner is not in the family', async () => {
    // A list owned by nobody reaches no briefing and, before the audience gate in
    // `buildListReminders` was tightened, armed the 09:00 reminder on EVERY device.
    // The rule lives here because four call sites create lists and only one checked.
    const { useFamilyStore } = await import('@/stores/familyStore');
    useFamilyStore().members = [{ id: 'm1', name: 'Greg' }] as never;
    const store = useListStore();
    vi.mocked(listRepo.createList).mockResolvedValue(list({ id: 'new' }));

    expect(
      await store.createList({ ...list({ id: 'new' }), ownerId: 'ghost' } as never)
    ).toBeNull();
    expect(await store.createList({ ...list({ id: 'new' }), ownerId: '' } as never)).toBeNull();
    expect(listRepo.createList).not.toHaveBeenCalled();

    // Anti-vacuity: a real member still creates.
    expect(await store.createList({ ...list({ id: 'new' }), ownerId: 'm1' } as never)).toBeTruthy();
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

  it('createFromTemplate with a card holder as owner keeps the creator as createdBy (#109)', async () => {
    const store = useListStore();
    vi.mocked(listRepo.createList).mockImplementation(
      async (input) =>
        ({ ...(input as object), id: 'seed', createdAt: 'x', updatedAt: 'x' }) as FamilyList
    );
    const g = await store.createFromTemplate('grocery', 'm-1', { ownerId: 'm-2' });
    expect(g!.ownerId).toBe('m-2');
    expect(g!.createdBy).toBe('m-1');
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

  describe('discardIfUntouched (#114)', () => {
    it('discards a list with no items that was never edited', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'x' })];
      projection.lists = [list({ id: 'x' })];
      expect(await store.discardIfUntouched('x')).toBe('discarded');
      expect(cycleRepo.deleteListWithCycles).toHaveBeenCalledWith('x');
    });

    it('keeps a list with an item, or one edited since it was created', async () => {
      const store = useListStore();
      store.lists = [
        list({ id: 'with-item', items: [item({ id: 'i1' })] }),
        list({ id: 'renamed', updatedAt: '2026-06-01T00:00:05.000Z' }),
      ];
      expect(await store.discardIfUntouched('with-item')).toBe('kept');
      expect(await store.discardIfUntouched('renamed')).toBe('kept');
      expect(cycleRepo.deleteListWithCycles).not.toHaveBeenCalled();
    });

    it('reports gone for a list already deleted', async () => {
      const store = useListStore();
      store.lists = [];
      expect(await store.discardIfUntouched('x')).toBe('gone');
    });
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

  it('celebration Undo clears only the item this gesture ticked and keeps edits made meanwhile', async () => {
    const store = useListStore();
    store.lists = [
      list({
        id: 'l',
        items: [item({ id: 'i1', completed: true }), item({ id: 'i2', completed: false })],
      }),
    ];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      const next = { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
      store.lists = store.lists.map((x) => (x.id === id ? next : x));
      return next;
    });

    await store.toggleItem('l', 'i2', 'm-2');
    // During the toast: a new row is added elsewhere (add-row, or another device).
    store.lists = store.lists.map((x) =>
      x.id === 'l' ? { ...x, items: [...x.items, item({ id: 'i3', completed: false })] } : x
    );

    const onUndo = vi.mocked(celebrate).mock.calls[0]![1]!.onUndo!;
    onUndo();

    const patch = vi.mocked(listRepo.updateList).mock.calls[1]![1] as Partial<FamilyList>;
    expect(patch.completed).toBe(false);
    const byId = Object.fromEntries((patch.items ?? []).map((i) => [i.id, i]));
    expect(Object.keys(byId).sort()).toEqual(['i1', 'i2', 'i3']); // the new row survives
    expect(byId.i2!.completed).toBe(false);
    expect(byId.i2!.completedBy).toBeUndefined();
    expect(byId.i1!.completed).toBe(true); // not touched by this gesture
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
    vi.mocked(listRepo.patchLists).mockImplementation(async (ids, input) =>
      store.lists
        .filter((x) => ids.includes(x.id))
        .map((x) => ({ ...x, ...(input as Partial<FamilyList>) }) as FamilyList)
    );

    await store.clearLinksFor('trip', 'v1');
    expect(store.lists.find((l) => l.id === 'a')!.linkedVacationId).toBeUndefined();
    expect(store.lists.find((l) => l.id === 'b')!.linkedActivityId).toBe('act1'); // untouched
    // ONE batched, reported write for the trip branch too (it used to be N `updateList`s).
    expect(listRepo.patchLists).toHaveBeenCalledWith(
      ['a'],
      { linkedVacationId: undefined },
      { onMissing: 'skip' }
    );
    expect(listRepo.updateList).not.toHaveBeenCalled();

    await store.clearLinksFor('activity', 'act1');
    expect(store.lists.find((l) => l.id === 'b')!.linkedActivityId).toBeUndefined();
    // ONE batched write for the activity branch, id + session date cleared together.
    expect(listRepo.patchLists).toHaveBeenCalledTimes(2);
    expect(listRepo.patchLists).toHaveBeenLastCalledWith(
      ['b'],
      { linkedActivityId: undefined, activityDate: undefined },
      { onMissing: 'skip' }
    );
  });

  describe('trip links and attaching', () => {
    const patchEcho = () =>
      vi.mocked(listRepo.patchLists).mockImplementation(async (ids, input) =>
        useListStore()
          .lists.filter((x) => ids.includes(x.id))
          .map((x) => ({ ...x, ...(input as Partial<FamilyList>) }) as FamilyList)
      );

    it('linkListsToTrip links (and with null unlinks) in one write, skipping missing ids', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'a' })];
      patchEcho();

      const linked = await store.linkListsToTrip(['a', 'gone'], 'trip-1');
      expect(listRepo.patchLists).toHaveBeenCalledWith(
        ['a', 'gone'],
        { linkedVacationId: 'trip-1' },
        { onMissing: 'skip' }
      );
      expect(linked).toHaveLength(1);
      expect(store.lists[0]!.linkedVacationId).toBe('trip-1');

      await store.linkListsToTrip(['a'], null);
      expect(store.lists[0]!.linkedVacationId).toBeUndefined();
    });

    it('linkListsToTrip returns null on a failed write, reported under its own action', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'a', linkedVacationId: 'trip-1' })];
      vi.mocked(listRepo.patchLists).mockRejectedValue(new Error('write failed'));

      expect(await store.linkListsToTrip(['a'], null)).toBeNull();
      expect(store.lists[0]!.linkedVacationId).toBe('trip-1');
    });

    it('listsForTrip returns the lists linked to that trip, filed ones included', () => {
      const store = useListStore();
      store.lists = [
        list({ id: 'a', linkedVacationId: 'trip-1' }),
        list({ id: 'filed', linkedVacationId: 'trip-1', completed: true }),
        list({ id: 'other', linkedVacationId: 'trip-2' }),
        list({ id: 'act', linkedActivityId: 'trip-1' }),
      ];
      expect(store.listsForTrip('trip-1').map((l) => l.id)).toEqual(['a', 'filed']);
    });

    it('attachableLists offers unfiled lists with no link of that kind, newest first', () => {
      const store = useListStore();
      store.lists = [
        list({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
        list({ id: 'new', createdAt: '2026-09-01T00:00:00.000Z' }),
        list({ id: 'filed', completed: true }),
        list({ id: 'on-trip', linkedVacationId: 'trip-9' }),
        list({ id: 'on-activity', linkedActivityId: 'act-9' }),
      ];
      expect(store.attachableLists('trip').map((l) => l.id)).toEqual(['new', 'on-activity', 'old']);
      expect(store.attachableLists('activity').map((l) => l.id)).toEqual(['new', 'on-trip', 'old']);
    });

    it('attachLists never moves a list that was linked elsewhere since it was picked', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'free' }), list({ id: 'taken', linkedVacationId: 'trip-9' })];
      patchEcho();

      const attached = await store.attachLists(['free', 'taken'], {
        kind: 'trip',
        vacationId: 'trip-1',
      });
      expect(listRepo.patchLists).toHaveBeenCalledWith(
        ['free'],
        { linkedVacationId: 'trip-1' },
        { onMissing: 'skip' }
      );
      expect(attached!.map((l) => l.id)).toEqual(['free']);
      expect(store.lists.find((l) => l.id === 'taken')!.linkedVacationId).toBe('trip-9');
    });

    it('attachLists to an activity session writes the id and session date together', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'free' })];
      patchEcho();

      await store.attachLists(['free'], {
        kind: 'activity',
        link: { activityId: 'series', activityDate: '2026-10-06' },
      });
      expect(listRepo.patchLists).toHaveBeenCalledWith(
        ['free'],
        { linkedActivityId: 'series', activityDate: '2026-10-06' },
        { onMissing: 'skip' }
      );
    });
  });

  describe('activity links (#114)', () => {
    const patchEcho = () =>
      vi.mocked(listRepo.patchLists).mockImplementation(async (ids, input) =>
        useListStore()
          .lists.filter((x) => ids.includes(x.id))
          .map((x) => ({ ...x, ...(input as Partial<FamilyList>) }) as FamilyList)
      );

    it('linkListsToActivity writes the id and session date together in one batch', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'a', linkedActivityId: 'old', activityDate: '2026-10-06' })];
      patchEcho();

      const linked = await store.linkListsToActivity(['a', 'gone'], { activityId: 'act-2' });

      expect(listRepo.patchLists).toHaveBeenCalledWith(
        ['a', 'gone'],
        { linkedActivityId: 'act-2', activityDate: undefined },
        { onMissing: 'skip' }
      );
      const patch = vi.mocked(listRepo.patchLists).mock.calls[0]![1];
      expect(Object.keys(patch).sort()).toEqual(['activityDate', 'linkedActivityId']);
      expect(linked).toHaveLength(1);
      expect(store.lists[0]!.linkedActivityId).toBe('act-2');
    });

    it('linkListsToActivity with no ids writes nothing', async () => {
      expect(await useListStore().linkListsToActivity([], null)).toEqual([]);
      expect(listRepo.patchLists).not.toHaveBeenCalled();
    });

    it('linkListsToActivity returns null on a failed write and leaves the lists', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'a', linkedActivityId: 'act-1' })];
      vi.mocked(listRepo.patchLists).mockRejectedValue(new Error('write failed'));

      expect(await store.linkListsToActivity(['a'], null)).toBeNull();
      expect(store.lists[0]!.linkedActivityId).toBe('act-1');
    });

    it('listsForActivitySession returns the session and every-session lists of a series', () => {
      const store = useListStore();
      store.lists = [
        list({ id: 'whole', linkedActivityId: 'series' }),
        list({ id: 'this', linkedActivityId: 'series', activityDate: '2026-10-06' }),
        list({ id: 'next', linkedActivityId: 'series', activityDate: '2026-10-13' }),
        list({ id: 'none' }),
      ];
      const master = { id: 'series', date: '2026-09-01', recurrence: 'weekly' } as never;

      expect(
        store.listsForActivitySession(master, '2026-10-06').map((m) => [m.item.id, m.scope])
      ).toEqual([
        ['whole', 'every-session'],
        ['this', 'session'],
      ]);
    });

    it('createBlankList defaults to Home when the category is absent or undefined', async () => {
      const store = useListStore();
      vi.mocked(listRepo.createList).mockImplementation(
        async (input) => ({ ...list(), ...input, id: 'new' }) as FamilyList
      );

      await store.createBlankList('m-1', { category: undefined, linkedVacationId: 'trip-1' });
      await store.createBlankList('m-1');

      for (const [input] of vi.mocked(listRepo.createList).mock.calls) {
        expect(input.category).toBe('home');
      }
      expect(listRepo.createList).toHaveBeenCalledWith(
        expect.objectContaining({ linkedVacationId: 'trip-1' })
      );
    });

    it('createBlankList seeds a one-off list and spreads overrides last', async () => {
      const store = useListStore();
      vi.mocked(listRepo.createList).mockImplementation(
        async (input) => ({ ...list(), ...input, id: 'new' }) as FamilyList
      );

      await store.createBlankList('m-1', {
        category: 'out',
        linkedActivityId: 'series',
        activityDate: '2026-10-06',
      });

      expect(listRepo.createList).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'lists.new.blankTitle',
          category: 'out',
          ownerId: 'm-1',
          createdBy: 'm-1',
          items: [],
          lifecycle: 'oneoff',
          completed: false,
          linkedActivityId: 'series',
          activityDate: '2026-10-06',
        })
      );
    });
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

  // ── addItems (#116): one write, same re-open rules as addItem ─────────────

  describe('addItems', () => {
    const echoUpdate = (store: ReturnType<typeof useListStore>) =>
      vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
        const cur = store.lists.find((x) => x.id === id)!;
        return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
      });

    it('appends every title as a fresh open item in ONE write, after the existing items', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'l', items: [item({ id: 'i1', title: 'Milk' })] })];
      echoUpdate(store);

      const updated = await store.addItems('l', ['2 eggs', '500 g flour']);

      expect(listRepo.updateList).toHaveBeenCalledTimes(1);
      const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
      expect(patch.items!.map((i) => i.title)).toEqual(['Milk', '2 eggs', '500 g flour']);
      expect(patch.items!.slice(1).every((i) => !i.completed && i.id !== 'i1')).toBe(true);
      expect(new Set(patch.items!.map((i) => i.id)).size).toBe(3);
      expect(updated?.items).toHaveLength(3);
    });

    it('re-opens a filed one-off (completion re-derived)', async () => {
      const store = useListStore();
      store.lists = [
        list({
          id: 'l',
          completed: true,
          completedBy: 'm-1',
          completedAt: '2026-06-10',
          items: [item({ id: 'i1', completed: true })],
        }),
      ];
      echoUpdate(store);

      await store.addItems('l', ['Butter']);

      const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
      expect(patch.completed).toBe(false);
      expect(patch.completedBy).toBeUndefined();
      expect(patch.completedAt).toBeUndefined();
      expect(store.activeLists.map((l) => l.id)).toEqual(['l']);
    });

    it('clears cycleCelebrated on a celebrated recurring list', async () => {
      const store = useListStore();
      store.lists = [
        list({
          id: 'r',
          lifecycle: 'recurring',
          frequency: 'weekly',
          cycleCelebrated: true,
          items: [item({ id: 'i1', completed: true })],
        }),
      ];
      echoUpdate(store);

      await store.addItems('r', ['Bread', 'Jam']);

      const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
      expect(patch.cycleCelebrated).toBe(false);
    });

    it('returns null and writes nothing when the list is missing (silent-null contract)', async () => {
      const store = useListStore();
      store.lists = [];
      expect(await store.addItems('gone', ['Bread'])).toBeNull();
      expect(await store.addItem('gone', 'Bread')).toBeNull();
      expect(listRepo.updateList).not.toHaveBeenCalled();
    });

    it('addItem delegates: one titled item, same write path', async () => {
      const store = useListStore();
      store.lists = [list({ id: 'l' })];
      echoUpdate(store);

      const updated = await store.addItem('l', 'Grab lunchbox');

      const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
      expect(patch.items!.map((i) => i.title)).toEqual(['Grab lunchbox']);
      expect(updated?.items[0]!.title).toBe('Grab lunchbox');
    });
  });

  describe('shoppingDestinations', () => {
    it('offers one-off unfiled lists only, shopping first, then newest first', () => {
      const store = useListStore();
      store.lists = [
        list({ id: 'home-old', category: 'home', createdAt: '2026-06-01T00:00:00.000Z' }),
        list({ id: 'out-old', category: 'out', createdAt: '2026-06-02T00:00:00.000Z' }),
        list({ id: 'home-new', category: 'home', createdAt: '2026-06-05T00:00:00.000Z' }),
        list({ id: 'out-new', category: 'out', createdAt: '2026-06-04T00:00:00.000Z' }),
        list({
          id: 'filed',
          category: 'out',
          completed: true,
          createdAt: '2026-06-09T00:00:00.000Z',
        }),
        list({
          id: 'weekly',
          category: 'out',
          lifecycle: 'recurring',
          frequency: 'weekly',
          createdAt: '2026-06-09T00:00:00.000Z',
        }),
      ];

      expect(store.shoppingDestinations.map((l) => l.id)).toEqual([
        'out-new',
        'out-old',
        'home-new',
        'home-old',
      ]);
    });

    it('is empty when the family has no eligible list', () => {
      const store = useListStore();
      store.lists = [list({ id: 'filed', completed: true })];
      expect(store.shoppingDestinations).toEqual([]);
    });
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
    // The flag is NOT touched: only `setNotifyParents` (adults only) may change it.
    expect(patch).not.toHaveProperty('notifyParents');
    expect(store.completedLists).toEqual([]); // not filed despite the stale flag
  });

  // A stray tap on One-off and back used to turn a daily list weekly, which then stopped
  // resetting every day (greg's family, 2026-11-13).
  it('setLifecycle keeps the schedule across recurring → one-off → recurring', async () => {
    const store = useListStore();
    const cadence = { unit: 'day', interval: 1 } as const;
    store.lists = [list({ id: 'd', lifecycle: 'recurring', frequency: 'daily', cadence })];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      const next = { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
      store.lists = store.lists.map((x) => (x.id === id ? next : x));
      return next;
    });

    await store.setLifecycle('d', 'oneoff');
    const off = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(off).not.toHaveProperty('frequency');
    expect(off).not.toHaveProperty('cadence');

    await store.setLifecycle('d', 'recurring');
    const back = store.lists.find((x) => x.id === 'd')!;
    expect(back.lifecycle).toBe('recurring');
    expect(back.frequency).toBe('daily');
    expect(back.cadence).toEqual(cadence);
  });

  // A cadence the legacy enum cannot express keeps `frequency` undefined on purpose; writing
  // 'weekly' over it would make an older build reset an every-2-weeks list weekly.
  it('setLifecycle back to recurring leaves a kept custom cadence without a frequency', async () => {
    const store = useListStore();
    const cadence = { unit: 'week' as const, interval: 2, weekdays: [3] };
    store.lists = [list({ id: 'c', lifecycle: 'oneoff', cadence })];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });
    await store.setLifecycle('c', 'recurring');
    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch).not.toHaveProperty('frequency');
    expect(patch).not.toHaveProperty('cadence');
  });

  it('setLifecycle starts a list that never repeated on the weekly default', async () => {
    const store = useListStore();
    store.lists = [list({ id: 'n', lifecycle: 'oneoff' })];
    vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
      const cur = store.lists.find((x) => x.id === id)!;
      return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
    });
    await store.setLifecycle('n', 'recurring');
    const patch = vi.mocked(listRepo.updateList).mock.calls[0]![1] as Partial<FamilyList>;
    expect(patch.frequency).toBe('weekly');
  });

  // ── "Keep Parents Posted" (greg, 2026-11-06) ───────────────────────────────

  describe('setNotifyParents', () => {
    const notifyEvents = (message = 'notify_parents_set') =>
      logEventMock.mock.calls
        .map(([e]) => e)
        .filter((e) => e.surface === 'recurrence' && e.message === message);

    /** Keep Parents Posted is adults-only: sign a member in. */
    async function signInAs(over: Record<string, unknown>): Promise<void> {
      const { useFamilyStore } = await import('@/stores/familyStore');
      const fam = useFamilyStore();
      fam.members = [
        { id: 'm-viewer', name: 'Viewer', role: 'owner', ageGroup: 'adult', ...over },
      ] as never;
      fam.setCurrentMember((over.id as string) ?? 'm-viewer');
    }

    it('writes true when on and undefined (never false) when off, and logs each', async () => {
      await signInAs({});
      const store = useListStore();
      store.lists = [list({ id: 'r', lifecycle: 'recurring', frequency: 'daily' })];
      vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
        const cur = store.lists.find((x) => x.id === id)!;
        return { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
      });

      await store.setNotifyParents('r', true);
      await store.setNotifyParents('r', false);

      expect(vi.mocked(listRepo.updateList).mock.calls.map((c) => c[1])).toEqual([
        { notifyParents: true },
        { notifyParents: undefined },
      ]);
      expect(notifyEvents().map((e) => [e.level, e.context])).toEqual([
        ['info', { recur_surface: 'list', action: 'on' }],
        ['info', { recur_surface: 'list', action: 'off' }],
      ]);
    });

    it('refuses, never silently: a missing list, a one-off list and a child viewer', async () => {
      const store = useListStore();
      await signInAs({});
      store.lists = [list({ id: 'o', lifecycle: 'oneoff' })];
      expect(await store.setNotifyParents('gone', true)).toBeNull();
      expect(await store.setNotifyParents('o', true)).toBeNull();

      await signInAs({ id: 'm-kid', role: 'member', ageGroup: 'child' });
      store.lists = [list({ id: 'r', lifecycle: 'recurring', frequency: 'daily' })];
      expect(await store.setNotifyParents('r', false)).toBeNull();

      expect(listRepo.updateList).not.toHaveBeenCalled();
      expect(notifyEvents()).toEqual([]);
      expect(notifyEvents('refused').map((e) => [e.level, e.context])).toEqual([
        ['warn', { action: 'notify-parents', recur_surface: 'list', detail: 'not-found' }],
        ['warn', { action: 'notify-parents', recur_surface: 'list', detail: 'not-recurring' }],
        ['warn', { action: 'notify-parents', recur_surface: 'list', detail: 'not-adult' }],
      ]);
    });
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
  // ⚠️ INSIDE `describe('listStore')`, not a top-level sibling. It was a sibling,
  // which meant it inherited neither `setActivePinia(createPinia())` nor the
  // mock reset — running it alone (`-t setAllItemsCompleted`) failed every test
  // with "no active Pinia", and in a full run its "ONE write, not one per item"
  // assertion silently depended on the preceding test making zero writes.
  describe('setAllItemsCompleted', () => {
    function seed(items: FamilyListItem[]) {
      const store = useListStore();
      store.lists = [list({ id: 'l1', items })];
      vi.mocked(listRepo.updateList).mockImplementation(async (id, input) => {
        const cur = store.lists.find((x) => x.id === id)!;
        const next = { ...cur, ...(input as Partial<FamilyList>) } as FamilyList;
        store.lists = store.lists.map((x) => (x.id === id ? next : x));
        return next;
      });
      return store;
    }
    const item = (id: string, completed = false): FamilyListItem => ({ id, title: id, completed });

    it('ticks every item in ONE write, and files the list', async () => {
      const store = seed([item('a'), item('b')]);
      const updated = await store.setAllItemsCompleted('l1', true, 'm1');
      expect(updated?.items.every((i) => i.completed)).toBe(true);
      // Filing comes from the shared derivation, not a second code path.
      expect(updated?.completed).toBe(true);
      expect(updated?.completedBy).toBe('m1');
      // One write for the whole list — not one per item.
      expect(vi.mocked(listRepo.updateList)).toHaveBeenCalledTimes(1);
    });

    it('🔴 does NOT rewrite attribution on items that were ALREADY ticked', async () => {
      // A child ticks two of three; a parent taps "Tick all". Before this, all
      // three read as the parent's, re-dated to now — and on a recurring list that
      // is permanent, because `listCycles` archives `completedBy` into the cycle
      // history at rollover and ADR-032 says history is never truncated.
      const already = [
        { id: 'a', title: 'a', completed: true, completedBy: 'kid', completedAt: 'T1' },
        { id: 'b', title: 'b', completed: true, completedBy: 'kid', completedAt: 'T1' },
        item('c'),
      ] as FamilyListItem[];
      const store = seed(already);
      const updated = await store.setAllItemsCompleted('l1', true, 'parent');

      expect(updated?.items.every((i) => i.completed)).toBe(true);
      // The child keeps credit for the two they did.
      expect(updated?.items[0]!.completedBy).toBe('kid');
      expect(updated?.items[0]!.completedAt).toBe('T1');
      expect(updated?.items[1]!.completedBy).toBe('kid');
      // Only the one that actually changed is stamped to the parent.
      expect(updated?.items[2]!.completedBy).toBe('parent');
    });

    it('🔴 clears every tick AND un-files a completed list', async () => {
      // The way back from a list filed by accident: the same derivation, run on the
      // opposite input.
      const store = seed([item('a', true), item('b', true)]);
      store.lists = [
        list({ id: 'l1', items: [item('a', true), item('b', true)], completed: true }),
      ];
      const cleared = await store.setAllItemsCompleted('l1', false, 'm1');
      expect(cleared?.items.every((i) => !i.completed)).toBe(true);
      expect(cleared?.completed).toBe(false);
      expect(cleared?.completedAt).toBeUndefined();
    });

    it('records who ticked them, and forgets on a clear', async () => {
      const store = seed([item('a')]);
      const done = await store.setAllItemsCompleted('l1', true, 'm2');
      expect(done?.items[0]?.completedBy).toBe('m2');
      const undone = await store.setAllItemsCompleted('l1', false, 'm2');
      expect(undone?.items[0]?.completedBy).toBeUndefined();
    });

    it('returns null for a list that vanished, rather than throwing', async () => {
      const store = seed([item('a')]);
      await expect(store.setAllItemsCompleted('gone', true, 'm1')).resolves.toBeNull();
    });

    it('leaves an empty list unfiled', async () => {
      // `deriveCompletion` requires items.length > 0 — an empty list never files.
      const store = seed([]);
      const updated = await store.setAllItemsCompleted('l1', true, 'm1');
      expect(updated?.completed).toBe(false);
    });
  });

  // ── Lists work like to-dos (plan 2026-11-13): several assignees, a show rule ──
  describe('ownership and the show rule', () => {
    const events = (surface: string, message: string) =>
      logEventMock.mock.calls
        .map(([e]) => e)
        .filter((e) => e.surface === surface && e.message === message);
    const writes = () =>
      vi.mocked(listRepo.updateList).mock.calls.map((c) => c[1] as Partial<FamilyList>);
    /** The pair is in step after every write: absent, or `ownerId` its first. */
    const inStep = (l: Partial<FamilyList>) =>
      l.assigneeIds === undefined || l.assigneeIds[0] === l.ownerId;

    async function family(): Promise<void> {
      const { useFamilyStore } = await import('@/stores/familyStore');
      useFamilyStore().members = [
        { id: 'm-1', name: 'Greg' },
        { id: 'm-2', name: 'Sam' },
      ] as never;
    }
    function seed(...lists: FamilyList[]) {
      const store = useListStore();
      store.lists = lists;
      mergeUpdate(store);
      return store;
    }

    describe('setAssignees', () => {
      it('saves a stale id plus one added person without the stale id', async () => {
        await family();
        const store = seed(list({ assigneeIds: ['m-1', 'ghost'] }));
        const saved = await store.setAssignees('l-1', ['m-1', 'ghost', 'm-2']);
        expect(writes()).toEqual([{ assigneeIds: ['m-1', 'm-2'], ownerId: 'm-1' }]);
        expect(saved && inStep(saved)).toBe(true);
        expect(events('lists', 'assignees-set').map((e) => e.context)).toEqual([
          { action: 'assignees', count: 2 },
        ]);
        expect(events('lists', 'assignees-pruned').map((e) => e.context)).toEqual([
          { action: 'assignees', count: 1 },
        ]);
      });

      it('makes the first id the owner, de-duplicated', async () => {
        await family();
        const store = seed(list());
        await store.setAssignees('l-1', ['m-2', 'm-1', 'm-2']);
        expect(writes()).toEqual([{ assigneeIds: ['m-2', 'm-1'], ownerId: 'm-2' }]);
        // Nothing stale was dropped (a duplicate is not a removed member): no pruned event.
        expect(events('lists', 'assignees-pruned')).toEqual([]);
      });

      it('refuses an empty result (none chosen, or only removed members), with a log', async () => {
        await family();
        const store = seed(list());
        expect(await store.setAssignees('l-1', [])).toBeNull();
        expect(await store.setAssignees('l-1', ['ghost'])).toBeNull();
        expect(await store.setAssignees('gone', ['m-1'])).toBeNull();
        expect(listRepo.updateList).not.toHaveBeenCalled();
        expect(events('lists', 'assignees-refused').map((e) => [e.level, e.context])).toEqual([
          ['warn', { action: 'assignees', detail: 'empty' }],
          ['warn', { action: 'assignees', detail: 'empty' }],
          ['warn', { action: 'assignees', detail: 'not-found' }],
        ]);
      });
    });

    describe('setShowRule', () => {
      it('refuses an invalid rule with a log on the to-do rule surface', async () => {
        const store = seed(list({ dueDate: '2026-06-30' }));
        expect(await store.setShowRule('l-1', { kind: 'from', date: 'soon' })).toBeNull();
        expect(await store.setShowRule('l-1', { kind: 'lead', days: 3 })).toBeNull(); // one-off
        expect(await store.setShowRule('gone', { kind: 'now' })).toBeNull();
        expect(listRepo.updateList).not.toHaveBeenCalled();
        expect(events('todo-visibility', 'refused').map((e) => e.context)).toEqual([
          { action: 'show-rule', detail: 'invalid-date', recur_surface: 'list' },
          { action: 'show-rule', detail: 'invalid-lead', recur_surface: 'list' },
          { action: 'show-rule', detail: 'not-found', recur_surface: 'list' },
        ]);
      });

      it('clamps a weekly list lead to 6, reading the cadence from frequency alone', async () => {
        // A list made repeating by the lifecycle flip stores `frequency` only.
        const weekly = list({
          lifecycle: 'recurring',
          frequency: 'weekly',
          lastResetDate: '2026-06-15',
        });
        const store = seed(weekly);
        expect(await store.setShowRule('l-1', { kind: 'lead', days: 7 })).toBeNull();
        expect(await store.setShowRule('l-1', { kind: 'lead', days: 6 })).toBeTruthy();
        expect(writes()).toEqual([{ showFrom: undefined, showOn: undefined, showLeadDays: 6 }]);
        expect(events('todo-visibility', 'show rule set').map((e) => e.context)).toEqual([
          { action: 'lead', detail: 'repeat', count: 6, recur_surface: 'list' },
        ]);
      });

      it("stores a list's default (on the due date) as nothing, and right away as showOn now", async () => {
        const store = seed(list({ dueDate: '2026-06-30', showFrom: '2026-06-20' }));
        await store.setShowRule('l-1', { kind: 'due' });
        await store.setShowRule('l-1', { kind: 'now' });
        expect(writes()).toEqual([
          { showFrom: undefined, showOn: undefined, showLeadDays: undefined },
          { showFrom: undefined, showOn: 'now', showLeadDays: undefined },
        ]);
      });
    });

    describe('the write funnels keep the pair in step', () => {
      it('createList normalises: assigneeIds wins over a disagreeing ownerId', async () => {
        await family();
        const store = useListStore();
        vi.mocked(listRepo.createList).mockImplementation(
          async (input) => ({ ...(input as object), id: 'n' }) as FamilyList
        );
        const made = await store.createList({
          ...list(),
          ownerId: 'm-1',
          assigneeIds: ['m-2', 'm-1'],
        } as never);
        expect(made).toMatchObject({ ownerId: 'm-2', assigneeIds: ['m-2', 'm-1'] });
        const single = await store.createList({ ...list(), ownerId: 'm-1' } as never);
        expect(single).toMatchObject({ ownerId: 'm-1', assigneeIds: ['m-1'] });
        expect([made!, single!].every(inStep)).toBe(true);
      });

      it('createList refuses any assignee that is not in the family', async () => {
        await family();
        const store = useListStore();
        expect(
          await store.createList({ ...list(), assigneeIds: ['m-1', 'ghost'] } as never)
        ).toBeNull();
        expect(listRepo.createList).not.toHaveBeenCalled();
      });

      it('updateList rewrites an ownership change as the pair', async () => {
        const store = seed(list({ assigneeIds: ['m-1', 'm-2'] }));
        await store.updateList('l-1', { ownerId: 'm-2' });
        expect(writes()).toEqual([{ ownerId: 'm-2', assigneeIds: ['m-2'] }]);
        expect(inStep(store.lists[0]!)).toBe(true);
      });

      // X wrote owner m-2 of [m-2]; Y wrote owner m-1 of [m-1, m-2, m-3]; the merge took
      // `ownerId` from Y and `assigneeIds` from X. The reading is the owner alone, but storing
      // it would drop m-2 for good, so an unattended write (a reset) leaves the pair as stored.
      it('never heals an owner that is not listed: the reset leaves the stored people alone', async () => {
        const drifted = list({
          id: 'r',
          ownerId: 'm-1',
          assigneeIds: ['m-2'],
          lifecycle: 'recurring',
          frequency: 'daily',
          lastResetDate: '2026-06-16',
          items: [], // no items: the plain `updateList` reset, not the archive batch
        });
        const store = seed(drifted, list({ id: 'ok', assigneeIds: ['m-1'] }));
        await store.reconcileRecurringLists();
        await store.renameList('ok', 'Renamed');
        const [reset, rename] = writes();
        expect(reset).toMatchObject({ lastResetDate: expect.any(String) });
        expect('ownerId' in reset! || 'assigneeIds' in reset!).toBe(false);
        expect(rename).toEqual({ title: 'Renamed' });
        // Only a person setting the people writes the pair.
        await family();
        await store.setAssignees('r', ['m-1', 'm-2']);
        expect(writes()[2]).toEqual({ assigneeIds: ['m-1', 'm-2'], ownerId: 'm-1' });
      });

      // An empty owner reads as the stored ids, so storing that reading loses nobody.
      it('heals an empty owner to the stored ids on the next write', async () => {
        const store = seed(list({ id: 'e', ownerId: '', assigneeIds: ['m-2', '', 'm-1', 'm-2'] }));
        expect(listAssignees(store.lists[0]!)).toEqual(['m-2', 'm-1']);
        await store.renameList('e', 'Renamed');
        expect(writes()).toEqual([
          { title: 'Renamed', assigneeIds: ['m-2', 'm-1'], ownerId: 'm-2' },
        ]);
        expect(inStep(store.lists[0]!)).toBe(true);
      });

      // Device A saved [m-1, m-2], device B saved [m-2, m-1]; the merge took `ownerId` from B and
      // `assigneeIds` from A. Healing to the owner alone would drop m-1 for good.
      it('heals a pair merged field by field to everyone listed, owner first', async () => {
        const merged = list({ id: 'x', ownerId: 'm-2', assigneeIds: ['m-1', 'm-2'] });
        const store = seed(merged);
        await store.renameList('x', 'Renamed');
        expect(writes()).toEqual([
          { title: 'Renamed', assigneeIds: ['m-2', 'm-1'], ownerId: 'm-2' },
        ]);
        expect(inStep(store.lists[0]!)).toBe(true);
      });

      it('archives a shared list cycle with everyone it was for, owner first', async () => {
        const shared = list({
          id: 'r',
          assigneeIds: ['m-1', 'm-2'],
          lifecycle: 'recurring',
          frequency: 'daily',
          lastResetDate: '2026-06-16',
          items: [item({ id: 'i1', completed: true })],
        });
        const store = seed(shared);
        vi.mocked(listRepo.getListById).mockResolvedValue({
          ...shared,
          lastResetDate: '2026-06-17',
        } as FamilyList);
        await store.reconcileRecurringLists();
        const [cycle] = vi.mocked(cycleRepo.archiveCycleAndReset).mock.calls[0]!;
        expect([cycle.ownerId, cycle.assigneeIds]).toEqual(['m-1', ['m-1', 'm-2']]);
        // A single-owner list's cycle carries no `assigneeIds`, as older cycles do not.
        vi.mocked(cycleRepo.archiveCycleAndReset).mockClear();
        store.lists = [{ ...shared, assigneeIds: undefined }];
        await store.reconcileRecurringLists();
        expect('assigneeIds' in vi.mocked(cycleRepo.archiveCycleAndReset).mock.calls[0]![0]).toBe(
          false
        );
      });

      it('the show rule follows a one-off due date (a "Show from" past the new date clears)', async () => {
        const store = seed(list({ dueDate: '2026-06-30', showFrom: '2026-06-25' }));
        await store.updateList('l-1', { dueDate: '2026-06-24' });
        expect(writes()).toEqual([
          {
            dueDate: '2026-06-24',
            showFrom: undefined,
            showOn: undefined,
            showLeadDays: undefined,
          },
        ]);
      });

      it('setLifecycle clears the show rule in both directions', async () => {
        const store = seed(list({ dueDate: '2026-06-30', showFrom: '2026-06-25' }));
        await store.setLifecycle('l-1', 'recurring');
        await store.setLifecycle('l-1', 'oneoff');
        for (const w of writes()) {
          expect(w).toMatchObject({
            showFrom: undefined,
            showOn: undefined,
            showLeadDays: undefined,
          });
          expect('showFrom' in w && 'showOn' in w && 'showLeadDays' in w).toBe(true);
        }
      });
    });

    describe('the load-time audit', () => {
      it('logs owner-drift and show-rule-invalid once per list per session, and writes nothing', async () => {
        const lists = [
          list({ id: 'audit-drift', ownerId: 'm-2', assigneeIds: ['m-1', 'm-2'] }),
          list({ id: 'audit-moved', ownerId: 'm-3', assigneeIds: ['m-1', 'm-2'] }),
          list({ id: 'audit-noowner', ownerId: '', assigneeIds: ['m-1'] }),
          list({ id: 'audit-date', dueDate: '2026-06-30', showFrom: 'next week' }),
          // Values `showRuleOf` never reads are not faults: an explicit `showOn` decides first,
          // and an undated one-off is always `now`.
          list({ id: 'audit-shown', dueDate: '2026-06-30', showOn: 'now', showFrom: 'bad' }),
          list({ id: 'audit-undated', showFrom: 'bad' }),
          list({
            id: 'audit-nowlead',
            lifecycle: 'recurring',
            frequency: 'weekly',
            lastResetDate: '2026-06-15',
            showOn: 'now',
            showLeadDays: 0,
          }),
          list({
            id: 'audit-lead',
            lifecycle: 'recurring',
            frequency: 'weekly',
            lastResetDate: '2026-06-15',
            showLeadDays: 0,
          }),
          // A schedule but no baseline: it never comes due, so it reads as waiting.
          list({ id: 'audit-noreset', lifecycle: 'recurring', frequency: 'daily' }),
          // No schedule at all: `resolveListRule` says nothing about it, so the audit must.
          list({ id: 'audit-nosched', lifecycle: 'recurring', lastResetDate: '2026-06-15' }),
          list({ id: 'audit-ok', assigneeIds: ['m-1', 'm-2'] }),
          // A lead longer than a weekly repeat allows is clamped on read, kept on purpose.
          list({
            id: 'audit-longlead',
            lifecycle: 'recurring',
            frequency: 'weekly',
            lastResetDate: '2026-06-15',
            showLeadDays: 9,
          }),
        ];
        vi.mocked(listRepo.getAllLists).mockResolvedValue(lists);
        const store = useListStore();
        await store.loadLists();
        await store.loadLists();
        expect(events('lists', 'owner-drift').map((e) => [e.level, e.context])).toEqual([
          ['warn', { action: 'owner-drift', detail: 'owner-reordered', count: 2 }],
          ['warn', { action: 'owner-drift', detail: 'owner-not-listed', count: 2 }],
          ['warn', { action: 'owner-drift', detail: 'owner-empty', count: 1 }],
        ]);
        expect(events('lists', 'show-rule-invalid').map((e) => e.context)).toEqual([
          { action: 'show-rule-invalid', detail: 'invalid-date', kind: 'once' },
          { action: 'show-rule-invalid', detail: 'invalid-lead', kind: 'repeat' },
        ]);
        // Its own message and once-key, so it never hides (or is hidden by) a rule fault.
        expect(events('lists', 'list-never-due').map((e) => e.context)).toEqual([
          { action: 'list-never-due', detail: 'no-reset-day', kind: 'repeat' },
          { action: 'list-never-due', detail: 'no-schedule', kind: 'repeat' },
        ]);
      });
    });
  });
});

/**
 * Ticking or clearing every item at once (#88 follow-up).
 *
 * Routed through the same `deriveCompletion` as `toggleItem`, so filing,
 * un-filing and the celebration behave exactly as they do when a family ticks
 * the last box by hand — and it is ONE write, not one per item.
 */
