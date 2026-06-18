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
