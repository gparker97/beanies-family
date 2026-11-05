/**
 * Calendar drag and drop (#142): the slot a lifted timed block would fill on a timeline, and
 * where that slot is on screen.
 *
 * `timelineSlot` (pure) answers "if it dropped here, from when to when?" by asking the SAME
 * `dropPatch` the drop will run, so the preview can never disagree with the write. The views
 * pass it as `useCalendarDrag`'s `snap` option; the binding exposes the answer as `overSlot`,
 * which the timelines draw as a ringed slot preview (the only visual a keyboard lift has),
 * and `slotRectAt` turns it into the viewport rect the pointer ghost snaps to, with the
 * readout pill ("4pm – 5pm" for a move, the end time for a resize).
 *
 * Plan: `~/projects/beanies-ops/docs/plans/2026-11-05-calendar-drag-and-drop-142.md`.
 */
import { plannerExtent } from '@/composables/useCalendarNavigation';
import type { Point, SnapRect } from '@/composables/drag/useDragGhost';
import { DRAG_ATTR } from '@/utils/calendar/dragDom';
import {
  DRAG,
  LAST_SNAPPED_MINUTE,
  dragItemKindOf,
  dropPatch,
  type DragGesture,
  type DragSource,
  type DropTarget,
} from '@/utils/calendar/dragMath';
import { formatTime12, minutesToHHmm } from '@/utils/date';

/** A drop's would-be window on one timeline column. */
export interface TimelineSlot {
  date: string;
  /** The day view's member column the slot is drawn in. */
  memberId?: string;
  /** The window to draw (`HH:mm`; `endTime` absent for an end-less record: an assumed hour). */
  startTime: string;
  endTime?: string;
  /** The time pill above the ghost. */
  readout: string;
}

/**
 * The slot a timed block would fill if dropped on `target` now, or `null` when the target is
 * not a timeline, the item is all-day (it never becomes timed), the stored time is unreadable,
 * or a resize has left its own column (the drop refuses that; the ghost follows the pointer).
 */
export function timelineSlot(
  target: DropTarget,
  source: DragSource,
  gesture: DragGesture
): TimelineSlot | null {
  const { activity } = source;
  if (target.kind !== 'time' || dragItemKindOf(activity) !== 'timed' || !activity.startTime) {
    return null;
  }
  // Reassignment never changes the window, so no member is "known" here.
  const result = dropPatch(source, target, gesture, () => false);
  if (result.kind === 'invalid') return null;
  const where = { date: target.date, ...(target.memberId ? { memberId: target.memberId } : {}) };

  if (gesture === 'resize-end') {
    if (result.kind === 'refused' && result.reason === 'crosses-midnight') return null;
    // The end the pointer names, drawn at least the minimum length: a too-short end is
    // refused on drop with its own toast, but the slot still shows where the pointer is. It
    // never passes the last slot (a 23:45 start would otherwise draw to '24:00', an end the
    // drop refuses), nor falls before the start (the grid would read it as overnight).
    const start = plannerExtent({ startTime: activity.startTime })?.start ?? 0;
    const drawnEnd = Math.min(
      Math.max(target.minutes, start + DRAG.minDurationMinutes),
      Math.max(start, LAST_SNAPPED_MINUTE)
    );
    return {
      ...where,
      startTime: activity.startTime,
      endTime: minutesToHHmm(drawnEnd),
      readout: formatTime12(minutesToHHmm(target.minutes)),
    };
  }

  const patch = result.kind === 'patch' ? result.patch : {};
  const startTime = patch.startTime ?? activity.startTime;
  // A minute move rewrites both times (or leaves an end-less record end-less); a pure day
  // move keeps the stored window.
  const endTime = patch.startTime !== undefined ? patch.endTime : activity.endTime;
  const readout = endTime
    ? `${formatTime12(startTime)} – ${formatTime12(endTime)}`
    : formatTime12(startTime);
  return { ...where, startTime, ...(endTime ? { endTime } : {}), readout };
}

/**
 * The viewport rect of `slot` in the timeline column under `point`, or `null` when the
 * pointer is not over that slot's column. Pixels per hour come from the column's own height,
 * as `readDropTarget` reads them, so Large reading mode needs nothing.
 */
export function slotRectAt(point: Point, slot: TimelineSlot): SnapRect | null {
  const column = document.elementFromPoint(point.x, point.y)?.closest(`[${DRAG_ATTR.drop}="time"]`);
  if (!column || column.getAttribute(DRAG_ATTR.date) !== slot.date) return null;
  const hourStart = Number(column.getAttribute(DRAG_ATTR.hourStart));
  const hourEnd = Number(column.getAttribute(DRAG_ATTR.hourEnd));
  const rect = column.getBoundingClientRect();
  const extent = plannerExtent(slot);
  if (!extent || !(rect.height > 0) || !(hourEnd >= hourStart)) return null;
  const hourPx = rect.height / (hourEnd - hourStart + 1);
  return {
    left: rect.left,
    top: rect.top + ((extent.start - hourStart * 60) / 60) * hourPx,
    width: rect.width,
    height: ((extent.end - extent.start) / 60) * hourPx,
  };
}
