import { describe, it, expect } from 'vitest';
import { addDaysYmd } from '@/utils/date';
import {
  MAX_ANCHOR_DRIFT_DAYS,
  anchorOffsetDays,
  anchorWeekDays,
  clampAnchorYmd,
  nextAnchorYmd,
  stepDaysFor,
} from '../wallAnchor';

// 2026-09-06 is a Sunday — which used to matter a great deal here, because
// stepping snapped to calendar weeks and so depended on the family's
// weekStartDay. It no longer does: the arrows page by what is on screen.
const TODAY = '2026-09-06';

describe('anchorOffsetDays', () => {
  it('is signed — the property daysBetween does not have', () => {
    expect(anchorOffsetDays('2026-09-13', TODAY)).toBe(7);
    expect(anchorOffsetDays('2026-08-30', TODAY)).toBe(-7);
  });

  it('is zero on today', () => {
    expect(anchorOffsetDays(TODAY, TODAY)).toBe(0);
  });

  it('counts whole days across a month and a year boundary', () => {
    expect(anchorOffsetDays('2026-10-06', TODAY)).toBe(30);
    expect(anchorOffsetDays('2027-01-01', '2026-12-25')).toBe(7);
  });

  it('returns NaN rather than a wrong number for unparseable input', () => {
    expect(anchorOffsetDays('not-a-date', TODAY)).toBeNaN();
    expect(anchorOffsetDays(TODAY, 'not-a-date')).toBeNaN();
  });
});

describe('clampAnchorYmd', () => {
  it('passes a valid nearby date through unchanged', () => {
    expect(clampAnchorYmd('2026-09-10', TODAY)).toBe('2026-09-10');
    expect(clampAnchorYmd('2026-08-01', TODAY)).toBe('2026-08-01');
  });

  // The regression this function exists for: parseLocalDate never throws, it
  // yields an Invalid Date that toDateInputValue renders as "NaN-NaN-NaN", and
  // every downstream addDaysYmd then propagates that string forever.
  it.each([
    ['garbage', 'not-a-date'],
    ['the literal NaN string', 'NaN-NaN-NaN'],
    ['an empty string', ''],
    ['an impossible month', '2026-13-45'],
    ['a date that rolls over', '2026-02-30'],
    ['an unpadded date', '2026-9-1'],
    ['a full ISO timestamp', '2026-09-10T14:00:00.000Z'],
  ])('falls back to today for %s', (_label, input) => {
    expect(clampAnchorYmd(input, TODAY)).toBe(TODAY);
  });

  it('⭐ clamps a real date beyond the drift limit to the LIMIT, not to today', () => {
    // It used to land on today, and the week views draw up to six days past the
    // anchor — so at the forward edge tapping a drawn column header threw the
    // wall a year backwards and, because the caller only switches view on
    // success, said nothing about why. The furthest day the wall will go is the
    // answer the gesture asked for.
    expect(clampAnchorYmd('2028-01-01', TODAY)).toBe(addDaysYmd(TODAY, MAX_ANCHOR_DRIFT_DAYS));
    expect(clampAnchorYmd('2024-01-01', TODAY)).toBe(addDaysYmd(TODAY, -MAX_ANCHOR_DRIFT_DAYS));
    // …and what it clamps to is itself in range, so a second tap is stable.
    expect(clampAnchorYmd(clampAnchorYmd('2028-01-01', TODAY), TODAY)).toBe(
      addDaysYmd(TODAY, MAX_ANCHOR_DRIFT_DAYS)
    );
  });

  it('still lands on today for input that never named a day', () => {
    // There is no meaningful "nearest" day to a malformed string.
    expect(clampAnchorYmd('NaN-NaN-NaN', TODAY)).toBe(TODAY);
    expect(clampAnchorYmd('not-a-date', TODAY)).toBe(TODAY);
  });

  it('accepts a date exactly at the drift limit', () => {
    // Guards the boundary itself: `> MAX` must not be `>= MAX`.
    const edge = '2027-09-07'; // 366 days after 2026-09-06
    expect(anchorOffsetDays(edge, TODAY)).toBe(MAX_ANCHOR_DRIFT_DAYS);
    expect(clampAnchorYmd(edge, TODAY)).toBe(edge);
  });
});

