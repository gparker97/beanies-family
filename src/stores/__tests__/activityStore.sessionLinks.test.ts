/**
 * #114 — session links through a "this and future" split, and chip resolution.
 *
 * `splitActivity` moves SESSION-DATED to-dos and lists on/after the split date onto the new
 * series (each keeping its date, one relink per date); whole-activity items stay put. A relink
 * failure is counted once here (`split_relink_failed`); the toast + report belong to the target
 * store's `wrapAsync`, which is mocked out, so nothing here may report a second time.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityStore } from '@/stores/activityStore';
import type { FamilyActivity, FamilyList, TodoItem } from '@/types/models';

vi.mock('@/services/automerge/repositories/activityRepository', () => ({
  getAllActivities: vi.fn(),
  getActivityById: vi.fn(),
  getActivitiesByDate: vi.fn(),
  getActivitiesByAssignee: vi.fn(),
  getActivitiesByCategory: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));
import * as activityRepo from '@/services/automerge/repositories/activityRepository';

vi.mock('@/utils/linkedRecurringItem', () => ({ syncEntityLinkedRecurringItem: vi.fn() }));
vi.mock('@/composables/useToday', () => ({
  useToday: () => ({
    today: { value: '2026-09-01' },
    startOfToday: { value: new Date(2026, 8, 1) },
    isVisible: { value: true },
    lastVisibleAt: { value: 0 },
    lastHiddenAt: { value: 0 },
  }),
}));

const { todoState, listState } = vi.hoisted(() => ({
  todoState: {
    todos: [] as Partial<TodoItem>[],
    linkTodosToActivity: vi.fn(),
  },
  listState: {
    lists: [] as Partial<FamilyList>[],
    linkListsToActivity: vi.fn(),
    clearLinksFor: vi.fn(),
  },
}));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => todoState }));
vi.mock('@/stores/listStore', () => ({ useListStore: () => listState }));

const { logEventMock, reportErrorMock } = vi.hoisted(() => ({
  logEventMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

const SERIES = 'series-1';
const SPLIT = '2026-10-13';

function series(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: SERIES,
    title: 'Soccer',
    date: '2026-09-01',
    startTime: '16:00',
    endTime: '17:00',
    recurrence: 'weekly',
    daysOfWeek: [2],
    category: 'soccer',
    isActive: true,
    createdBy: 'm-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as unknown as FamilyActivity;
}

function events(message: string) {
  return logEventMock.mock.calls.map((c) => c[0]).filter((e) => e.message === message);
}

describe('activityStore — session links (#114)', () => {
  let store: ReturnType<typeof useActivityStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    store = useActivityStore();
    store.activities = [series()];
    vi.mocked(activityRepo.createActivity).mockImplementation(
      async (input: unknown) => ({ ...(input as object), id: 'series-2' }) as FamilyActivity
    );
    vi.mocked(activityRepo.updateActivity).mockImplementation(
      async (id: string, input: unknown) =>
        ({ ...store.activities.find((a) => a.id === id)!, ...(input as object) }) as FamilyActivity
    );
    todoState.todos = [
      { id: 'whole', activityId: SERIES },
      { id: 'before', activityId: SERIES, activityDate: '2026-10-06' },
      { id: 'on-a', activityId: SERIES, activityDate: SPLIT },
      { id: 'on-b', activityId: SERIES, activityDate: SPLIT },
      { id: 'after', activityId: SERIES, activityDate: '2026-10-20' },
      { id: 'elsewhere', activityId: 'other', activityDate: '2026-10-20' },
    ];
    listState.lists = [
      { id: 'list-whole', linkedActivityId: SERIES },
      { id: 'list-after', linkedActivityId: SERIES, activityDate: '2026-10-27' },
    ];
    todoState.linkTodosToActivity.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id }))
    );
    listState.linkListsToActivity.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id }))
    );
  });

  it('relinks only dated items on/after the split, one call per date, keeping each date', async () => {
    const created = await store.splitActivity(SERIES, SPLIT);
    expect(created?.id).toBe('series-2');

    expect(todoState.linkTodosToActivity).toHaveBeenCalledTimes(2);
    expect(todoState.linkTodosToActivity).toHaveBeenCalledWith(['on-a', 'on-b'], {
      activityId: 'series-2',
      activityDate: SPLIT,
    });
    expect(todoState.linkTodosToActivity).toHaveBeenCalledWith(['after'], {
      activityId: 'series-2',
      activityDate: '2026-10-20',
    });
    expect(listState.linkListsToActivity).toHaveBeenCalledTimes(1);
    expect(listState.linkListsToActivity).toHaveBeenCalledWith(['list-after'], {
      activityId: 'series-2',
      activityDate: '2026-10-27',
    });

    expect(events('split_relinked').map((e) => e.context)).toEqual([
      { action: 'split_relinked', activity_id: 'series-2', count: 3, detail: 'todos' },
      { action: 'split_relinked', activity_id: 'series-2', count: 1, detail: 'lists' },
    ]);
    expect(events('split_relinked').every((e) => e.surface === 'activity-links')).toBe(true);
    expect(events('split_relink_failed')).toEqual([]);
  });

  it('leaves a session links alone when its edited child failed to re-parent', async () => {
    store.activities = [
      series(),
      series({
        id: 'child-oct20',
        recurrence: 'none',
        daysOfWeek: undefined,
        date: '2026-10-20',
        parentActivityId: SERIES,
      } as Partial<FamilyActivity>),
    ];
    vi.mocked(activityRepo.updateActivity).mockImplementation(async (id: string, input: unknown) =>
      id === 'child-oct20'
        ? undefined
        : ({
            ...store.activities.find((a) => a.id === id)!,
            ...(input as object),
          } as FamilyActivity)
    );
    await store.splitActivity(SERIES, SPLIT);
    const movedIds = todoState.linkTodosToActivity.mock.calls.flatMap((c) => c[0] as string[]);
    expect(movedIds).toEqual(expect.arrayContaining(['on-a', 'on-b']));
    expect(movedIds).not.toContain('after');
  });

  it('emits split_relinked at count 0 when there is nothing to move', async () => {
    todoState.todos = [{ id: 'whole', activityId: SERIES }];
    listState.lists = [];

    await store.splitActivity(SERIES, SPLIT);

    expect(todoState.linkTodosToActivity).not.toHaveBeenCalled();
    expect(events('split_relinked').map((e) => e.context.count)).toEqual([0, 0]);
  });

  it('a relink failure logs once at warn, never reports again, and keeps the split', async () => {
    todoState.linkTodosToActivity.mockImplementation(async (ids: string[]) =>
      ids.includes('after') ? null : ids.map((id) => ({ id }))
    );

    const created = await store.splitActivity(SERIES, SPLIT);

    expect(created?.id).toBe('series-2');
    const failed = events('split_relink_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      surface: 'activity-links',
      level: 'warn',
      context: {
        action: 'split_relink_failed',
        activity_id: 'series-2',
        count: 1,
        detail: 'todos',
      },
    });
    expect(events('split_relinked')[0].context.count).toBe(2);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  describe('resolveActivityLink', () => {
    it('resolves a series + date to the edited session when there is one', () => {
      const child = series({
        id: 'child',
        date: '2026-10-07',
        originalOccurrenceDate: '2026-10-06',
        parentActivityId: SERIES,
        recurrence: 'none',
      });
      store.activities = [series(), child];

      expect(store.resolveActivityLink({ activityId: SERIES, activityDate: '2026-10-06' })).toEqual(
        { activity: child, date: '2026-10-07' }
      );
      expect(
        store.resolveActivityLink({ activityId: SERIES, activityDate: '2026-10-13' })
      ).toMatchObject({ activity: { id: SERIES }, date: '2026-10-13' });
      expect(store.resolveActivityLink({ activityId: 'gone' })).toBeNull();
    });

    it('a cancelled edited session resolves to null', () => {
      store.activities = [
        series(),
        series({ id: 'child', date: '2026-10-06', parentActivityId: SERIES, isActive: false }),
      ];
      expect(
        store.resolveActivityLink({ activityId: SERIES, activityDate: '2026-10-06' })
      ).toBeNull();
    });
  });
});
