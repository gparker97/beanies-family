/**
 * Calendar drag and drop (#142): the pure patch math. No Vue, no DOM, no store.
 *
 * The controller (`useCalendarDrag`) resolves WHERE a drop landed (`DropTarget`, from the
 * `dragDom.ts` attribute protocol) and WHAT was grabbed (`DragSource`, from the store), then
 * calls `dropPatch` once. The result is a minimal `UpdateFamilyActivityInput` diff (only the
 * keys the drop changed, like the edit form's) that the orchestrator (`useCalendarMove`) hands
 * to `updateActivity` or the scoped save. Nothing here throws: every outcome is a
 * `PatchResult` the caller must branch on.
 *
 * ## The grab-point model
 *
 * One activity can be drawn many times (a multi-day bar has a slice per cell, a shared
 * activity a block per member column), and the DOM's occurrence date is the CELL's, not the
 * record's. So the record's start never comes from the DOM. `grabDate`/`grabMinutes` are
 * where the finger was at press; the drop applies the DELTA from there to the record's (or
 * the occurrence's) own start. A bar grabbed on its third day and dropped one cell right
 * moves the whole span by one day; a block grabbed half-way down keeps that offset.
 *
 * Plan: `~/projects/beanies-ops/docs/plans/2026-11-05-calendar-drag-and-drop-142.md`.
 */
import type { FamilyActivity, UpdateFamilyActivityInput } from '@/types/models';
import { effectiveAssignees, toAssigneePayload } from '@/utils/assignees';
import {
  endDateOffsetDays,
  isAllDayActivity,
  isRepeatingActivity,
} from '@/utils/calendar/activityDays';
import {
  MINUTES_PER_DAY,
  PLANNER_ASSUMED_DURATION_MIN,
  timedSpanMinutes,
} from '@/utils/calendar/timeSpans';
import { addDaysYmd, daysBetweenYmd, extractDatePart, minutesToHHmm } from '@/utils/date';

/** Every drag tuning constant, in one place. */
export const DRAG = {
  longPressMs: 300,
  mouseSlopPx: 4,
  touchSlopPx: 8,
  snapMinutes: 15,
  minDurationMinutes: 15,
  edgeDwellMs: 600,
  edgeZonePx: 24,
} as const;

/** The latest start (and keyboard/pointer end) a timeline target can name: 23:45. */
export const LAST_SNAPPED_MINUTE = MINUTES_PER_DAY - DRAG.snapMinutes;

export type DragItemKind = 'timed' | 'allday';
export type DragView = 'month' | 'week' | 'day';
export type DragGesture = 'move' | 'resize-end';

/** Where a drop landed, resolved from data attributes by the controller. */
export type DropTarget =
  /** A month cell, a week all-day column, a week-strip pill. */
  | { kind: 'day'; date: string }
  /** A timeline column; `minutes` is snapped. `memberId` only on day-view member columns. */
  | { kind: 'time'; date: string; minutes: number; memberId?: string };

/**
 * The occurrence being dragged.
 *
 * - `seriesDate`: the START of the grabbed occurrence (`YYYY-MM-DD`): the record's own date
 *   for a one-off or override child, `activityStore.repeatStartFor(activity, grabDate)` for a
 *   repeat. The moved `date` is this plus the day delta.
 * - `grabDate` / `grabMinutes`: where the finger was at press (the drop target under the
 *   pointer), NOT the record's start. For a resize, `grabMinutes` is the end being dragged.
 * - `columnMemberId`: the day-view member column the block was grabbed in.
 */
export interface DragSource {
  activity: FamilyActivity;
  seriesDate: string;
  grabDate: string;
  grabMinutes?: number;
  columnMemberId?: string;
}

/** One result type for every patch builder: no null / string-literal / throw mix. */
export type PatchResult =
  | { kind: 'patch'; patch: UpdateFamilyActivityInput; effect: 'moved' | 'resized' | 'reassigned' }
  /** Same place / same column: nothing to write. */
  | { kind: 'noop' }
  | { kind: 'refused'; reason: 'too-short' | 'crosses-midnight' }
  /** The stored time cannot be parsed; reported, and the chip springs back. */
  | { kind: 'invalid'; reason: 'unreadable-time' };

/** Snap to the nearest `step` minutes. */
export function snap(minutes: number, step: number = DRAG.snapMinutes): number {
  return Math.round(minutes / step) * step;
}

/** Clamp minutes of the day to the timeline's snapped range, [00:00, 23:45]. */
export function clampMinutes(minutes: number): number {
  return Math.max(0, Math.min(minutes, LAST_SNAPPED_MINUTE));
}

