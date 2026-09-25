import { describe, it, expect } from 'vitest';
import { recurringInstanceDate, recurringInstanceKey } from '../recurringInstance';

describe('recurringInstance (#107)', () => {
  it('a row stands for its own date by default', () => {
    expect(recurringInstanceDate({ date: '2026-09-01T00:00:00.000Z' })).toBe('2026-09-01');
  });

  it('a merged row stands for the due date it records, not the day the bank took the money', () => {
    expect(recurringInstanceDate({ date: '2026-09-24', recurringDueDate: '2026-09-28' })).toBe(
      '2026-09-28'
    );
  });

  it('keys a recurring row by item and due date; a one-off has no key', () => {
    expect(
      recurringInstanceKey({
        date: '2026-09-24',
        recurringDueDate: '2026-09-28',
        recurringItemId: 'r',
      })
    ).toBe('r|2026-09-28');
    expect(recurringInstanceKey({ date: '2026-09-24' })).toBeNull();
  });
});
