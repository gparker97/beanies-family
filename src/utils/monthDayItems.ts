// What one month day holds, in what order, how much of it, and the stream's caps
// (#141). Pure: no stores, no Vue, no I/O.
//
// This is the ONLY source of a day's order, count and emptiness. The grid's lane
// and stack (`monthGridLayout.ts`), every day list (the stream card, the desktop
// popover, the phone day row), every "is this day empty" check and every "N
// things on" label read it, so no two surfaces can order, cap, count or call a day
// empty differently.
//
// Birthdays and holidays (`cell.extras`) are deliberately NOT `DayItem`s. They
// stay a separate list so the day contents render `BirthdayChip` / `HolidayChip`
// inline, where `allDaySurfaces.test.ts` scans for them.

import type {
  CellAllDayItem,
  CellTimedOccurrence,
  CellVacation,
  MonthDayCellData,
} from '@/utils/monthCells';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import type { DayExtra } from '@/utils/calendarDay';
import type { DayCaps } from '@/constants/calendarCaps';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatTodayCaption } from '@/utils/date';

/** One renderable thing on a day, other than a birthday or holiday. */
export type DayItem =
  | { kind: 'trip'; vacation: CellVacation }
  | { kind: 'allday'; item: CellAllDayItem; date: string }
  | { kind: 'timed'; occurrence: CellTimedOccurrence }
  | { kind: 'segment'; segment: TravelSegmentOccurrence };

/** The spanning kinds: what `allDayItems` returns and what can win a grid lane. */
export type SpanningDayItem = Extract<DayItem, { kind: 'trip' | 'allday' }>;

type Translate = (key: UIStringKey) => string;

/** The one `v-for` key rule for a day's items; unique within a day. */
export function dayItemKey(item: DayItem): string {
  switch (item.kind) {
    case 'trip':
      return `trip:${item.vacation.id}`;
    case 'allday':
      return `allday:${item.item.spanKey}`;
    case 'timed':
      return `timed:${item.occurrence.activity.id}:${item.occurrence.date}`;
    case 'segment':
      return `segment:${item.segment.segmentId}-${item.segment.kind}`;
  }
}

/** A timeline item's start, or `null` when it has none (sorted last). */
function startOf(item: DayItem): string | null {
  if (item.kind === 'timed') return item.occurrence.activity.startTime || null;
  if (item.kind === 'segment') return item.segment.time || null;
  return null;
}

/**
 * Timed activities and travel segments merged into one timeline by start time.
 * Untimed items go last; ties keep their input order (timed before segments),
 * because `Array.prototype.sort` is stable.
 */
function mergeTimeline(
  timed: readonly CellTimedOccurrence[],
  segments: readonly TravelSegmentOccurrence[]
): DayItem[] {
  const items: DayItem[] = [
    ...timed.map((occurrence): DayItem => ({ kind: 'timed', occurrence })),
    ...segments.map((segment): DayItem => ({ kind: 'segment', segment })),
  ];
  return items.sort((a, b) => {
    const ta = startOf(a);
    const tb = startOf(b);
    if (ta === tb) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta.localeCompare(tb);
  });
}

/** The day's timed activities and travel segments, merged by start time. */
export function byStartTime(cell: MonthDayCellData): DayItem[] {
  return mergeTimeline(cell.timedOccurrences, cell.segments);
}

/** Trips, then the family's all-day activities. */
function buildAllDay(cell: MonthDayCellData, items: readonly CellAllDayItem[]): SpanningDayItem[] {
  return [
    ...cell.vacations.map((vacation): SpanningDayItem => ({ kind: 'trip', vacation })),
    ...items.map((item): SpanningDayItem => ({ kind: 'allday', item, date: cell.date })),
  ];
}

/** The day's spanning things: trips, then all-day activities. */
export function allDayItems(cell: MonthDayCellData): SpanningDayItem[] {
  return buildAllDay(cell, cell.allDayItems);
}

/** THE single day order: all-day things, then the timeline. */
export function dayItems(cell: MonthDayCellData): DayItem[] {
  return [...allDayItems(cell), ...byStartTime(cell)];
}

/** The one "how much is on this day" rule; `=== 0` is the one "is this day empty" rule. */
export function dayCount(cell: MonthDayCellData): number {
  return cell.extras.length + dayItems(cell).length;
}