/**
 * A pointer's offset inside a timeline column → minutes of the day, snapped and clamped to
 * [00:00, 23:45]. `hourPx` comes from the column's own rendered height (see `dragDom.ts`), so
 * Large reading mode needs nothing. A degenerate `hourPx` resolves to the column's first hour
 * rather than `NaN`.
 */
export function pointToMinutes(yInColumnPx: number, hourPx: number, hourStart: number): number {
  const base = hourStart * 60;
  if (!(hourPx > 0) || !Number.isFinite(yInColumnPx)) return clampMinutes(base);
  return clampMinutes(snap(base + (yInColumnPx / hourPx) * 60));
}

/** Timed vs all-day, by the rule the rest of the calendar uses. */
export function dragItemKindOf(activity: FamilyActivity): DragItemKind {
  return isAllDayActivity(activity) ? 'allday' : 'timed';
}

/**
 * Not vacation-linked (the drawer redirects those to Travel) and not soft-deleted.
 * Birthdays, holidays, trips and travel segments never carry a drag source at all.
 */
export function isDraggableActivity(activity: FamilyActivity): boolean {
  return !activity.vacationId && activity.isActive !== false;
}

/** A one-off owns its absolute `endDate`; a series or override child has it rebased for it. */
function isOneOff(activity: FamilyActivity): boolean {
  return !isRepeatingActivity(activity) && !activity.parentActivityId;
}

/** The planner span of a timed record, or `null` when either stored time is unreadable. */
function readSpan(activity: FamilyActivity) {
  const span = timedSpanMinutes(activity.startTime, activity.endTime, PLANNER_ASSUMED_DURATION_MIN);
  // An unreadable END would make any written end a silent fallback over the stored value.
  if (!span || span.endUnreadable) return null;
  return span;
}

/**
 * The `endDate` part of a patch, or `{}` to leave it out.
 *
 * - A one-off whose date moved carries its absolute end along (`updateActivity` only
 *   rebases series and children).
 * - Any record with an EXPLICIT end day whose end time now wraps onto a different day
 *   (`dayCarry`, e.g. calendar sync's 22:00 → 01:00-next-day moved to 20:00 – 23:00) carries
 *   the new end day, or `undefined` when it now ends on its start day. The scoped save
 *   re-expresses it for a series (`lastsOnto`); `updateActivity` honours it for a child.
 * - Otherwise a series/child leaves `endDate` out, and the store rebases it on the date move.
 */
function endDatePart(
  activity: FamilyActivity,
  newDate: string,
  dayDelta: number,
  dayCarry: number
): Pick<UpdateFamilyActivityInput, 'endDate'> {
  if (!activity.endDate) return {};
  if (dayCarry === 0 && !(isOneOff(activity) && dayDelta !== 0)) return {};
  const offset = endDateOffsetDays(activity) + dayCarry;
  return { endDate: offset > 0 ? addDaysYmd(newDate, offset) : undefined };
}

/** @internal Exported for tests; callers use `dropPatch`. */
export function movePatch(src: DragSource, target: DropTarget): PatchResult {
  const { activity } = src;
  const kind = dragItemKindOf(activity);
  const dayDelta = daysBetweenYmd(src.grabDate, target.date);
  const newDate = addDaysYmd(extractDatePart(src.seriesDate), dayDelta);

  // An all-day item never becomes timed, and a timed item dropped on a day (a month cell,
  // the all-day row, a strip pill) keeps its times.
  if (kind === 'allday' || target.kind === 'day') {
    if (dayDelta === 0) return { kind: 'noop' };
    if (kind === 'timed' && !readSpan(activity)) {
      return { kind: 'invalid', reason: 'unreadable-time' };
    }
    return {
      kind: 'patch',
      effect: 'moved',
      patch: { date: newDate, ...endDatePart(activity, newDate, dayDelta, 0) },
    };
  }

  const span = readSpan(activity);
  if (!span) return { kind: 'invalid', reason: 'unreadable-time' };
  // The pointer's (or keyboard step's) minute delta from where it lifted (both supply a
  // snapped `grabMinutes`; without one the target names the start itself). A move that
  // changes the time lands its START on the 15-minute grid, so an off-grid 16:10 block moved
  // one step down lands on 16:30, not 16:25; its duration is kept. A move that keeps the
  // time (a same-height drop on another day) leaves an off-grid start where it is.
  const pointerDelta = target.minutes - (src.grabMinutes ?? span.start);
  const newStart = pointerDelta === 0 ? span.start : clampMinutes(snap(span.start + pointerDelta));
  const minuteDelta = newStart - span.start;
  if (dayDelta === 0 && minuteDelta === 0) return { kind: 'noop' };

  const patch: UpdateFamilyActivityInput = {};
  if (dayDelta !== 0) patch.date = newDate;
  let dayCarry = 0;
  if (minuteDelta !== 0) {
    // Same length, in minutes, so an overnight event keeps its shape. NOT `addMinutesToTime`,
    // which clamps at 23:59.
    const duration = span.end - span.start;
    const newEnd = newStart + duration;
    dayCarry = Math.floor(newEnd / MINUTES_PER_DAY) - Math.floor(span.end / MINUTES_PER_DAY);
    patch.startTime = minutesToHHmm(newStart);
    // An end-less record stays end-less: the assumed hour is a drawing default, not data.
    if (activity.endTime) {
      patch.endTime = minutesToHHmm(newEnd % MINUTES_PER_DAY);
    }
  }
  Object.assign(patch, endDatePart(activity, newDate, dayDelta, dayCarry));
  return { kind: 'patch', effect: 'moved', patch };
}

