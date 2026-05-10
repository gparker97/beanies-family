/**
 * All-day activity span computation — pure logic shared by the weekly and
 * monthly calendar views. Both views need to: (a) recognize multi-day
 * all-day activities and compute their column-span within a 7-day row, and
 * (b) bucket single-day all-day activities by their date so they can be
 * rendered as chips. This used to live inline inside `WeeklyCalendarView.vue`;
 * it's been lifted here so the monthly view (`CalendarGrid.vue`) can reuse
 * it without copy-pasting the logic.
 *
 * The function is pure — no Vue reactivity, no DOM access. Call it inside
 * a `computed` if you need reactivity. The absence of a `use` prefix is
 * deliberate: this is a plain utility, not a Vue composable.
 */

import type { FamilyActivity } from '@/types/models';

/** Shape returned by `activityStore.monthActivities()` and `weekActivities`. */
export interface ActivityOccurrence {
  activity: FamilyActivity;
  date: string; // YYYY-MM-DD
}

export interface AllDaySpan {
  activity: FamilyActivity;
  /** 0-indexed column within the days[] array passed in. */
  startCol: number;
  /** Number of cells covered, clamped to the visible day range. */
  span: number;
}

export interface AllDaySpansResult {
  /**
   * Multi-day all-day activities, deduped by `activity.id`, with column
   * range clamped to the visible days. An activity with `span === 1`
   * (e.g. a 3-day event whose first two days are off-row, leaving only
   * day 3 visible) is treated as multi-day, not single-day, because the
   * intent is multi-day even when only a tail is visible.
   */
  spans: AllDaySpan[];
  /**
   * Single-day all-day activities keyed by their date string. A "single-day
   * all-day" is `isAllDay === true` AND (`endDate` unset OR `endDate === date`).
   */
  singleByDate: Map<string, FamilyActivity[]>;
  /** ids of activities in `spans` — for excluding them from per-day iteration. */
  spanningIds: Set<string>;
}

/**
 * Compute span info for a list of activity occurrences and an ordered list
 * of days. Pass exactly the days you want to render — typically 7 (one
 * week-row).
 *
 * Edge cases — never silent. Every odd-shaped record logs `console.warn`
 * with the activity id + offending field so a real data corruption is
 * diagnosable in production telemetry:
 *
 *   - `endDate < startDate` → log + skip the activity entirely.
 *   - Timed activity with `endDate` set (not currently possible per the
 *     schema, but a defensive guard for future drift) → log + skip.
 *   - `endDate` outside the visible day range → clamp; chip's `isStart` /
 *     `isEnd` flags get suppressed accordingly by the caller (the caller
 *     compares each cell's date against `activity.date` / `activity.endDate`
 *     to decide which corners to round).
 *   - `monthActivities()` produces one occurrence per day for multi-day
 *     activities. Dedupe by `activity.id` so a 3-day activity becomes ONE
 *     `AllDaySpan` entry, not three.
 */
export function computeAllDaySpans(
  occurrences: ActivityOccurrence[],
  days: { dateStr: string }[]
): AllDaySpansResult {
  const spans: AllDaySpan[] = [];
  const singleByDate = new Map<string, FamilyActivity[]>();
  const spanningIds = new Set<string>();

  if (days.length === 0) {
    return { spans, singleByDate, spanningIds };
  }

  // Track which activities we've already processed (in either bucket) so a
  // multi-day activity expanded into N occurrences only contributes one
  // span entry, and a single-day activity that somehow appears twice only
  // contributes once per date.
  const seenSpanIds = new Set<string>();

  for (const occ of occurrences) {
    const a = occ.activity;

    // Skip timed activities entirely — they go in the dot row, not the
    // all-day lane.
    if (!a.isAllDay) {
      // Defensive: a timed activity with endDate set is a schema-drift
      // signal, not a normal record. Surface it loudly.
      if (a.endDate) {
        console.warn(
          `[allDaySpans] Activity ${a.id} has endDate=${a.endDate} but isAllDay is not true. ` +
            `Schema drift — skipping from spans.`
        );
      }
      continue;
    }

    // Multi-day = endDate is set AND strictly after start. If endDate equals
    // the start, treat as single-day (no real span).
    const hasMultiDay = !!a.endDate && a.endDate > a.date;

    // Catch invalid records: endDate before startDate. Skip the activity
    // so it doesn't pollute either bucket; the rest of the row still renders.
    if (a.endDate && a.endDate < a.date) {
      console.warn(
        `[allDaySpans] Activity ${a.id} has endDate=${a.endDate} before date=${a.date}. ` +
          `Invalid record — skipping.`
      );
      continue;
    }

    if (hasMultiDay) {
      if (seenSpanIds.has(a.id)) continue;
      seenSpanIds.add(a.id);

      // Find the first visible day at or after the activity's start, and the
      // last visible day at or before the activity's end. Clamp to the row.
      const startCol = days.findIndex((d) => d.dateStr >= a.date);
      // findLastIndex is broadly available in modern runtimes; use a
      // reverse-iter fallback for safety with older targets.
      let endCol = -1;
      for (let i = days.length - 1; i >= 0; i--) {
        if (days[i]!.dateStr <= a.endDate!) {
          endCol = i;
          break;
        }
      }

      // If the activity falls entirely outside the row, both indices are -1
      // (or startCol < 0). Skip — there's nothing to render in this row.
      if (startCol < 0 || endCol < 0 || endCol < startCol) continue;

      spans.push({
        activity: a,
        startCol,
        span: endCol - startCol + 1,
      });
      spanningIds.add(a.id);
    } else {
      // Single-day all-day. Bucket by occurrence date.
      const list = singleByDate.get(occ.date) ?? [];
      // Dedupe within the same date — guard against the (unusual) case of
      // a single-day activity expanded into multiple occurrences for one date.
      if (!list.some((x) => x.id === a.id)) {
        list.push(a);
        singleByDate.set(occ.date, list);
      }
    }
  }

  return { spans, singleByDate, spanningIds };
}
