/**
 * The one shape of an activity occurrence: an activity on a calendar date.
 *
 * A multi-day all-day activity (a one-off trip, or a repeating Fri-Sun weekend)
 * expands into one occurrence per covered day. `repeatStart` then names the day
 * that repeat (or the one-off) STARTS on, so a consumer can tell the first day
 * from a continuation day: spans group by it, edits open the repeat it belongs
 * to, and reminders and hints fire once per event instead of once per day.
 *
 * A view-only field: never persisted. Absent on single-day occurrences, where
 * the start is the date itself ({@link occurrenceStart}).
 */
import type { FamilyActivity } from '@/types/models';

export interface ActivityOccurrence {
  activity: FamilyActivity;
  /** The calendar day this occurrence is drawn on (`YYYY-MM-DD`). */
  date: string;
  /** The day the multi-day event this day belongs to starts on. */
  repeatStart?: string;
}

/** The day the event this occurrence belongs to starts on. */
export function occurrenceStart(occ: Pick<ActivityOccurrence, 'date' | 'repeatStart'>): string {
  return occ.repeatStart ?? occ.date;
}

/** A second-or-later day of a multi-day event (not the day it starts). */
export function isContinuationDay(occ: Pick<ActivityOccurrence, 'date' | 'repeatStart'>): boolean {
  return occurrenceStart(occ) !== occ.date;
}
