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
import { addDaysYmd, parseLocalDate } from '@/utils/date';

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
