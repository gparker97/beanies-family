/**
 * #150: the location and its picked place travel as a pair through a recurring occurrence
 * edit. The form diffs against its open-time baseline (both built through `placePatch`), so an
 * edit that only touches the title never names either key, and `materializeOverride` copies the
 * parent's pair onto the new child.
 */
import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivityStore } from '@/stores/activityStore';
import { diffPayload } from '@/utils/diffPayload';
import { placePatch } from '@/utils/location/placeText';
import type { FamilyActivity, PlaceRef } from '@/types/models';

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

vi.mock('@/utils/linkedRecurringItem', () => ({
  syncEntityLinkedRecurringItem: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/composables/useToday', () => ({
  useToday: () => ({
    today: { value: '2026-03-01' },
    startOfToday: { value: new Date(2026, 2, 1) },
    isVisible: { value: true },
    lastVisibleAt: { value: 0 },
    lastHiddenAt: { value: 0 },
  }),
}));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({ clearLinksFor: vi.fn(), lists: [], linkListsToActivity: vi.fn() }),
}));
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({ todos: [], linkTodosToActivity: vi.fn() }),
}));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/actionFailure', () => ({
  reportSessionActionFailed: vi.fn(),
  reportRecurringItemActionFailed: vi.fn(),
}));

const PLACE: PlaceRef = { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' };
const LOCATION = `${PLACE.name}, block 48 unit 04-19`;
const CLICKED = '2026-04-01';

const template = (): FamilyActivity =>
  ({
    id: 'tpl-1',
    title: 'Piano Lesson',
    date: '2026-03-04',
    startTime: '15:00',
    endTime: '16:00',
    recurrence: 'weekly',
    daysOfWeek: [3],
    category: 'piano',
    assigneeId: 'child-1',
    isActive: true,
    createdBy: 'parent-1',
    location: LOCATION,
    locationPlace: PLACE,
    createdAt: '2026-02-28T00:00:00.000Z',
    updatedAt: '2026-02-28T00:00:00.000Z',
  }) as unknown as FamilyActivity;

/** The form payload the way `ActivityModal.buildPayload` spells these two fields. */
const payload = (title: string, text: string, place: PlaceRef | undefined) => ({
  title,
  ...placePatch('location', text.trim() || undefined, place),
});

describe('recurring occurrence + locationPlace', () => {
  let store: ReturnType<typeof useActivityStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    store = useActivityStore();
    let n = 0;
    vi.mocked(activityRepo.createActivity).mockImplementation(
      async (input: unknown) => ({ ...(input as object), id: `child-${++n}` }) as FamilyActivity
    );
    store.activities = [template()];
  });

  it('editing only the title names neither location nor locationPlace in the diff', async () => {
    const baseline = payload('Piano Lesson', LOCATION, PLACE);
    const diff = diffPayload(baseline, payload('Piano Lesson (Grade 3)', LOCATION, PLACE));
    expect(diff).toEqual({ title: 'Piano Lesson (Grade 3)' });
    expect('location' in diff).toBe(false);
    expect('locationPlace' in diff).toBe(false);

    const child = await store.materializeOverride('tpl-1', CLICKED, diff);
    // The new child carries the parent's pair, unchanged and matching.
    expect(child?.title).toBe('Piano Lesson (Grade 3)');
    expect(child?.location).toBe(LOCATION);
    expect(child?.locationPlace).toEqual(PLACE);
  });

  it('a place stored with a different key order is still "unchanged" after makePlaceRef', () => {
    const reordered = { name: PLACE.name, placeId: PLACE.placeId } as PlaceRef;
    const diff = diffPayload(
      payload('Piano Lesson', LOCATION, PLACE),
      payload('Piano Lesson', LOCATION, reordered)
    );
    expect(diff).toEqual({});
  });

  it('removing the place on one occurrence writes locationPlace: undefined on the child only', async () => {
    const diff = diffPayload(
      payload('Piano Lesson', LOCATION, PLACE),
      payload('Piano Lesson', LOCATION, undefined)
    );
    expect(diff).toHaveProperty('locationPlace', undefined);
    expect('location' in diff).toBe(false);

    await store.materializeOverride('tpl-1', CLICKED, diff);
    const created = vi.mocked(activityRepo.createActivity).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(created).toHaveProperty('locationPlace', undefined);
    expect(created.location).toBe(LOCATION);
    // The series itself still carries its place.
    expect(store.activities.find((a) => a.id === 'tpl-1')?.locationPlace).toEqual(PLACE);
    expect(vi.mocked(activityRepo.updateActivity)).not.toHaveBeenCalled();
  });
});
