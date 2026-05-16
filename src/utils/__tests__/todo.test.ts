import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isTodoOverdue, isTodoDueToday } from '../todo';
import type { TodoItem } from '@/types/models';

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't-1',
    title: 'test',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('todo helpers', () => {
  beforeEach(() => {
    // Pin "now" to 15:00 LOCAL on 2026-05-16. Using the (y, m, d, h) constructor
    // makes this deterministic in any timezone — CI runs UTC, dev machines often
    // do not, and the previous UTC-fixed instant only worked east of UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 16, 15, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isTodoOverdue', () => {
    it('returns false when no dueDate', () => {
      expect(isTodoOverdue(todo())).toBe(false);
    });

    it('returns false for completed todos even with a past date', () => {
      expect(isTodoOverdue(todo({ dueDate: '2026-05-01', completed: true }))).toBe(false);
    });

    it('returns true when the dueDate is in the past', () => {
      expect(isTodoOverdue(todo({ dueDate: '2026-05-15' }))).toBe(true);
    });

    it('returns true when dueDate is today but dueTime is in the past', () => {
      expect(isTodoOverdue(todo({ dueDate: '2026-05-16', dueTime: '10:00' }))).toBe(true);
    });

    it('returns false when dueDate is today and dueTime is later today', () => {
      expect(isTodoOverdue(todo({ dueDate: '2026-05-16', dueTime: '23:00' }))).toBe(false);
    });

    it('returns false when dueDate is today with no time (end-of-day fallback)', () => {
      expect(isTodoOverdue(todo({ dueDate: '2026-05-16' }))).toBe(false);
    });
  });

  describe('isTodoDueToday', () => {
    it('returns false when no dueDate', () => {
      expect(isTodoDueToday(todo())).toBe(false);
    });

    it('returns false for completed todos', () => {
      expect(isTodoDueToday(todo({ dueDate: '2026-05-16', completed: true }))).toBe(false);
    });

    it('returns true when dueDate is today (date-only)', () => {
      expect(isTodoDueToday(todo({ dueDate: '2026-05-16' }))).toBe(true);
    });

    it('returns true when dueDate is today with a future time', () => {
      expect(isTodoDueToday(todo({ dueDate: '2026-05-16', dueTime: '23:00' }))).toBe(true);
    });

    it('overdue takes precedence: same-day past-time todos read as overdue, not today', () => {
      const t = todo({ dueDate: '2026-05-16', dueTime: '10:00' });
      expect(isTodoOverdue(t)).toBe(true);
      expect(isTodoDueToday(t)).toBe(false);
    });

    it('returns false for a date in the past', () => {
      expect(isTodoDueToday(todo({ dueDate: '2026-05-15' }))).toBe(false);
    });

    it('returns false for a date in the future', () => {
      expect(isTodoDueToday(todo({ dueDate: '2026-05-17' }))).toBe(false);
    });

    it('handles full ISO datetime values (slices the date portion)', () => {
      expect(isTodoDueToday(todo({ dueDate: '2026-05-16T22:00:00.000Z' }))).toBe(true);
    });
  });
});
