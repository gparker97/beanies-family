import { describe, it, expect } from 'vitest';
import { relativeWeekLabelKey } from '@/utils/calendarWeek';

// today = Wednesday 2026-05-13; "this week" = Mon 05-11 … Sun 05-17.
const TODAY = '2026-05-13';

describe('relativeWeekLabelKey', () => {
  it('returns "this week" when today is within the row', () => {
    expect(relativeWeekLabelKey('2026-05-11', '2026-05-17', TODAY)).toBe('planner.weekThis');
    // boundary days (first / last of the row) still count as "this week"
    expect(relativeWeekLabelKey(TODAY, '2026-05-19', TODAY)).toBe('planner.weekThis');
    expect(relativeWeekLabelKey('2026-05-07', TODAY, TODAY)).toBe('planner.weekThis');
  });

  it('returns "next week" for a row ≤7 days ahead', () => {
    expect(relativeWeekLabelKey('2026-05-18', '2026-05-24', TODAY)).toBe('planner.weekNext');
  });

  it('returns "upcoming" for a row >7 days ahead', () => {
    expect(relativeWeekLabelKey('2026-05-25', '2026-05-31', TODAY)).toBe('planner.weekUpcoming');
  });

  it('returns "last week" for a row ≤7 days behind', () => {
    expect(relativeWeekLabelKey('2026-05-04', '2026-05-10', TODAY)).toBe('planner.weekLast');
  });

  it('returns "earlier" for a row >7 days behind', () => {
    expect(relativeWeekLabelKey('2026-04-27', '2026-05-03', TODAY)).toBe('planner.weekEarlier');
  });
});
