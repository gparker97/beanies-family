import type { Cadence } from '@/types/recurrence';
import { extractDatePart, parseLocalDate } from '@/utils/date';

/**
 * The anchor-relative parts of a rule: the ones that describe WHERE in the week or month
 * the series lands, and so must follow the series' start date when it moves. Everything
 * else (unit, interval, end) is the series' shape and stays put.
 */
type AnchorParts = Pick<Cadence, 'weekdays' | 'monthlyAnchor' | 'monthlyDay'>;

/**
 * Re-derive a rule's anchor-relative parts after its series anchor moves from
 * `oldAnchorYmd` to `newAnchorYmd`. Pure: returns a new object, never mutates.
 *
 * - **Weekdays** follow the anchor only while UNTOUCHED, i.e. a single weekday that is
 *   exactly the old anchor's weekday. A chosen set (Mon + Wed) is never rewritten; the
 *   scoped save refuses a series-scope date move on one instead. Without this a series
 *   moved from a Wednesday to a Thursday keeps repeating on Wednesdays.
 * - **`monthlyDay`** follows the anchor's day of the month whenever the month lands by
 *   date (`monthlyAnchor !== 'weekday'`) and a day is carried. A `'last'` day becomes the
 *   new anchor's day, as the form does when its start date changes.
 * - **`monthlyAnchor: 'weekday'`** ("the 2nd Tuesday") stores no ordinal: the engine derives
 *   it from the anchor at expansion time, so it already follows and is left alone.
 *
 * Generic over the anchor parts so `RecurrencePicker` can run its editable state (which
 * carries weekdays and a monthly day whatever unit is active, so a start-date change made
 * on Weekly still moves the monthly anchor) through the same rule the drag path uses on a
 * stored `RecurrenceRule`. The one definition of "the anchor moved, re-anchor the rule".
 */
export function retargetRuleForAnchor<R extends AnchorParts>(
  rule: R,
  oldAnchorYmd: string,
  newAnchorYmd: string
): R {
  const oldYmd = extractDatePart(oldAnchorYmd);
  const newYmd = extractDatePart(newAnchorYmd);
  if (!oldYmd || !newYmd || oldYmd === newYmd) return rule;
  const oldDate = parseLocalDate(oldYmd);
  const newDate = parseLocalDate(newYmd);
  if (Number.isNaN(oldDate.getTime()) || Number.isNaN(newDate.getTime())) return rule;

  const next: R = { ...rule };
  if (rule.monthlyAnchor !== 'weekday' && rule.monthlyDay !== undefined) {
    next.monthlyDay = newDate.getDate();
  }
  if (rule.weekdays?.length === 1 && rule.weekdays[0] === oldDate.getDay()) {
    next.weekdays = [newDate.getDay()];
  }
  return next;
}
