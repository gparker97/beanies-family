import { describe, it, expect } from 'vitest';
import {
  isRecurring,
  isFiled,
  isListDue,
  computeRecurringReset,
  listProgress,
} from './listLifecycle';
import type { FamilyList } from '@/types/models';

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

describe('listLifecycle predicates', () => {
  it('isRecurring distinguishes recurring from one-off', () => {
    expect(isRecurring(list({ lifecycle: 'recurring' }))).toBe(true);
    expect(isRecurring(list({ lifecycle: 'oneoff' }))).toBe(false);
  });

  it('isFiled is true only for a completed one-off (recurring is never filed)', () => {
    expect(isFiled(list({ lifecycle: 'oneoff', completed: true }))).toBe(true);
    expect(isFiled(list({ lifecycle: 'oneoff', completed: false }))).toBe(false);
    // A recurring list with completed:true (shouldn't happen) is still never filed.
    expect(isFiled(list({ lifecycle: 'recurring', completed: true }))).toBe(false);
  });

  it('listProgress counts done/total/pct and never returns NaN for an empty list', () => {
    expect(listProgress(list({ items: [] }))).toEqual({ total: 0, done: 0, pct: 0 });
    expect(
      listProgress(
        list({
          items: [
            { id: 'a', title: 'a', completed: true },
            { id: 'b', title: 'b', completed: false },
            { id: 'c', title: 'c', completed: true },
            { id: 'd', title: 'd', completed: false },
          ],
        })
      )
    ).toEqual({ total: 4, done: 2, pct: 50 });
  });

  describe('isListDue', () => {
    const today = '2026-06-17';
    it('classifies one-off due-states relative to today', () => {
      expect(isListDue(list({ dueDate: '2026-06-10' }), today)).toBe('overdue');
      expect(isListDue(list({ dueDate: '2026-06-17' }), today)).toBe('today');
      expect(isListDue(list({ dueDate: '2026-06-25' }), today)).toBeNull(); // future
      expect(isListDue(list({ dueDate: undefined }), today)).toBe('noDue');
    });
    it('returns null for any recurring list (schedule-driven, not due-date-driven)', () => {
      expect(isListDue(list({ lifecycle: 'recurring', frequency: 'weekly' }), today)).toBeNull();
    });
  });

  describe('computeRecurringReset', () => {
    it('never resets without a lastResetDate baseline', () => {
      const r = computeRecurringReset(
        list({ lifecycle: 'recurring', frequency: 'daily', lastResetDate: undefined }),
        '2026-06-17'
      );
      expect(r.shouldReset).toBe(false);
    });

    it('daily resets on any later calendar day and is idempotent same-day', () => {
      const l = list({ lifecycle: 'recurring', frequency: 'daily', lastResetDate: '2026-06-16' });
      expect(computeRecurringReset(l, '2026-06-17')).toEqual({
        shouldReset: true,
        nextResetDate: '2026-06-17',
      });
      // Same-day re-run → no-op (lastResetDate is now current).
      expect(computeRecurringReset({ ...l, lastResetDate: '2026-06-17' }, '2026-06-17')).toEqual({
        shouldReset: false,
        nextResetDate: '2026-06-17',
      });
    });

    it('weekly resets only when the ISO week (Mon start) rolls over', () => {
      // 2026-06-15 is a Monday; 2026-06-17 (Wed) is the same week → no reset.
      const sameWeek = list({
        lifecycle: 'recurring',
        frequency: 'weekly',
        lastResetDate: '2026-06-15',
      });
      expect(computeRecurringReset(sameWeek, '2026-06-17').shouldReset).toBe(false);
      // 2026-06-22 (next Monday) is a new week → reset.
      expect(computeRecurringReset(sameWeek, '2026-06-22').shouldReset).toBe(true);
    });

    it('monthly resets only when the calendar month changes', () => {
      const l = list({ lifecycle: 'recurring', frequency: 'monthly', lastResetDate: '2026-06-30' });
      expect(computeRecurringReset(l, '2026-06-30').shouldReset).toBe(false);
      expect(computeRecurringReset(l, '2026-07-01').shouldReset).toBe(true);
    });

    it('never resets a one-off list', () => {
      expect(
        computeRecurringReset(
          list({ lifecycle: 'oneoff', lastResetDate: '2026-06-01' }),
          '2026-07-01'
        ).shouldReset
      ).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LEGACY RESET PARITY (#70) — the engine must reproduce the old rule exactly
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The pre-#70 reset rule, kept here verbatim as the PARITY ORACLE. It used to
 * live in `listLifecycle.ts`; the engine replaced it, and this is what proves
 * the replacement is faithful. Do not "simplify" these — they are a fixture.
 */
function legacyMondayOf(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function legacyShouldReset(freq: 'daily' | 'weekly' | 'monthly', last: string, today: string) {
  if (freq === 'daily') return today > last;
  if (freq === 'weekly') return legacyMondayOf(today) > legacyMondayOf(last);
  return today.slice(0, 7) > last.slice(0, 7);
}

function recurringList(over: Partial<FamilyList>): FamilyList {
  return {
    id: 'l1',
    title: 'Chores',
    emoji: '🧹',
    category: 'chores',
    ownerId: 'm1',
    items: [],
    lifecycle: 'recurring',
    completed: false,
    createdBy: 'm1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  } as FamilyList;
}

describe('list reset parity — engine reproduces the legacy boundaries', () => {
  const freqs = ['daily', 'weekly', 'monthly'] as const;
  // A month of consecutive days crossing a month boundary, week boundaries and
  // a weekend — every reset boundary the legacy rule could produce.
  const days: string[] = [];
  for (let d = new Date('2026-08-20T00:00:00'); d <= new Date('2026-09-10T00:00:00');) {
    days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }

  it.each(freqs)('%s: every (lastReset, today) pair matches the legacy rule', (frequency) => {
    for (const last of days) {
      for (const today of days) {
        if (today < last) continue;
        const list = recurringList({ frequency, lastResetDate: last, createdAt: '2026-08-01' });
        expect({
          frequency,
          last,
          today,
          reset: computeRecurringReset(list, today).shouldReset,
        }).toEqual({ frequency, last, today, reset: legacyShouldReset(frequency, last, today) });
      }
    }
  });

  it('weekly is anchored to MONDAY, not the list creation weekday', () => {
    // The discriminating fixture: created on a THURSDAY, last reset FRIDAY,
    // checked the following MONDAY. This fails if someone maps weekly to
    // `weekdays: [createdAt.getDay()]` instead of Monday.
    const list = recurringList({
      frequency: 'weekly',
      createdAt: '2026-08-20', // Thursday
      lastResetDate: '2026-08-21', // Friday
    });
    expect(computeRecurringReset(list, '2026-08-24').shouldReset).toBe(true); // Monday
    expect(computeRecurringReset(list, '2026-08-23').shouldReset).toBe(false); // Sunday
  });

  it('a list with no lastResetDate never resets', () => {
    const list = recurringList({ frequency: 'daily', lastResetDate: undefined });
    expect(computeRecurringReset(list, '2026-09-01').shouldReset).toBe(false);
  });

  it('a list with neither cadence nor frequency never resets', () => {
    const list = recurringList({ frequency: undefined, lastResetDate: '2026-08-01' });
    expect(computeRecurringReset(list, '2026-09-01').shouldReset).toBe(false);
  });

  it('an every-2-weeks cadence does NOT drift when a reset day is missed', () => {
    // Anchor and cursor are separate parameters precisely for this: anchoring on
    // `lastResetDate` would push the next reset two weeks past the missed day.
    const list = recurringList({
      cadence: { unit: 'week', interval: 2, weekdays: [1] },
      createdAt: '2026-08-03', // Monday
      lastResetDate: '2026-08-17', // Monday, on-cycle
    });
    // Next on-cycle Monday is 31 Aug. The family doesn't open the app until 2 Sep.
    expect(computeRecurringReset(list, '2026-08-24').shouldReset).toBe(false); // off-cycle week
    expect(computeRecurringReset(list, '2026-08-31').shouldReset).toBe(true);
    expect(computeRecurringReset(list, '2026-09-02').shouldReset).toBe(true); // still due, not skipped
  });
});
