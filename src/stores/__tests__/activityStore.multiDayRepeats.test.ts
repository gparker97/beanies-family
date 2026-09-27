/**
 * Multi-day repeating all-day activities (a weekly Fri-Sun weekend): expansion,
 * the repeat an occurrence belongs to, and the edits that must carry a repeat's
 * days along. docs/plans/2026-09-27-multi-day-repeating-activities.md.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityStore, auditRepeatSpans } from '../activityStore';
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
import * as activityRepo from '@/services/automerge/repositories/activityRepository';

const NOW = '2026-05-01T00:00:00.000Z';

/** Weekly Fri-Sun, legacy shape. 2026-05-01 is a Friday. */
function weekend(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'weekend',
    title: 'Custody weekend',
    date: '2026-05-01',
    endDate: '2026-05-03',
    isAllDay: true,
    recurrence: 'weekly',
    daysOfWeek: [5],
    category: 'other',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as FamilyActivity;
}

const datesOn = (
  store: ReturnType<typeof useActivityStore>,
  y: number,
  m: number,
  id = 'weekend'
) =>
  store
    .monthActivities(y, m)
    .filter((o) => o.activity.id === id)
    .map((o) => [o.date, o.repeatStart]);

describe('multi-day repeating activities', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('⭐ draws every day of every repeat, tagged with the repeat start', () => {
    const store = useActivityStore();
    store.activities.push(weekend());
    const may = datesOn(store, 2026, 4);
    expect(may.slice(0, 6)).toEqual([
      ['2026-05-01', '2026-05-01'],
      ['2026-05-02', '2026-05-01'],
      ['2026-05-03', '2026-05-01'],
      ['2026-05-08', '2026-05-08'],
      ['2026-05-09', '2026-05-08'],
      ['2026-05-10', '2026-05-08'],
    ]);
  });

  it('⭐ shows the tail of a repeat that started in the previous month', () => {
    // 2026-05-29 is a Friday: that repeat covers May 29-31. The Fri 2026-07-31
    // repeat covers Aug 1-2, which only the look-back can find.
    const store = useActivityStore();
    store.activities.push(weekend());
    expect(datesOn(store, 2026, 7).slice(0, 2)).toEqual([
      ['2026-08-01', '2026-07-31'],
      ['2026-08-02', '2026-07-31'],
    ]);
  });

  it('does the same for a rule-bearing yearly repeat across the year end', () => {
    const store = useActivityStore();
    store.activities.push(
      weekend({
        id: 'nye',
        date: '2025-12-31',
        endDate: '2026-01-01',
        recurrence: 'yearly',
        daysOfWeek: undefined,
        rule: { unit: 'year', interval: 1, end: { kind: 'never' } },
      })
    );
    expect(datesOn(store, 2027, 0, 'nye')).toEqual([['2027-01-01', '2026-12-31']]);
  });

  it('never draws one activity twice on a date when legacy repeats overlap', () => {
    const store = useActivityStore();
    // Daily, 3 days long: every day is covered by three repeats.
    store.activities.push(weekend({ id: 'daily', recurrence: 'daily', daysOfWeek: undefined }));
    const may = datesOn(store, 2026, 4, 'daily').map(([d]) => d);
    expect(new Set(may).size).toBe(may.length);
    // Earliest start wins.
    expect(datesOn(store, 2026, 4, 'daily')[2]).toEqual(['2026-05-03', '2026-05-01']);
  });

  it('an override of one repeat suppresses all of its days', () => {
    const store = useActivityStore();
    store.activities.push(
      weekend(),
      weekend({
        id: 'child',
        recurrence: 'none',
        daysOfWeek: undefined,
        parentActivityId: 'weekend',
        date: '2026-05-08',
        endDate: '2026-05-10',
        isActive: false,
      })
    );
    const days = datesOn(store, 2026, 4).map(([d]) => d);
    expect(days).not.toContain('2026-05-08');
    expect(days).not.toContain('2026-05-09');
    expect(days).not.toContain('2026-05-10');
    expect(days).toContain('2026-05-15');
  });

  it('⭐ repeatStartFor maps a covered day to the repeat drawn there', () => {
    const store = useActivityStore();
    const a = weekend();
    store.activities.push(a);
    expect(store.repeatStartFor(a, '2026-05-10')).toBe('2026-05-08');
    expect(store.repeatStartFor(a, '2026-05-08')).toBe('2026-05-08');
    // Not a covered day: unchanged.
    expect(store.repeatStartFor(a, '2026-05-12')).toBe('2026-05-12');
  });

  it('a one-off whose end is before its start is drawn as one day, not dropped', () => {
    const store = useActivityStore();
    store.activities.push(
      weekend({ id: 'moved', recurrence: 'none', daysOfWeek: undefined, date: '2026-05-06' })
    );
    expect(datesOn(store, 2026, 4, 'moved')).toEqual([['2026-05-06', undefined]]);
  });

  it("⭐ split carries each repeat's length onto the new start", async () => {
    const store = useActivityStore();
    store.activities.push(weekend());
    vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
      ...(input as FamilyActivity),
      id: 'split',
    }));
    vi.mocked(activityRepo.updateActivity).mockResolvedValue(weekend());
    await store.splitActivity('weekend', '2026-05-15');
    expect(activityRepo.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-05-15', endDate: '2026-05-17' })
    );
  });

  it('⭐ a "this only" edit keeps the repeat\'s days and every day\'s duty ticks', async () => {
    const store = useActivityStore();
    store.activities.push(
      weekend({
        dropoffCompletions: [
          { date: '2026-05-08', completedBy: 'm', completedAt: NOW },
          { date: '2026-05-10', completedBy: 'm', completedAt: NOW },
          { date: '2026-05-15', completedBy: 'm', completedAt: NOW },
        ],
      } as Partial<FamilyActivity>)
    );
    vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
      ...(input as FamilyActivity),
      id: 'child',
    }));
    await store.materializeOverride('weekend', '2026-05-08', { date: '2026-05-09' });
    const created = vi.mocked(activityRepo.createActivity).mock.calls[0]![0] as FamilyActivity;
    expect(created.date).toBe('2026-05-09');
    expect(created.endDate).toBe('2026-05-11');
    // Both ticks of THIS repeat, moved by the same day; next week's stays put.
    expect(created.dropoffCompletions?.map((c) => c.date)).toEqual(['2026-05-09', '2026-05-11']);
  });

  it("⭐ split keeps a TIMED multi-day repeat's end date (Google reads it)", async () => {
    const store = useActivityStore();
    store.activities.push(weekend({ isAllDay: undefined, startTime: '18:00', endTime: '18:00' }));
    vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
      ...(input as FamilyActivity),
      id: 'split',
    }));
    vi.mocked(activityRepo.updateActivity).mockResolvedValue(weekend());
    await store.splitActivity('weekend', '2026-05-15');
    expect(activityRepo.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-05-15', endDate: '2026-05-17' })
    );
  });

  describe('updateActivity owns the span rule', () => {
    beforeEach(() => {
      vi.mocked(activityRepo.updateActivity).mockImplementation(async (id, input) => ({
        ...weekend(),
        id,
        ...(input as Partial<FamilyActivity>),
      }));
    });

    it('⭐ moving a series carries its span, and names the path', async () => {
      const store = useActivityStore();
      store.activities.push(weekend());
      await store.updateActivity('weekend', { date: '2026-05-02' }, { source: 'scope-all' });
      expect(activityRepo.updateActivity).toHaveBeenCalledWith('weekend', {
        date: '2026-05-02',
        endDate: '2026-05-04',
      });
    });

    it('moving an override child carries its span too', async () => {
      const store = useActivityStore();
      store.activities.push(
        weekend({
          id: 'child',
          recurrence: 'none',
          daysOfWeek: undefined,
          parentActivityId: 'weekend',
        })
      );
      await store.updateActivity('child', { date: '2026-05-05' });
      expect(activityRepo.updateActivity).toHaveBeenCalledWith('child', {
        date: '2026-05-05',
        endDate: '2026-05-07',
      });
    });

    it('an explicit endDate (or a clear) wins', async () => {
      const store = useActivityStore();
      store.activities.push(weekend());
      await store.updateActivity('weekend', { date: '2026-05-02', endDate: undefined });
      expect(activityRepo.updateActivity).toHaveBeenCalledWith('weekend', {
        date: '2026-05-02',
        endDate: undefined,
      });
    });

    it('a plain one-off keeps its absolute end (regression guard)', async () => {
      const store = useActivityStore();
      store.activities.push(weekend({ id: 'trip', recurrence: 'none', daysOfWeek: undefined }));
      await store.updateActivity('trip', { date: '2026-05-02' });
      expect(activityRepo.updateActivity).toHaveBeenCalledWith('trip', { date: '2026-05-02' });
    });
  });

  it('⭐ repeatStartFor gives a one-off trip its own start on any of its days', () => {
    const store = useActivityStore();
    const trip = weekend({ id: 'trip', recurrence: 'none', daysOfWeek: undefined });
    store.activities.push(trip);
    expect(store.repeatStartFor(trip, '2026-05-03')).toBe('2026-05-01');
  });

  it('audits multi-day repeats, overlaps and ends before starts', () => {
    expect(
      auditRepeatSpans([
        weekend(),
        weekend({ id: 'daily', recurrence: 'daily', daysOfWeek: undefined }),
        weekend({ id: 'bad', endDate: '2026-04-30' }),
        weekend({ id: 'single', endDate: undefined }),
        weekend({
          id: 'child-bad',
          recurrence: 'none',
          daysOfWeek: undefined,
          parentActivityId: 'weekend',
          endDate: '2026-04-30',
        }),
      ])
    ).toEqual({
      multiDayRepeats: ['weekend', 'daily'],
      overlapping: ['daily'],
      endBeforeStart: ['bad', 'child-bad'],
      clamped: [],
    });
  });
});
