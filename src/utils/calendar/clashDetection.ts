// Pure clash-detection (#34) — no I/O, exhaustively unit-tested.
//
// Decides which beanies activity occurrences overlap a busy block on a connected
// calendar, using ONLY event TIMES (never event content). All comparison is in
// absolute ms: external event times arrive already converted to ms (timed from an
// offset-bearing instant, all-day from a local-midnight span), while activity times
// are local wall-time via `Date.getTime()` — so overlap stays timezone-correct.

import type { FamilyActivity } from '@/types/models';
import { parseLocalDate, addDaysYmd } from '@/utils/date';
import type { EventTime } from '@/services/calendar/CalendarClient';
import { resolveActivityDays } from './activityDays';

/** An absolute-ms busy block — what computeClashes compares activity ranges against. */
export interface BusyMs {
  startMs: number;
  endMs: number;
}

/** A single activity↔calendar clash. Names the connected calendar, never the
 *  other event's details. Carries `activityId`/`occurrenceDate`/`fingerprint` so
 *  the `useClash` seam can self-containedly join it to the acknowledge memory (#34)
 *  without threading the lookup keys in separately. */
export interface ClashInfo {
  connectionId: string;
  /** Human label of the connected calendar (e.g. the account email / calendar name). */
  calendarLabel: string;
  /** The clashing activity. */
  activityId: string;
  /** `YYYY-MM-DD` of the clashing occurrence. */
  occurrenceDate: string;
  /** Activity occurrence time window, `${startMs}-${endMs}` — the acknowledge
   *  fingerprint: when it changes (the activity is rescheduled) a quieted overlap
   *  re-raises. */
  fingerprint: string;
}

/** One occurrence of an activity on a concrete date (as expanded for the view). */
export interface ActivityOccurrence {
  activity: FamilyActivity;
  /** `YYYY-MM-DD` of this occurrence. */
  date: string;
}

/** Busy intervals (absolute ms) + the display label, per connected calendar. */
export interface ConnectionBusy {
  connectionId: string;
  calendarLabel: string;
  intervals: BusyMs[];
}

/**
 * From a connection's raw event times, keep only the OTHER, busy commitments:
 * drop transparent (owner-marked "free") and beanies-OWNED events (whose `id` or
 * `recurringEventId` is in the supplied set — the self-clash fix). Returns
 * absolute-ms intervals ready for `computeClashes`. Pure. (#34)
 */
export function externalBusyIntervals(
  events: EventTime[],
  beanieEventIds: ReadonlySet<string>
): BusyMs[] {
  return events
    .filter((e) => !e.transparent)
    .filter(
      (e) =>
        !beanieEventIds.has(e.id) &&
        !(e.recurringEventId !== undefined && beanieEventIds.has(e.recurringEventId))
    )
    .map((e) => ({ startMs: e.startMs, endMs: e.endMs }));
}

/** Stable map key for a (activity, occurrence-date) pair. The ONLY place this
 *  format is defined — used on both the write (computeClashes) and read (store)
 *  sides so the two never drift. */
export function clashKey(activityId: string, occurrenceDate: string): string {
  return `${activityId}:${occurrenceDate}`;
}

/** Stable map key for an acknowledged overlap (#34): one entry per
 *  (activity, occurrence-date, connection). The ONLY place this format is defined
 *  — used on both the write (overlapAckStore) and read (isAcknowledged) sides so
 *  the two never drift. Positional + same `:`-join style as `clashKey`. */
export function overlapAckKey(
  activityId: string,
  occurrenceDate: string,
  connectionId: string
): string {
  return `${activityId}:${occurrenceDate}:${connectionId}`;
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
  // Intervals arrive already in absolute ms (the events.list path converts once) —
  // no pre-parse needed here.
  for (const occ of occurrences) {
    const range = activityTimeRange(occ.activity, occ.date);
    if (!range) continue;
    for (const conn of busyByConnection) {
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
          activityId: occ.activity.id,
          occurrenceDate: occ.date,
          fingerprint: `${range.startMs}-${range.endMs}`,
        });
        break; // first overlapping calendar wins
      }
    }
  }
  return clashes;
}
