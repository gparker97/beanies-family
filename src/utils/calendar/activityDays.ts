// Shared activity day-math (#32 + #34) — leaf util, no I/O.
//
// The single source of truth for resolving a beanies activity's start/end DAYS
// (all-day vs timed, overnight roll, multi-day endDate). Consumed by:
//  - `activityToGoogleEvent.buildStartEnd` (sync — formats into Google date/dateTime)
//  - `clashDetection.activityTimeRange` (clash — builds absolute ms for overlap)
// Keeping this in its own leaf keeps the dependency direction one-way:
// `activityToGoogleEvent → activityDays ← clashDetection` (the shipped sync mapper
// never depends on clash code).

import type { FamilyActivity } from '@/types/models';
import { addDaysYmd, isRealYmd, isWallClockTime, parseLocalDate } from '@/utils/date';

export interface ActivityDays {
  /** No specific time → an all-day activity. */
  allDay: boolean;
  /** Inclusive start day (`YYYY-MM-DD`). */
  startYmd: string;
  /** Inclusive end day (`YYYY-MM-DD`). For all-day this is the last covered day
   *  (NOT Google's exclusive end). For timed it's the day the end time falls on. */
  endYmd: string;
  /** Whole-day offset from `startYmd` to `endYmd` (0 = same day, 1 = overnight).
   *  Lets a recurring occurrence re-anchor the end day to the occurrence date. */
  endDayOffset: number;
  /** `HH:MM` — present only for timed activities. */
  startTime?: string;
  endTime?: string;
}

/** True when the activity has no specific time → an all-day activity. */
export function isAllDayActivity(activity: FamilyActivity): boolean {
  return activity.isAllDay === true || !activity.startTime;
}

/** Why Google can never accept this activity's event body. */
export type PushBlockReason = 'bad_start_time' | 'bad_end_time' | 'bad_date';

/**
 * Why Google would deterministically reject this activity, or `null`.
 *
 * ## What this is for
 *
 * A 400 from Google is a rejection of the PAYLOAD: the identical body will be
 * refused identically, forever. One family sat in exactly that loop for days —
 * "Invalid start time" re-sent every five minutes from every device, re-paging
 * Slack once per app session, because nothing upstream ever asked whether the
 * body could possibly be valid. This is that question, asked locally and for free.
 *
 * ## Deliberately narrow
 *
 * ⚠️ This mirrors what `resolveActivityDays` actually SERIALIZES, not what the
 * activity happens to hold, and the difference is the whole design. A false
 * positive here is a SILENT REGRESSION — the event simply stops reaching Google
 * with no error anywhere — so every rule below is narrower than it first looks:
 *
 *  - Times are examined ONLY on the timed branch. An activity with
 *    `isAllDay: true` and a junk `startTime` is an all-day event today and syncs
 *    perfectly: the all-day branch below never reads `startTime`. Blocking it
 *    would break something that works.
 *  - An ABSENT `startTime` is not a fault — `isAllDayActivity` already routes it
 *    to an all-day event, which is the correct rendering.
 *  - `endTime` and `endDate` are examined only when present; both have defaults.
 *  - ymd fields are validated on `.slice(0, 10)`, because every consumer slices
 *    and a `date` carrying a time component is legal throughout the app.
 *  - `bad_date` applies to all-day and timed ALIKE: `dayOffset` runs on both
 *    branches, and its `NaN` reaches the wire through `addDaysYmd` either way.
 *
 * Pure and total — safe to call per render. It is NOT called by
 * `resolveActivityDays`, deliberately: that function sits on the planner's and the
 * wall's render path, and making it throw or grow a field would turn one bad
 * activity into a blank calendar.
 */
export function pushBlockReason(activity: FamilyActivity): PushBlockReason | null {
  if (!isRealYmd(activity.date.slice(0, 10))) return 'bad_date';
  if (activity.endDate && !isRealYmd(activity.endDate.slice(0, 10))) return 'bad_date';

  // Serialized into `UNTIL=` by `recurrenceRrule.untilClause` behind only a
  // `.trim()` guard, so a malformed value is just as certainly a 400 — it simply
  // arrives with a different message, about the RRULE rather than the start time.
  // Serialized by `overrideOccurrenceYmd` into the `listInstances` window bounds
  // (`${addDaysYmd(ymd, -1)}T00:00:00Z`), so a malformed value is another certain
  // 400 — one the device-local memo would otherwise have to learn the hard way,
  // once per device per session, forever.
  if (activity.originalOccurrenceDate && !isRealYmd(activity.originalOccurrenceDate.slice(0, 10))) {
    return 'bad_date';
  }

  const repeats = (activity.recurrence && activity.recurrence !== 'none') || !!activity.rule;
  if (
    repeats &&
    activity.recurrenceEndDate &&
    !isRealYmd(activity.recurrenceEndDate.slice(0, 10))
  ) {
    return 'bad_date';
  }

  // Below here the activity is TIMED, so and only so do the clock fields ship.
  if (isAllDayActivity(activity)) return null;
  if (!isWallClockTime(activity.startTime as string)) return 'bad_start_time';
  if (activity.endTime && !isWallClockTime(activity.endTime)) return 'bad_end_time';
  return null;
}

function dayOffset(startYmd: string, endYmd: string): number {
  const ms = parseLocalDate(endYmd).getTime() - parseLocalDate(startYmd).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Resolve an activity's start/end days and times. The rules (preserved verbatim
 * from the original `buildStartEnd`):
 *  - all-day: end is the inclusive last day (`endDate ?? date`).
 *  - timed: `endTime` defaults to `startTime`; a multi-day `endDate` sets the end
 *    day; an overnight activity (no `endDate`, `endTime < startTime`) rolls the
 *    end to the next day so end > start.
 */
export function resolveActivityDays(activity: FamilyActivity): ActivityDays {
  const startYmd = activity.date.slice(0, 10);

  if (isAllDayActivity(activity)) {
    const endYmd = (activity.endDate ?? activity.date).slice(0, 10);
    return { allDay: true, startYmd, endYmd, endDayOffset: dayOffset(startYmd, endYmd) };
  }

  const startTime = activity.startTime as string; // guaranteed by isAllDayActivity check
  const endTime = activity.endTime ?? startTime;
  let endYmd = activity.endDate?.slice(0, 10) ?? startYmd;
  if (!activity.endDate && endTime < startTime) endYmd = addDaysYmd(startYmd, 1);
  return {
    allDay: false,
    startYmd,
    endYmd,
    endDayOffset: dayOffset(startYmd, endYmd),
    startTime,
    endTime,
  };
}