describe('stepDaysFor', () => {
  it('a day step is one day, whatever the layout', () => {
    expect(stepDaysFor('day', 3)).toBe(1);
    expect(stepDaysFor('day', 7)).toBe(1);
  });

  it('a page step is however many columns are drawn', () => {
    expect(stepDaysFor('page', 3)).toBe(3);
    expect(stepDaysFor('page', 5)).toBe(5);
    expect(stepDaysFor('page', 7)).toBe(7);
  });

  it('🔴 never returns zero, however broken the column count', () => {
    // An arrow that moves nothing is indistinguishable from a frozen screen on a
    // wall-mounted tablet, which is the failure this whole surface guards against.
    for (const bad of [0, -3, NaN, Infinity, 0.4]) {
      expect(stepDaysFor('page', bad)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('nextAnchorYmd', () => {
  /**
   * ⚠️ These replace a block that pinned calendar-week SNAPPING — forward from
   * today to the start of next week, back to the start of this one, then blind
   * ±7. That rule made sense only while the days view drew a fixed seven
   * columns. Once the count became responsive, a wall showing three still jumped
   * seven days a press, so four of every seven days were reachable only through
   * the strip below, and the arrows were not inverses of each other.
   */
  describe('pages by exactly the days it is given', () => {
    it('moves three days when three columns are drawn', () => {
      // Visible is [06, 07, 08]; the next unseen day is the 9th, and it becomes
      // the first column. No day is skipped and none is shown twice.
      expect(nextAnchorYmd(TODAY, 3, 1)).toBe('2026-09-09');
      expect(nextAnchorYmd(TODAY, 3, -1)).toBe('2026-09-03');
    });

    it.each([
      [3, '2026-09-09', '2026-09-03'],
      [4, '2026-09-10', '2026-09-02'],
      [5, '2026-09-11', '2026-09-01'],
      [7, '2026-09-13', '2026-08-30'],
    ])('moves %i days a press, in both directions', (columns, forward, back) => {
      expect(nextAnchorYmd(TODAY, columns, 1)).toBe(forward);
      expect(nextAnchorYmd(TODAY, columns, -1)).toBe(back);
    });

    it('a single-day step is still exactly one day', () => {
      expect(nextAnchorYmd('2026-09-10', 1, 1)).toBe('2026-09-11');
      expect(nextAnchorYmd('2026-09-10', 1, -1)).toBe('2026-09-09');
    });

    it('crosses month and year boundaries', () => {
      expect(nextAnchorYmd('2026-09-28', 7, 1)).toBe('2026-10-05');
      expect(nextAnchorYmd('2026-12-28', 7, 1)).toBe('2027-01-04');
      expect(nextAnchorYmd('2027-01-01', 1, -1)).toBe('2026-12-31');
    });
  });

  describe('🔴 the arrows are exact inverses', () => {
    /**
     * The property the old rule could NOT have — its own tests pinned the
     * asymmetry as "documented, not accidental": `‹` from a Tuesday snapped back
     * to Monday and `›` then moved a full seven, a net +6 rather than a round
     * trip. greg reported the arrows as unintuitive; this is the property that
     * makes them intuitive, so it is asserted at every anchor alignment.
     */
    it.each([
      ['today', TODAY],
      ['an aligned Monday', '2026-09-07'],
      ['an arbitrary Thursday (after a day tap)', '2026-09-10'],
      ['a month end', '2026-09-30'],
      ['a year end', '2026-12-31'],
    ])('back-then-forward returns to %s', (_label, from) => {
      for (const columns of [3, 4, 5, 6, 7]) {
        const back = nextAnchorYmd(from, columns, -1);
        expect(nextAnchorYmd(back, columns, 1)).toBe(from);
        const forward = nextAnchorYmd(from, columns, 1);
        expect(nextAnchorYmd(forward, columns, -1)).toBe(from);
      }
    });
  });

  describe('no longer consults the week-start setting', () => {
    it('🔴 gives the same answer whichever day the family starts their week on', () => {
      // It used to differ: Monday-start sent this press to 2026-09-07 and
      // Sunday-start to 2026-09-13. Paging by what is on screen has nothing to
      // do with where a calendar week begins, and a family who changed that
      // setting would have found their arrows silently moved differently.
      expect(nextAnchorYmd(TODAY, 7, 1)).toBe('2026-09-13');
      expect(nextAnchorYmd('2026-09-10', 7, 1)).toBe('2026-09-17');
      expect(nextAnchorYmd('2026-09-10', 7, -1)).toBe('2026-09-03');
    });
  });

  describe('daylight saving', () => {
    // Northern-hemisphere DST ends 2026-10-25 in most of Europe and 2026-11-01
    // in the US. Stepping across either must still be whole days — a naive
    // +n*86400000 lands an hour out and can round to the wrong date.
    it.each([
      ['a spring transition', '2026-03-29'],
      ['an autumn transition', '2026-10-25'],
      ['the US autumn transition', '2026-11-01'],
    ])('steps whole days across %s', (_label, ymd) => {
      for (const columns of [1, 3, 7]) {
        const forward = nextAnchorYmd(ymd, columns, 1);
        expect(nextAnchorYmd(forward, columns, -1)).toBe(ymd);
        expect(anchorOffsetDays(forward, ymd)).toBe(columns);
      }
    });
  });

  describe('totality', () => {
    it('a broken column count still moves the wall rather than freezing it', () => {
      expect(nextAnchorYmd(TODAY, 0, 1)).toBe('2026-09-07');
      expect(nextAnchorYmd(TODAY, NaN, 1)).toBe('2026-09-07');
      expect(nextAnchorYmd(TODAY, -4, 1)).toBe('2026-09-07');
    });
  });
});

describe('anchorWeekDays', () => {
  it('returns seven consecutive days starting at the anchor', () => {
    expect(anchorWeekDays(TODAY)).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
  });

  it('preserves the wall default: anchored on today means today + 6', () => {
    const days = anchorWeekDays(TODAY);
    expect(days[0]).toBe(TODAY);
    expect(days).toHaveLength(7);
    expect(anchorOffsetDays(days[6]!, TODAY)).toBe(6);
  });

  it('crosses a month boundary', () => {
    expect(anchorWeekDays('2026-09-28')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });
});