/** "Nothing planned", "1 thing on" or "{count} things on". */
export function dayCountLabel(cell: MonthDayCellData, t: Translate): string {
  const count = dayCount(cell);
  if (count === 0) return t('planner.nothingPlanned');
  return fillTemplate(t(count === 1 ? 'planner.dayRow.count.one' : 'planner.dayRow.count.other'), {
    count,
  });
}

/**
 * The spoken name of a day whose root is the button and whose chips are therefore
 * `aria-hidden` (the phone grid cell, the stream card): "Thu, 5 November · Deepavali ·
 * 3 things on". The holiday name rides along because neither surface speaks its chips.
 */
export function dayButtonLabel(cell: MonthDayCellData, t: Translate): string {
  const names = cell.extras
    .filter((e) => e.kind === 'holiday' && e.holiday)
    .map((e) => e.label)
    .join(', ');
  return [formatTodayCaption(cell.date), names, dayCountLabel(cell, t)].filter(Boolean).join(' · ');
}

export interface CappedDayContents {
  /** Birthdays and holidays that fit, in the shared cross-surface order. */
  extras: DayExtra[];
  /** Trips (never capped), then the all-day activities that fit. */
  allDay: DayItem[];
  /** Timed activities and travel segments that fit, merged by start time. */
  timeline: DayItem[];
  hidden: {
    /** Hidden extras plus hidden all-day activities (the all-day "+N"). */
    allDay: number;
    /** Hidden timed activities plus hidden travel segments (one "+N more"). */
    timeline: number;
  };
}

/**
 * A day's contents, optionally capped.
 *
 * With no `caps` it returns everything and hides nothing (the popover and the
 * phone day row). With `caps` it applies the stream's rules, moved here from
 * `MonthDayCard` with their reasoning:
 *
 * The all-day lane, shared by three sources competing for `caps.allDay`.
 *
 * Order is birthdays, then holidays, then the family's own all-day activities: a
 * birthday is about somebody in this family, a public holiday is reference data
 * about the country, and both are context for the day.
 *
 * ⚠️ But REFERENCE DAYS GET A RESERVED SHARE, NOT PRIORITY OVER EVERYTHING.
 * `STREAM_DAY_CAPS.allDay` is 2. A straight priority order meant a day carrying a
 * birthday AND a holiday consumed the entire budget and pushed every one of the
 * family's own all-day events behind "+N": on Christmas Day with somebody's
 * birthday, their actual plans vanished. The family's own events are the answer
 * to "what are we doing today"; the reference days are the caption.
 *
 * So reference days may claim at most half the cap (floored at one), and the
 * family's events take the rest, EXCEPT that neither side may strand a slot the
 * other is not using, which is what `Math.max(reserved, cap - allDayItems)`
 * buys. At a cap of 2 that resolves to: one reference day plus one event on a
 * contested day; both reference days when there are no events to show; and
 * exactly today's behaviour whenever there are no reference days at all.
 *
 * Trips are not capped. Timed activities are capped at `caps.timed` (earliest
 * first, as `prepareCellData` sorts them) and travel segments at `caps.segments`.
 * The capped kinds are filtered first and each list is then rebuilt in `dayItems`
 * order, so a cap never reorders a day.
 */
export function capDayContents(cell: MonthDayCellData, caps?: DayCaps): CappedDayContents {
  if (!caps) {
    return {
      extras: [...cell.extras],
      allDay: allDayItems(cell),
      timeline: byStartTime(cell),
      hidden: { allDay: 0, timeline: 0 },
    };
  }

  const referenceShare = Math.max(1, Math.floor(caps.allDay / 2));
  // How many of the day's extras actually fit, given what else the day is doing.
  const visibleReferenceCount = Math.min(
    cell.extras.length,
    Math.max(referenceShare, caps.allDay - cell.allDayItems.length)
  );
  const visibleAllDay = cell.allDayItems.slice(0, Math.max(0, caps.allDay - visibleReferenceCount));
  const hiddenAllDay = Math.max(0, cell.extras.length + cell.allDayItems.length - caps.allDay);

  const visibleTimed = cell.timedOccurrences.slice(0, caps.timed);
  const visibleSegments = cell.segments.slice(0, caps.segments);
  const hiddenTimeline =
    cell.timedOccurrences.length -
    visibleTimed.length +
    cell.segments.length -
    visibleSegments.length;

  return {
    extras: cell.extras.slice(0, visibleReferenceCount),
    allDay: buildAllDay(cell, visibleAllDay),
    timeline: mergeTimeline(visibleTimed, visibleSegments),
    hidden: { allDay: hiddenAllDay, timeline: hiddenTimeline },
  };
}