/** @internal Exported for tests; callers use `dropPatch`. */
export function resizePatch(src: DragSource, target: DropTarget): PatchResult {
  const { activity } = src;
  // Only timed blocks carry a resize handle; anything else is a no-op, never a write.
  if (target.kind !== 'time' || dragItemKindOf(activity) !== 'timed') return { kind: 'noop' };
  const span = readSpan(activity);
  if (!span) return { kind: 'invalid', reason: 'unreadable-time' };

  // A timeline resize stays inside the start day: dragging the handle into the next day's
  // column means "past midnight", which needs the edit sheet; an earlier day is shorter
  // than nothing.
  const dayDelta = daysBetweenYmd(src.grabDate, target.date);
  if (dayDelta > 0) return { kind: 'refused', reason: 'crosses-midnight' };
  if (dayDelta < 0) return { kind: 'refused', reason: 'too-short' };
  // A timed multi-day record (end day beyond its time wrap) is drawn on its start day only;
  // its end is not on this column, so the handle cannot name it.
  const wrap = Math.floor(span.end / MINUTES_PER_DAY);
  if (activity.endDate && endDateOffsetDays(activity) > wrap) {
    return { kind: 'refused', reason: 'crosses-midnight' };
  }

  if (src.grabMinutes !== undefined && target.minutes === src.grabMinutes) return { kind: 'noop' };
  const newEnd = target.minutes;
  if (newEnd >= MINUTES_PER_DAY) return { kind: 'refused', reason: 'crosses-midnight' };
  if (newEnd - span.start < DRAG.minDurationMinutes)
    return { kind: 'refused', reason: 'too-short' };
  const endTime = minutesToHHmm(newEnd);
  if (endTime === activity.endTime) return { kind: 'noop' };

  const newDate = extractDatePart(src.seriesDate);
  return {
    kind: 'patch',
    effect: 'resized',
    patch: { endTime, ...endDatePart(activity, newDate, 0, -wrap) },
  };
}

/**
 * @internal Exported for tests; callers use `dropPatch`.
 *
 * The assignee part of a day-view column drop, or `null` for none. Only a single-owner
 * activity grabbed in its owner's column changes hands (the 0/1/2+ rule `isSharedEvent`
 * uses); a shared or family-wide one moves time only, whatever column it lands in.
 */
export function reassignPatch(
  src: DragSource,
  target: DropTarget,
  isKnownMember: (id: string) => boolean
): Pick<UpdateFamilyActivityInput, 'assigneeIds' | 'assigneeId'> | null {
  if (target.kind !== 'time' || !target.memberId || !src.columnMemberId) return null;
  if (target.memberId === src.columnMemberId || !isKnownMember(target.memberId)) return null;
  const owners = effectiveAssignees(src.activity, isKnownMember);
  if (owners.length !== 1 || owners[0] !== src.columnMemberId) return null;
  return toAssigneePayload([target.memberId]);
}

/**
 * The ONE entry point the controller calls on a drop (pointer up or Enter). Picks the
 * builder by gesture and merges a move with a day-view reassignment into one patch.
 */
export function dropPatch(
  src: DragSource,
  target: DropTarget,
  gesture: DragGesture,
  isKnownMember: (id: string) => boolean
): PatchResult {
  if (gesture === 'resize-end') return resizePatch(src, target);

  // An all-day source over a timeline is a day drop (never converted to timed).
  const effectiveTarget: DropTarget =
    dragItemKindOf(src.activity) === 'allday' && target.kind === 'time'
      ? { kind: 'day', date: target.date }
      : target;
  const moved = movePatch(src, effectiveTarget);
  if (moved.kind === 'refused' || moved.kind === 'invalid') return moved;
  const assignees = reassignPatch(src, effectiveTarget, isKnownMember);
  if (!assignees) return moved;
  const patch = moved.kind === 'patch' ? { ...moved.patch, ...assignees } : assignees;
  return { kind: 'patch', effect: 'reassigned', patch };
}
