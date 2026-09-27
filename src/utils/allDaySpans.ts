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
import { isRepeatingActivity, spanOffsetDays } from '@/utils/calendar/activityDays';
import { occurrenceStart, type ActivityOccurrence } from '@/utils/calendar/occurrence';
import { logEvent } from '@/services/telemetry/logEvent';

/** Shape returned by `activityStore.monthActivities()` and `weekActivities`. */
export type { ActivityOccurrence };

export interface AllDaySpan {
  activity: FamilyActivity;
  /**
   * The day this event starts: the one-off's `date`, or the START of this repeat
   * of a multi-day repeating activity. Keys the span (two repeats can share a
   * row) and is the date a click opens.
   */
  startYmd: string;
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
 * Edge cases — never silent. Odd records are reported once per activity per
 * session (`reportOddRecord`, surface `all-day-spans`):
 *
 *   - `endDate < startDate` → reported, drawn as a single day (as the store
 *     expands it) rather than vanishing.
 *   - Timed activity with `endDate` set (schema drift) → reported, skipped.
 *   - `endDate` outside the visible day range → clamp.
 *   - A one-off multi-day activity arrives as one occurrence per day; it is
 *     deduped by `activity.id` into ONE span.
 *   - A multi-day REPEAT arrives the same way per repeat; it is grouped by
 *     `id + repeatStart` into one span per repeat.
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

  // A one-off contributes ONE span per row (its occurrences all share its id);
  // a multi-day REPEAT contributes one per repeat, so it is grouped by
  // `id + repeat start` and drawn over the days actually emitted for that repeat
  // in this row (which already respects month look-back, clamping and the
  // store's overlap dedupe).
  const seenSpanIds = new Set<string>();
  const repeatGroups = new Map<
    string,
    { activity: FamilyActivity; start: string; dates: string[] }
  >();

  const pushSingle = (a: FamilyActivity, date: string) => {
    const list = singleByDate.get(date) ?? [];
    // Dedupe within the same date — guard against the (unusual) case of
    // a single-day activity expanded into multiple occurrences for one date.
    if (!list.some((x) => x.id === a.id)) {
      list.push(a);
      singleByDate.set(date, list);
    }
  };

  for (const occ of occurrences) {
    const a = occ.activity;

    // Skip timed activities entirely — they go in the dot row, not the
    // all-day lane.
    // (A timed record CAN carry `endDate`: calendar sync writes a next-day one on
    // every overnight import. It is not drift, and the time grids draw it.)
    if (!a.isAllDay) continue;

    // An end BEFORE the start: the store draws it as a single day (an older
    // client moved it without its span), so it is bucketed as one here too
    // rather than vanishing from the row.
    if (a.endDate && a.endDate < a.date) {
      reportOddRecord(a, 'end_before_start');
      pushSingle(a, occ.date);
      continue;
    }

    if (spanOffsetDays(a) === 0) {
      pushSingle(a, occ.date);
      continue;
    }

    if (isRepeatingActivity(a)) {
      const start = occurrenceStart(occ);
      const key = `${a.id}:${start}`;
      const group = repeatGroups.get(key) ?? { activity: a, start, dates: [] };
      group.dates.push(occ.date);
      repeatGroups.set(key, group);
      continue;
    }

    if (seenSpanIds.has(a.id)) continue;
    seenSpanIds.add(a.id);
    // Find the first visible day at or after the activity's start, and the
    // last visible day at or before the activity's end. Clamp to the row.
    const startCol = days.findIndex((d) => d.dateStr >= a.date);
    let endCol = -1;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i]!.dateStr <= a.endDate!) {
        endCol = i;
        break;
      }
    }
    // If the activity falls entirely outside the row, there is nothing to render.
    if (startCol < 0 || endCol < 0 || endCol < startCol) continue;
    spans.push({ activity: a, startYmd: a.date, startCol, span: endCol - startCol + 1 });
    spanningIds.add(a.id);
  }

  for (const group of repeatGroups.values()) {
    const cols = group.dates
      .map((date) => days.findIndex((d) => d.dateStr === date))
      .filter((c) => c >= 0);
    if (!cols.length) continue;
    const startCol = Math.min(...cols);
    spans.push({
      activity: group.activity,
      startYmd: group.start,
      startCol,
      span: Math.max(...cols) - startCol + 1,
    });
    spanningIds.add(group.activity.id);
  }

  return { spans, singleByDate, spanningIds };
}

/**
 * Odd all-day records, reported once per activity per session: this runs on
 * every render of every all-day row, so an unconditional log would flood. A
 * fixed message with a structured code and the record's `activity_id`.
 */
const reportedOddRecords = new Set<string>();
function reportOddRecord(a: FamilyActivity, code: string): void {
  const key = `${code}:${a.id}`;
  if (reportedOddRecords.has(key)) return;
  reportedOddRecords.add(key);
  logEvent({
    level: 'warn',
    surface: 'all-day-spans',
    message: 'all_day_odd_record',
    context: { action: 'layout', error_code: code, activity_id: a.id },
  });
}
