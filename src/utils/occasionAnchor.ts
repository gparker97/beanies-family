/**
 * Occasions (#137): where a yearly occasion series is anchored when the person picks a date in
 * a past year. Kept apart from `occasions.ts` because it needs the recurrence engine, which
 * logs through telemetry; `occasions.ts` must stay a leaf (see its header).
 *
 * Pure. No stores, no `Date.now()`: the caller passes today.
 */
import { cadenceToRule } from '@/services/recurrence/cadence';
import { firstDueOnOrAfter } from '@/services/recurrence/recurrenceEngine';
import { yearOf } from '@/utils/occasions';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const YEARLY = cadenceToRule({ unit: 'year', interval: 1 });

/**
 * Where a yearly occasion series should be anchored when the person picks a date in a past
 * year (7 Nov 1966): the picked year goes into the year field, and the series starts at the
 * next occurrence on or after today, so it never expands sixty years of past occurrences.
 *
 * 29 February anchors on the most recent leap-year 29 February on or before this year, so the
 * series keeps landing on the 29th in leap years (the engine clamps it to the 28th in the
 * others). Run again on that anchor it returns the same date, so a caller that re-enters on
 * its own write sees a no-op.
 *
 * Pure. `null` for a malformed date or when the engine finds no occurrence.
 */
export function nextOccasionAnchor(
  pickedYmd: string,
  todayYmd: string
): { anchor: string; year: number } | null {
  const year = yearOf(pickedYmd);
  const thisYear = yearOf(todayYmd);
  if (!Number.isInteger(year) || !Number.isInteger(thisYear)) return null;
  const monthDay = pickedYmd.slice(5, 10);

  if (monthDay === '02-29' && year <= thisYear) {
    let leap = thisYear;
    while (!isLeapYear(leap)) leap--;
    return { anchor: `${leap}-02-29`, year };
  }

  const anchor = firstDueOnOrAfter(YEARLY, pickedYmd.slice(0, 10), todayYmd.slice(0, 10));
  return anchor ? { anchor, year } : null;
}
