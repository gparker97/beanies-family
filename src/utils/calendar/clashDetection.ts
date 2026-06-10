// Pure clash-detection (#34) — no I/O, exhaustively unit-tested.
//
// Decides which beanies activity occurrences overlap a busy block on a connected
// calendar, using ONLY free/busy intervals (never event details). All comparison
// is in absolute ms: Google busy times are offset-bearing RFC3339 instants, while
// activity times are local wall-time — converting both via `Date.getTime()` keeps
// the overlap timezone-correct regardless of the busy block's source zone.

import type { FamilyActivity } from '@/types/models';
import { parseLocalDate, addDaysYmd } from '@/utils/date';
import type { BusyInterval } from '@/services/calendar/CalendarClient';
import { resolveActivityDays } from './activityDays';

/** A single activity↔calendar clash. Names the connected calendar, never the
 *  other event's details. */
export interface ClashInfo {
  connectionId: string;
  /** Human label of the connected calendar (e.g. the account email / calendar name). */
  calendarLabel: string;
}

/** One occurrence of an activity on a concrete date (as expanded for the view). */
export interface ActivityOccurrence {
  activity: FamilyActivity;
  /** `YYYY-MM-DD` of this occurrence. */
  date: string;
}

/** Busy intervals + the display label, per connected calendar. */
export interface ConnectionBusy {
  connectionId: string;
  calendarLabel: string;
  intervals: BusyInterval[];
}

/** Stable map key for a (activity, occurrence-date) pair. The ONLY place this
 *  format is defined — used on both the write (computeClashes) and read (store)
 *  sides so the two never drift. */
export function clashKey(activityId: string, occurrenceDate: string): string {
  return `${activityId}:${occurrenceDate}`;
}

/** Local wall-time `YYYY-MM-DD` + `HH:MM` → absolute ms. */
function localDateTimeMs(ymd: string, hhmm: string): number {
  const base = parseLocalDate(ymd);
  const [h, m] = hhmm.split(':').map(Number);
  base.setHours(h ?? 0, m ?? 0, 0, 0);
  return base.getTime();
}

/**
 * Absolute [startMs, endMs) for a TIMED occurrence, or null for an all-day
 * activity (v1 skips all-day — free/busy all-day semantics are noisy). The
 * day-roll (overnight → +1 day) is anchored to the OCCURRENCE date, not
 * `activity.date`, so a recurring overnight instance rolls correctly.
 */
export function activityTimeRange(
  activity: FamilyActivity,
  occurrenceDate: string
): { startMs: number; endMs: number } | null {
  const days = resolveActivityDays(activity);
  if (days.allDay || !days.startTime || !days.endTime) return null;
  const startMs = localDateTimeMs(occurrenceDate, days.startTime);
  const endMs = localDateTimeMs(addDaysYmd(occurrenceDate, days.endDayOffset), days.endTime);
  return { startMs, endMs };
}

/** Half-open `[start, end)` intersection on absolute ms. */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * For each timed occurrence, find the FIRST connected calendar whose busy
 * intervals overlap it. Pure. Returns a map keyed by `clashKey`. All-day
 * occurrences and connections with no busy data simply produce no entry.
 */
export function computeClashes(
  occurrences: ActivityOccurrence[],
  busyByConnection: ConnectionBusy[]
): Map<string, ClashInfo> {
  const clashes = new Map<string, ClashInfo>();
  // Pre-parse busy intervals to ms once.
  const parsed = busyByConnection.map((c) => ({
    connectionId: c.connectionId,
    calendarLabel: c.calendarLabel,
    intervals: c.intervals.map((iv) => ({
      startMs: new Date(iv.start).getTime(),
      endMs: new Date(iv.end).getTime(),
    })),
  }));

  for (const occ of occurrences) {
    const range = activityTimeRange(occ.activity, occ.date);
    if (!range) continue;
    for (const conn of parsed) {
      const hit = conn.intervals.some(
        (iv) =>
          Number.isFinite(iv.startMs) &&
          Number.isFinite(iv.endMs) &&
          intervalsOverlap(range.startMs, range.endMs, iv.startMs, iv.endMs)
      );
      if (hit) {
        clashes.set(clashKey(occ.activity.id, occ.date), {
          connectionId: conn.connectionId,
          calendarLabel: conn.calendarLabel,
        });
        break; // first overlapping calendar wins
      }
    }
  }
  return clashes;
}
