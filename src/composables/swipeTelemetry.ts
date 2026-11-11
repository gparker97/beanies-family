/**
 * The swipe's diagnostic events on surface `horizontal-swipe` (as the calendar drag's live
 * in `drag/dragTelemetry.ts`). Allowlisted keys only, fixed per event:
 * - `swipe_end` (`useHorizontalSwipe`): `format` = the surface that swiped, `kind` = the
 *   outcome, `detail` = whether the touch guard claimed the gesture, `count` = the
 *   horizontal distance in px.
 * - `queue_dropped` (`useCalendarSlide`, {@link logQueueDropped}): `format` = the surface,
 *   `detail` = the reason, `count` = how many queued page turns never ran.
 *
 * The composable logs touch and pen gestures only, and only those that locked horizontal,
 * plus three diagnostics for gestures that did not: `vertical` and `unresolved` (a claimed
 * gesture that turned out not to be a swipe) and `locked_out` (a sideways touch ignored
 * because the consumer had switched the swipe off). A tap or an ordinary vertical scroll logs nothing.
 */
import { logEvent } from '@/services/telemetry/logEvent';

export const SWIPE_TELEMETRY_SURFACE = 'horizontal-swipe';

/**
 * Which surface the swipe belongs to. Required on every consumer: the planner views share
 * one route, so the firehose's `route_path` cannot tell them apart.
 */
export type SwipeSurface = 'month-grid' | 'month-stream' | 'week' | 'day' | 'meals' | 'deal-pile';

/**
 * How a horizontal gesture ended.
 * - `committed`: released past the threshold (a page turn).
 * - `committed_on_cancel`: the browser cancelled it after it had passed the threshold, and
 *   it turned the page anyway.
 * - `short`: released below the threshold.
 * - `browser_cancel`: the browser cancelled it below the threshold (it springs back).
 * - `multi_touch`: a second finger landed.
 * - `stale`: found still running at the next primary `pointerdown` (its pointerup was lost).
 * - `vertical`: a gesture the touch guard had claimed turned vertical (that touch lost its
 *   scroll: a false claim).
 * - `unresolved`: a claimed gesture ended (released or cancelled) before it locked either
 *   way (also a false claim).
 * - `locked_out`: a touch that landed while the consumer had switched the swipe off (for
 *   example the month grid while a drag is lifted) moved sideways; it was ignored, so the
 *   page may have scrolled instead. An animation in flight no longer switches it off
 *   (`useCalendarSlide` queues the turn instead).
 */
export type SwipeOutcome =
  | 'committed'
  | 'committed_on_cancel'
  | 'short'
  | 'browser_cancel'
  | 'multi_touch'
  | 'stale'
  | 'vertical'
  | 'unresolved'
  | 'locked_out';

export function logSwipeEnd(
  name: SwipeSurface,
  outcome: SwipeOutcome,
  claimed: boolean,
  dx: number
): void {
  logEvent({
    level: 'info',
    surface: SWIPE_TELEMETRY_SURFACE,
    message: 'swipe_end',
    context: {
      action: 'swipe_end',
      kind: outcome,
      format: name,
      detail: claimed ? 'claimed' : 'unclaimed',
      count: Math.round(Math.abs(dx)),
    },
  });
}

/** Why queued page turns were dropped (`useCalendarSlide`). */
export type QueueDropReason = 'disabled' | 'target_changed' | 'dispose';

/**
 * Page turns queued behind an animation were dropped (the consumer disabled the swipe, the
 * element changed, or the view went away): `count` turns the person asked for never ran.
 */
export function logQueueDropped(name: SwipeSurface, reason: QueueDropReason, count: number): void {
  logEvent({
    level: 'info',
    surface: SWIPE_TELEMETRY_SURFACE,
    message: 'queue_dropped',
    context: { action: 'queue_dropped', format: name, detail: reason, count },
  });
}
