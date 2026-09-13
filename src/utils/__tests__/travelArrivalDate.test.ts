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

    // The bug appears STRICTLY EAST of UTC — `getTimezoneOffset() < 0`, not `<= 0`.
    //
    // At exactly UTC the broken form is coincidentally CORRECT: local midnight *is* UTC
    // midnight, so adding a day and reading the UTC date gives the right answer. My first
    // guard used `<= 0`, which passed in Asia/Singapore and failed in CI, where runners are
    // UTC. Measured: UTC and America/New_York → 2026-08-26 (correct); Europe/London and
    // Asia/Singapore → 2026-08-25 (the bug).
    //
    // Worth keeping as a conditional rather than pinning a TZ: it documents exactly where
    // the original defect does and does not bite, which is the thing that made it survive
    // review — it looked fine from the timezones it was tested in.
    if (new Date(`${dep}T00:00:00`).getTimezoneOffset() < 0) {
      expect(broken(dep)).toBe(dep);
    } else {
      expect(broken(dep)).not.toBe(dep);
    }
  });
});

describe('a flight that lands two calendar days later', () => {
  /**
   * The reported bug. A westbound date-line crossing (LAX Monday night → SYD
   * Wednesday morning) lands +2. Arrival was modelled as a BOOLEAN, so it could
   * only ever say +1 — and `computeAccommodationGaps` covers the nights from
   * departure up to arrival, so the second night was reported as unbooked
   * accommodation with no control in the app that could clear it.
   *
   * This mirrors the editor's `deriveArrivalOffset` + `computedArrivalDate` pair,
   * which is where the round-trip has to hold.
   */
  const deriveOffset = (dep: string, arr: string, legacy: boolean): number => {
    if (!dep || !arr) return legacy ? 1 : 0;
    for (let n = 0; n <= 2; n++) if (addDaysYmd(dep, n) === arr) return n;
    return arr > dep ? 2 : 0;
  };

  it('🔴 a +2 arrival round-trips through the editor', () => {
    const dep = '2026-10-05';
    const arr = '2026-10-07';
    const offset = deriveOffset(dep, arr, false);
    expect(offset).toBe(2);
    expect(addDaysYmd(dep, offset)).toBe(arr);
  });

  it('🔴 covers BOTH airborne nights, so neither reads as unbooked', () => {
    // What `computeAccommodationGaps` walks: departure up to (not including) arrival.
    const dep = '2026-10-05';
    const arr = addDaysYmd(dep, 2);
    const covered: string[] = [];
    for (let d = dep; d < arr; d = addDaysYmd(d, 1)) covered.push(d);
    expect(covered).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('still round-trips 0 and +1', () => {
    expect(deriveOffset('2026-10-05', '2026-10-05', false)).toBe(0);
    expect(deriveOffset('2026-10-05', '2026-10-06', false)).toBe(1);
  });

  it('falls back to the legacy boolean when there is no arrival date to measure', () => {
    // Pre-update records stored only `arrivesNextDay`.
    expect(deriveOffset('2026-10-05', '', true)).toBe(1);
    expect(deriveOffset('2026-10-05', '', false)).toBe(0);
  });

  it('clamps an out-of-range stored arrival rather than showing a wrong badge', () => {
    expect(deriveOffset('2026-10-05', '2026-10-20', false)).toBe(2);
  });
});
