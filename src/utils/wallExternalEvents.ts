/**
 * View-only external events on the beanie wall's time grid (plan 2026-11-17, C4).
 *
 * Pure: no Vue, no stores. The wall's views hand each grid column its timed external
 * events as `WallExternalItem`s beside the column's activity occurrences, and the grid
 * lays both out through ONE `layoutTimeGrid` call with `wallGridSpan`, so an external
 * event that overlaps an activity splits the column exactly as two activities would.
 * Nothing here fabricates a `FamilyActivity`.
 */
import type { ExternalEvent } from '@/types/externalEvents';
import { externalWindowOn } from '@/utils/calendar/externalDisplay';
import { minutesOfDay } from '@/utils/date';
import { activityGridSpan, type GridSpan } from '@/utils/wallTimeGrid';
import type { WallOccurrence } from '@/utils/wallActivities';

/**
 * A timed view-only event placed on one wall column: its window on that column's day,
 * in minutes since that day's midnight. Read once through `externalWindowOn`, so an
 * overnight event is clamped on the wall exactly as on the planner (the start day runs
 * to midnight, the next day draws its tail from 00:00).
 */
export interface WallExternalItem {
  kind: 'external';
  event: ExternalEvent;
  /** The column's day. */
  ymd: string;
  start: number;
  end: number;
}

/** Everything the wall's time grid lays out. */
export type WallGridItem = WallOccurrence | WallExternalItem;

export function isWallExternal(item: WallGridItem): item is WallExternalItem {
  return 'kind' in item && item.kind === 'external';
}

/**
 * The column's timed external events as grid items. All-day events are skipped (they
 * reach the band through `useDayExtras`), and so is an event whose instants are not
 * finite numbers, which normalization never produces: a NaN here would otherwise put
 * every block of the column at the top of the axis.
 */
export function wallExternalItems(
  events: readonly ExternalEvent[],
  ymd: string
): WallExternalItem[] {
  const out: WallExternalItem[] = [];
  for (const event of events) {
    if (event.allDay || !Number.isFinite(event.startMs) || !Number.isFinite(event.endMs)) continue;
    const drawn = externalWindowOn(event, ymd);
    const start = minutesOfDay(drawn.startTime);
    const end = minutesOfDay(drawn.endTime);
    if (start === null || end === null) continue;
    // A zero-length event still gets a positive span, as `activitySpanMinutes` floors one.
    out.push({ kind: 'external', event, ymd, start, end: Math.max(start + 1, end) });
  }
  return out;
}

/** The grid's `spanOf`: an activity reads exactly as the default; an external, its window. */
export function wallGridSpan(item: WallGridItem): GridSpan {
  if (isWallExternal(item)) return { start: item.start, end: item.end };
  return activityGridSpan(item);
}

/** A key unique within one grid column, for either kind of item. */
export function wallGridItemKey(item: WallGridItem): string {
  return isWallExternal(item)
    ? `x:${item.event.viewedCalendarId}:${item.event.id}:${item.ymd}`
    : `${item.activity.id}:${item.date}`;
}
