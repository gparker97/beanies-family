/**
 * The one shape of an activity occurrence: an activity on a calendar date.
 *
 * An event drawn across several days expands into one occurrence per day it
 * covers: a multi-day all-day activity (a one-off trip, a repeating Fri-Sun
 * weekend) on every covered day, and an overnight TIMED activity (22:00-01:00)
 * on its start day plus a continuation the next morning. `repeatStart` names the
 * day the event (this repeat of it) STARTS on, so a consumer can tell the first
 * day from a continuation day: spans group by it, edits open the event it
 * belongs to, and reminders, hints, clashes and duty prompts fire once per event.
 *
 * A view-only field: never persisted. Absent on single-day occurrences, where the
 * start is the date itself ({@link occurrenceStart}).
 */
import type { FamilyActivity } from '@/types/models';
import { isAllDayActivity } from '@/utils/calendar/activityDays';

export interface ActivityOccurrence {
  activity: FamilyActivity;
  /** The calendar day this occurrence is drawn on (`YYYY-MM-DD`). */
  date: string;
  /** The day the multi-day event this day belongs to starts on. */
  repeatStart?: string;
}

type OccurrenceDates = Pick<ActivityOccurrence, 'date' | 'repeatStart'>;

/** The day the event this occurrence belongs to starts on. */
export function occurrenceStart(occ: OccurrenceDates): string {
  return occ.repeatStart ?? occ.date;
}

/** A second-or-later day of a multi-day event (not the day it starts). */
export function isContinuationDay(occ: OccurrenceDates): boolean {
  return occurrenceStart(occ) !== occ.date;
}

/**
 * The next-morning tail of an overnight TIMED event. Not an event of its own: it
 * is drawn on the time grids, but clashes, duty prompts, reminders and the wall
 * (which already draws the event past midnight) count the event once, on its
 * start day. An all-day trip's later days are different: each is a real day.
 */
export function isTimedContinuation(occ: ActivityOccurrence): boolean {
  return isContinuationDay(occ) && !isAllDayActivity(occ.activity);
}

/**
 * The date that IDENTIFIES this occurrence's event: for a timed continuation, the
 * start day (clicks, edits, duty ticks and the clash lookup all belong there; a
 * daily overnight series has both yesterday's tail and tonight's start on one day,
 * so the drawn date alone cannot tell them apart). Otherwise the drawn date.
 */
export function eventDateOf(occ: ActivityOccurrence): string {
  return isTimedContinuation(occ) ? occurrenceStart(occ) : occ.date;
}

/** What the time grids draw: a timed continuation runs from midnight to its end. */
export function occurrenceWindow(occ: ActivityOccurrence): {
  startTime?: string;
  endTime?: string;
} {
  return isTimedContinuation(occ)
    ? { startTime: '00:00', endTime: occ.activity.endTime }
    : { startTime: occ.activity.startTime, endTime: occ.activity.endTime };
}

/** A key unique per drawn occurrence, even when one activity appears twice on a date. */
export function occurrenceKey(occ: ActivityOccurrence): string {
  return `${occ.activity.id}:${occ.date}:${occurrenceStart(occ)}`;
}
