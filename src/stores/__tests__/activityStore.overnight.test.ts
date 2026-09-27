/**
 * Overnight TIMED activities (22:00-01:00): the next-morning tail is a drawn
 * continuation, never an event of its own. docs/plans/2026-09-27-overnight-continuation-and-fixes.md
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityStore } from '../activityStore';
import type { FamilyActivity } from '@/types/models';

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

const { mockToday } = vi.hoisted(() => ({ mockToday: { value: '2026-05-30' } }));
vi.mock('@/composables/useToday', () => ({
  useToday: () => ({
    today: mockToday,
    startOfToday: { value: new Date(2026, 4, 30) },
    isVisible: { value: true },
    lastVisibleAt: { value: 0 },
    lastHiddenAt: { value: 0 },
  }),
}));

const NOW = '2026-05-01T00:00:00.000Z';

function night(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'night',
    title: 'Sleepover',
    date: '2026-05-31',
    startTime: '22:00',
    endTime: '01:00',
    recurrence: 'none',
    category: 'other',
    feeSchedule: 'none',
    reminderMinutes: 15,
    isActive: true,
    createdBy: 'm',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as FamilyActivity;
}

const drawn = (store: ReturnType<typeof useActivityStore>, y: number, m: number, id = 'night') =>
  store
    .monthActivities(y, m)
    .filter((o) => o.activity.id === id)
    .map((o) => [o.date, o.repeatStart ?? o.date]);

describe('overnight timed activities', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('⭐ a one-off on the 31st draws its tail on the 1st of the next month', () => {
    const store = useActivityStore();
    store.activities.push(night());
    expect(drawn(store, 2026, 4)).toEqual([['2026-05-31', '2026-05-31']]);
    expect(drawn(store, 2026, 5)).toEqual([['2026-06-01', '2026-05-31']]);
  });

  it('⭐ the synced shape (explicit next-day endDate) draws the same tail', () => {
    const store = useActivityStore();
    store.activities.push(night({ endDate: '2026-06-01' }));
    expect(drawn(store, 2026, 5)).toEqual([['2026-06-01', '2026-05-31']]);
  });

  it('an event ending exactly at midnight has no tail', () => {
    const store = useActivityStore();
    store.activities.push(night({ endTime: '00:00' }));
    expect(drawn(store, 2026, 5)).toEqual([]);
  });

  it('⭐ a daily overnight series keeps BOTH the tail and the start on each day', () => {
    const store = useActivityStore();
    store.activities.push(night({ date: '2026-05-01', recurrence: 'daily' }));
    const may3 = drawn(store, 2026, 4).filter(([d]) => d === '2026-05-03');
    expect(may3).toEqual([
      ['2026-05-03', '2026-05-02'],
      ['2026-05-03', '2026-05-03'],
    ]);
  });

  it('a rule-bearing weekly series crosses the month end, and its end date keeps the last tail', () => {
    const store = useActivityStore();
    store.activities.push(
      night({
        date: '2026-05-03',
        recurrence: 'weekly',
        daysOfWeek: [0],
        rule: {
          unit: 'week',
          interval: 1,
          weekdays: [0],
          end: { kind: 'onDate', date: '2026-05-31' },
        },
        recurrenceEndDate: '2026-05-31',
      } as Partial<FamilyActivity>)
    );
    expect(drawn(store, 2026, 5)).toEqual([['2026-06-01', '2026-05-31']]);
  });

  it("an override of one night suppresses that night's start and its tail", () => {
    const store = useActivityStore();
    store.activities.push(
      night({ date: '2026-05-01', recurrence: 'daily' }),
      night({
        id: 'child',
        date: '2026-05-10',
        parentActivityId: 'night',
        startTime: '21:00',
        endTime: '02:00',
      })
    );
    const days = drawn(store, 2026, 4);
    expect(days).not.toContainEqual(['2026-05-10', '2026-05-10']);
    expect(days).not.toContainEqual(['2026-05-11', '2026-05-10']);
    expect(drawn(store, 2026, 4, 'child')).toEqual([
      ['2026-05-10', '2026-05-10'],
      ['2026-05-11', '2026-05-10'],
    ]);
  });

  it('activitiesInRange across the month boundary returns the tail exactly once', () => {
    const store = useActivityStore();
    store.activities.push(night());
    const hits = store
      .activitiesInRange('2026-05-25', '2026-06-05')
      .filter((o) => o.activity.id === 'night');
    expect(hits.map((o) => o.date)).toEqual(['2026-05-31', '2026-06-01']);
  });

  it('⭐ the EVENT accessors never include the tail (one duty, reminder, bell entry)', () => {
    const store = useActivityStore();
    store.activities.push(night());
    expect(store.activitiesForDate('2026-06-01')).toEqual([]);
    expect(store.activeActivitiesForMonth(2026, 5)).toEqual([]);
    expect(store.upcomingActivities.map((o) => o.date)).toEqual(['2026-05-31']);
  });

  it('⭐ the EVENT range/month forms (month grid, week dots, upcoming) show one entry per event', () => {
    const store = useActivityStore();
    store.activities.push(night());
    expect(store.eventsInRange('2026-05-25', '2026-06-05').map((o) => o.date)).toEqual([
      '2026-05-31',
    ]);
    expect(store.monthEvents(2026, 5)).toEqual([]);
  });

  it("a series' next occurrence for the list picker is never its tail", () => {
    mockToday.value = '2026-06-06'; // a Saturday, the tail of Friday's shift
    const store = useActivityStore();
    store.activities.push(night({ date: '2026-05-01', recurrence: 'weekly', daysOfWeek: [5] }));
    const next = store.linkableActivities.find((o) => o.activity.id === 'night');
    expect(next?.date).toBe('2026-06-12');
    mockToday.value = '2026-05-30';
  });

  it('⭐ the EVENT path still runs the look-back for an ALL-DAY span across a month end', () => {
    const store = useActivityStore();
    store.activities.push(
      night({
        id: 'camp',
        date: '2026-01-31',
        endDate: '2026-02-02',
        isAllDay: true,
        startTime: undefined,
        endTime: undefined,
        recurrence: 'weekly',
        daysOfWeek: [6],
      })
    );
    const feb = store
      .monthEvents(2026, 1)
      .filter((o) => o.activity.id === 'camp')
      .map((o) => o.date);
    expect(feb.slice(0, 2)).toEqual(['2026-02-01', '2026-02-02']);
  });
});
