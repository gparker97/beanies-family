/**
 * Calendar drag and drop (#142): the binding's `calendar-drag` events (the `drop` event is
 * `useCalendarMove.logDrop`). Allowlisted keys only, fixed per surface: `format` = view,
 * `kind` = item kind, `detail` = input (or the cancel / ineligible reason), `recur_outcome` =
 * gesture, `stage` = lifecycle. See the plan's Observability Coverage.
 */
import { logEvent } from '@/services/telemetry';
import type { FamilyActivity } from '@/types/models';
import type { CancelReason, DragInput } from '@/utils/calendar/dragGesture';
import { dragItemKindOf, type DragGesture, type DragView } from '@/utils/calendar/dragMath';
import { reportError } from '@/utils/errorReporter';

export const DRAG_SURFACE = 'calendar-drag';

export type IneligibleReason = 'no-permission' | 'read-only';

/** A press on a draggable that may not lift (debug: it is expected, not a fault). */
export function logIneligible(detail: IneligibleReason): void {
  logEvent({
    surface: DRAG_SURFACE,
    level: 'debug',
    message: 'ineligible',
    context: { action: 'ineligible', detail },
  });
}

export function logLift(
  view: DragView,
  activity: FamilyActivity,
  input: DragInput,
  gesture: DragGesture
): void {
  logEvent({
    surface: DRAG_SURFACE,
    level: 'info',
    message: 'lift',
    context: {
      action: 'lift',
      format: view,
      kind: dragItemKindOf(activity),
      detail: input,
      recur_outcome: gesture,
      stage: 'lifted',
      activity_id: activity.id,
    },
  });
}

export function logCancel(view: DragView, reason: CancelReason): void {
  logEvent({
    surface: DRAG_SURFACE,
    level: 'info',
    message: 'cancel',
    context: { action: 'cancel', format: view, detail: reason },
  });
}

/**
 * Pointer capture refused: the pointer is already gone (a lost race on mobile Safari; its
 * cancel follows) or already released. Expected, so debug, as `useHorizontalSwipe` warns.
 */
export function logCaptureFailed(detail: 'set-failed' | 'release-failed', error: unknown): void {
  logEvent({
    surface: DRAG_SURFACE,
    level: 'debug',
    message: 'capture',
    context: { action: 'capture', detail },
    error,
  });
}

/** An invariant broke inside the drag itself (not a store write, which reports its own). */
export function reportDragFault(
  message: string,
  context: { action: string; detail?: string; stage?: string; activity_id?: string },
  error?: unknown
): void {
  reportError({ surface: DRAG_SURFACE, severity: 'error', message, error, context });
}
