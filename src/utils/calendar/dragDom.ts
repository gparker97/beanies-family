/**
 * Calendar drag and drop (#142): the ONE definition of the DOM protocol between the views
 * and the drag controller.
 *
 * Views declare drop targets and drag sources with attributes (`v-bind="dayDropAttrs(date)"`),
 * never with props, so nothing is drilled through the view tree and no `.vue` file spells a
 * `data-drag` / `data-drop` attribute literally. The controller hit-tests with
 * `document.elementFromPoint` and reads back through `readDropTarget` / `readDragSourceRef`.
 * Every writer here has its reader beside it, and `dragDom.test.ts` round-trips each pair so
 * the two sides cannot disagree.
 *
 * Sources reuse the reveal hooks every view already stamps on an activity element
 * (`data-activity-id` / `data-occurrence-date`, see `useActivityReveal.ts`).
 */
import { pointToMinutes, type DragGesture, type DropTarget } from '@/utils/calendar/dragMath';

export const DRAG_ATTR = {
  source: 'data-drag',
  drop: 'data-drop',
  date: 'data-date',
  hourStart: 'data-hour-start',
  hourEnd: 'data-hour-end',
  memberId: 'data-member-id',
} as const;

/** The reveal hooks (owned by `useActivityReveal`), read here as the source's identity. */
const ACTIVITY_ID_ATTR = 'data-activity-id';
const OCCURRENCE_DATE_ATTR = 'data-occurrence-date';

/** The reveal-hooked element `el` belongs to: the activity's block or chip (a resize handle's block). */
export function activityHostOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(`[${ACTIVITY_ID_ATTR}]`);
}

/** What a pressed element names. `occurrenceDate` is only the fallback grab date (see `DragSource`). */
export interface DragSourceRef {
  activityId: string;
  occurrenceDate: string;
  gesture: DragGesture;
  /** The day view's member column the source sits in. */
  columnMemberId?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const GESTURES: readonly DragGesture[] = ['move', 'resize-end'];

/** A whole hour 0..23, or `null`. */
function readHour(raw: string | null): number | null {
  if (raw === null || !/^\d{1,2}$/.test(raw)) return null;
  const hour = Number(raw);
  return hour <= 23 ? hour : null;
}

/** A day drop target: a month cell, a week all-day column, a week-strip pill. */
export function dayDropAttrs(date: string): Record<string, string> {
  return { [DRAG_ATTR.drop]: 'day', [DRAG_ATTR.date]: date };
}

/**
 * A timeline drop target: the whole column for `date`, drawn from `hourStart` to `hourEnd`
 * inclusive (the grid's `timeRange`). `memberId` only on the day view's member columns.
 * The hours are read at drop time, so a grid that re-flows after the drop is irrelevant.
 */
export function timeDropAttrs(
  date: string,
  hourStart: number,
  hourEnd: number,
  memberId?: string
): Record<string, string> {
  return {
    [DRAG_ATTR.drop]: 'time',
    [DRAG_ATTR.date]: date,
    [DRAG_ATTR.hourStart]: String(hourStart),
    [DRAG_ATTR.hourEnd]: String(hourEnd),
    ...(memberId ? { [DRAG_ATTR.memberId]: memberId } : {}),
  };
}

/** A drag source: the chip/block (`move`) or its bottom resize handle (`resize-end`). */
export function dragSourceAttrs(gesture: DragGesture): Record<string, string> {
  return { [DRAG_ATTR.source]: gesture };
}

/**
 * The drop target `el` is in (`el` itself or its nearest `[data-drop]` ancestor), with the
 * pointer's viewport `pointY` turned into snapped minutes for a timeline. Pixels per hour
 * come from the column's own rendered height, so Large reading mode and any row-height
 * change need nothing. `null` when there is no well-formed target (including a column with
 * no rendered height).
 */
export function readDropTarget(el: Element, pointY: number): DropTarget | null {
  const drop = el.closest(`[${DRAG_ATTR.drop}]`);
  if (!drop) return null;
  const date = drop.getAttribute(DRAG_ATTR.date);
  if (!date || !YMD.test(date)) return null;
  const kind = drop.getAttribute(DRAG_ATTR.drop);
  if (kind === 'day') return { kind: 'day', date };
  if (kind !== 'time') return null;

  const hourStart = readHour(drop.getAttribute(DRAG_ATTR.hourStart));
  const hourEnd = readHour(drop.getAttribute(DRAG_ATTR.hourEnd));
  if (hourStart === null || hourEnd === null || hourEnd < hourStart) return null;
  const rect = drop.getBoundingClientRect();
  if (!(rect.height > 0)) return null;
  const hourPx = rect.height / (hourEnd - hourStart + 1);
  const minutes = pointToMinutes(pointY - rect.top, hourPx, hourStart);
  const memberId = drop.getAttribute(DRAG_ATTR.memberId);
  return memberId ? { kind: 'time', date, minutes, memberId } : { kind: 'time', date, minutes };
}

/**
 * The drag source `el` is in (`el` or its nearest `[data-drag]` ancestor). The activity's
 * identity comes from the nearest reveal-hooked element (the block itself, or the block a
 * resize handle sits in); the member column from the nearest `[data-member-id]`. `null` when
 * anything is missing or malformed.
 */
export function readDragSourceRef(el: Element): DragSourceRef | null {
  const source = el.closest(`[${DRAG_ATTR.source}]`);
  if (!source) return null;
  const gesture = source.getAttribute(DRAG_ATTR.source) as DragGesture | null;
  if (!gesture || !GESTURES.includes(gesture)) return null;
  const host = activityHostOf(source);
  const activityId = host?.getAttribute(ACTIVITY_ID_ATTR);
  const occurrenceDate = host?.getAttribute(OCCURRENCE_DATE_ATTR);
  if (!activityId || !occurrenceDate || !YMD.test(occurrenceDate)) return null;
  const columnMemberId = source
    .closest(`[${DRAG_ATTR.memberId}]`)
    ?.getAttribute(DRAG_ATTR.memberId);
  return columnMemberId
    ? { activityId, occurrenceDate, gesture, columnMemberId }
    : { activityId, occurrenceDate, gesture };
}
