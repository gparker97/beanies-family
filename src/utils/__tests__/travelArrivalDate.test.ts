/**
 * "Arrives next day" must add a day in EVERY timezone.
 *
 * The original built a local Date, added a day, then read the UTC calendar date via
 * toISOString — which cancels the +1 for every user at UTC+0 or east of it. It looked
 * correct from US timezones and was silently wrong across Europe, Africa, Asia and Oceania,
 * setting arrivalDate EQUAL to departureDate on every overnight flight.
 *
 * Downstream that is not cosmetic: the arrival occurrence and its reminder fire on the wrong
 * day, extendTripDates never widens the trip to the real arrival day, and
 * computeAccommodationGaps needs arrival > departure to treat an overnight flight as
 * covering that night — so the night the family was airborne was reported as an unbooked gap.
 */
import { describe, it, expect } from 'vitest';
import { addDaysYmd } from '@/utils/date';

describe('overnight arrival date', () => {
  it('adds exactly one calendar day', () => {
    expect(addDaysYmd('2026-08-25', 1)).toBe('2026-08-26');
  });

  it('crosses a month boundary', () => {
    expect(addDaysYmd('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('is NOT the broken local-Date-then-toISOString pattern', () => {
    // The shape that shipped. Kept as an explicit contrast so nobody reintroduces it: under
    // the test runner's TZ this may or may not agree, and "may or may not" is the bug.
    const broken = (ymd: string) => {
      const d = new Date(`${ymd}T00:00:00`);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    const dep = '2026-08-25';
    expect(addDaysYmd(dep, 1)).not.toBe(dep);
    // Under a UTC+0-or-east TZ the broken form returns the departure date unchanged.
    if (new Date(`${dep}T00:00:00`).getTimezoneOffset() <= 0) {
      expect(broken(dep)).toBe(dep);
    }
  });
});
