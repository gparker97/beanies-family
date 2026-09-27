/**
 * The one definition of WHEN a timed activity is on, in minutes of its day, and
 * the one overlap sweep over those spans.
 *
 * Shared by the planner (`useCalendarNavigation.ts`: the week grid, the desktop
 * bean lanes and the mobile `DayTimeline`) and by the beanie wall
 * (`wallActivities.ts` / `wallTimeGrid.ts`). Before this module each surface
 * parsed `HH:mm` on its own and they disagreed: the planner had no overnight rule
 * and an unvalidated parser, and the wall read `end == start` as a 24-hour event.
 *
 * What stays per surface, on purpose:
 *  - the ASSUMED duration of an activity with no end (planner 60, wall 90);
 *  - what to do with an overnight span (the planner's axis ends at midnight, so it
 *    clamps; the wall carries the span past 1440 and grows its axis);
 *  - how to resolve a collision the minimum card height causes (the planner
 *    splits it, the wall nudges the later block down; see RULE 3 in
 *    `wallTimeGrid.ts`).
 */
import { minutesOfDay } from '@/utils/date';

/** So an activity running past midnight is a real span, not a negative one. */
export const MINUTES_PER_DAY = 1440;

export interface TimedSpan {
  start: number;
  end: number;
  /**
   * Informational: the end was before the start, so the span runs past midnight
   * and `end` is > 1440. The caller decides whether to clamp or carry it.
   */
  overnight: boolean;
  /**
   * Informational: an `endTime` was present but unreadable, so `end` is the
   * assumed duration. The caller decides whether to count it; it must never be a
   * silent fallback.
   */
  endUnreadable: boolean;
}

/**
 * The TRUE minute span of a timed activity. `null` when the start cannot be read;
 * the caller must still show the activity (neither surface ever drops one).
 *
 * The overnight rule is STRICT `end < start`, matching `resolveActivityDays`
 * (`activityDays.ts`), which the clash detector and the Google export use. Equal
 * times are a zero-length event on the same day, not a 24-hour one.
 */
export function timedSpanMinutes(
  startTime: string | undefined,
  endTime: string | undefined,
  assumedDurationMin: number
): TimedSpan | null {
  const start = minutesOfDay(startTime);
  if (start === null) return null;
  const rawEnd = minutesOfDay(endTime);
  if (rawEnd === null) {
    return {
      start,
      end: start + assumedDurationMin,
      overnight: false,
      endUnreadable: !!endTime,
    };
  }
  const overnight = rawEnd < start;
  return {
    start,
    end: overnight ? rawEnd + MINUTES_PER_DAY : rawEnd,
    overnight,
    endUnreadable: false,
  };
}

/**
 * Group items into clusters of mutually-overlapping ranges, on ALREADY PARSED
 * minute offsets. Pure, total, generic: no time-string parsing and no
 * assumed-duration or minimum-height policy, which are the caller's business.
 *
 * Within a cluster, items are ordered by start, then LONGEST first.
 */
export function clusterOverlapping<T extends { start: number; end: number }>(
  items: readonly T[]
): T[][] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const clusters: T[][] = [];
  let current: T[] = [];
  let reach = -Infinity;
  for (const item of sorted) {
    // `>=` not `>`: an event ending exactly as the next begins is sequential,
    // not simultaneous. Treating a touching pair as a collision would split the
    // column for the school run and the drop-off five minutes later.
    if (current.length && item.start >= reach) {
      clusters.push(current);
      current = [];
      reach = -Infinity;
    }
    current.push(item);
    reach = Math.max(reach, item.end);
  }
  if (current.length) clusters.push(current);
  return clusters;
}
