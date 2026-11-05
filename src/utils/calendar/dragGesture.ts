/**
 * Calendar drag and drop (#142): the gesture state machine. Pure: no Vue, no DOM, no timers.
 *
 *   idle → pressed → lifted → committing → idle
 *
 * `reduce(state, event)` returns the next state and a list of EFFECTS the binding
 * (`useCalendarDrag`) executes: it owns the real timer, pointer capture, the ghost, the
 * haptic and the live region; this module owns every rule about WHEN those happen.
 *
 * - **Mouse** lifts on `DRAG.mouseSlopPx` of movement, no hold. From press on, the binding
 *   stops the pointer's events (so the month swipe never arms on a chip).
 * - **Touch / pen** lift after a still `DRAG.longPressMs` hold. Moving more than
 *   `DRAG.touchSlopPx` first hands the gesture back (it was a scroll or a swipe). Nothing is
 *   stopped before lift.
 * - **Another press** while a gesture is under way is decided here too (see `onDown`): a second
 *   finger cancels (a pinch proceeds), the same pointer again ends a gesture whose up was lost
 *   and presses afresh, a pointer press ends a keyboard lift and presses afresh, and a
 *   non-primary button only cancels.
 * - **Single flight**: nothing lifts while `committing` (a drop's write, including an open
 *   scope prompt, is in flight; `chooseScope()` replaces its resolver if called twice).
 * - **Keyboard**: Space lifts a focused chip, arrows step the target (`stepTarget`),
 *   Shift+↑/↓ resizes the end on a timeline, Enter drops, Escape cancels.
 *
 * Plan: `~/projects/beanies-ops/docs/plans/2026-11-05-calendar-drag-and-drop-142.md`.
 */
import {
  DRAG,
  clampMinutes,
  type DragGesture,
  type DragView,
  type DropTarget,
} from '@/utils/calendar/dragMath';
import { addDaysYmd } from '@/utils/date';

export type PointerInput = 'mouse' | 'touch' | 'pen';
export type DragInput = PointerInput | 'keyboard';
export type DragPhase = 'idle' | 'pressed' | 'lifted' | 'committing';

/** Why a lifted drag ended without a drop. Logged as `detail` on the `cancel` event. */
export type CancelReason =
  | 'escape'
  | 'pointercancel'
  | 'second-pointer'
  | 'lost-up'
  /** A non-primary button (right-click, pen barrel) was pressed. */
  | 'button'
  /** A pointer pressed during a keyboard lift (that press then starts its own gesture). */
  | 'pointer-down'
  /** The ghost could not be built; a drag never runs without one. */
  | 'ghost'
  | 'hidden'
  | 'overlay'
  | 'no-target'
  | 'dispose';

/**
 * Does the pointer's own click follow a cancel for `reason` (so the binding swallows it)? Not
 * when the up was lost (it never comes), the view is going away (nothing is left to click), or
 * a new pointer press caused it and became a fresh press (`lost-up`, `pointer-down`): that
 * press is a new gesture, and its own click is wanted if it stays a tap. A keyboard lift never
 * swallows (no pointer click is owed); see `cancelLifted`.
 */
export function clickFollowsCancel(reason: CancelReason): boolean {
  return reason !== 'lost-up' && reason !== 'pointer-down' && reason !== 'dispose';
}

export type DragState =
  | { phase: 'idle' }
  | {
      phase: 'pressed';
      input: PointerInput;
      pointerId: number;
      x: number;
      y: number;
      gesture: DragGesture;
      /** The drop target under the pointer at press (see `DragSource.grabDate`). */
      grab: DropTarget | null;
    }
  | {
      phase: 'lifted';
      input: DragInput;
      /** Absent for a keyboard lift. */
      pointerId?: number;
      gesture: DragGesture;
      grab: DropTarget | null;
      /** Where a drop would land now; `null` while over nothing droppable. */
      target: DropTarget | null;
      /** Keyboard lift on a timeline: the block's END, so Shift+↑/↓ can switch to a resize. */
      endGrab?: DropTarget;
      /** Keyboard lift only: which view's steps the arrows take. */
      view?: DragView;
    }
  | { phase: 'committing' };

/** Per-render context `stepTarget` clamps against. */
export interface StepContext {
  /** The visible dates, in order (the week's columns); a day step stays inside them. */
  dates?: readonly string[];
  /** The day view's member columns, in order; ←/→ steps between them. */
  memberIds?: readonly string[];
}

export type DragEvent =
  | {
      type: 'down';
      input: PointerInput;
      pointerId: number;
      /** `PointerEvent.button`: 0 is the primary (left button, finger, pen tip). */
      button: number;
      x: number;
      y: number;
      t: number;
      /**
       * The press this down would start: a draggable the person may move, its gesture and the
       * grab target. `null` when it is not on one (the down can still end a gesture).
       */
      press: { gesture: DragGesture; grab: DropTarget | null } | null;
    }
  | {
      type: 'move';
      pointerId: number;
      x: number;
      y: number;
      t: number;
      /** The target under the pointer, resolved by the binding; omitted = unchanged. */
      target?: DropTarget | null;
    }
  | { type: 'up'; pointerId: number }
  | { type: 'cancel'; reason: CancelReason }
  | { type: 'timer' }
  | {
      type: 'key';
      key: string;
      shift: boolean;
      /** Space on a focused chip: where it is now (its start, and its end on a timeline). */
      lift?: { view: DragView; gesture: DragGesture; origin: DropTarget; endOrigin?: DropTarget };
      steps?: StepContext;
    }
  /** The commit finished (saved, refused, failed or cancelled at the scope prompt). */
  | { type: 'settled' };

export type AnnounceKind = 'lifted' | 'over' | 'cancelled';

export type DragEffect =
  | { type: 'start-timer'; ms: number }
  | { type: 'clear-timer' }
  | { type: 'lift'; input: DragInput; gesture: DragGesture; grab: DropTarget | null }
  | {
      type: 'drop';
      input: DragInput;
      gesture: DragGesture;
      grab: DropTarget | null;
      target: DropTarget;
    }
  /** `swallowClick`: arm the one-shot swallow for the click the cancelled pointer ends with. */
  | { type: 'cancel'; reason: CancelReason; swallowClick: boolean }
  | { type: 'haptic' }
  | { type: 'announce'; kind: AnnounceKind; target?: DropTarget }
  | { type: 'release-capture'; pointerId: number };

export interface DragStep {
  state: DragState;
  effects: DragEffect[];
}

export const IDLE: DragState = { phase: 'idle' };

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function same(state: DragState): DragStep {
  return { state, effects: [] };
}

function targetsEqual(a: DropTarget | null | undefined, b: DropTarget | null | undefined) {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind || a.date !== b.date) return false;
  if (a.kind === 'day' || b.kind === 'day') return true;
  return a.minutes === b.minutes && a.memberId === b.memberId;
}

/**
 * Should the binding stop this pointer's events (`stopImmediatePropagation`) so the
 * bubble-phase swipe never sees them? Mouse from press (a mouse drag on a chip is a drag,
 * never a swipe), touch/pen only once lifted (before that the press may be a scroll).
 */
export function ownsPointer(state: DragState, pointerId: number): boolean {
  if (state.phase === 'pressed') return state.input === 'mouse' && state.pointerId === pointerId;
  if (state.phase === 'lifted') return state.pointerId === pointerId;
  return false;
}

/** The lifted drag ends without a drop. */
function cancelLifted(state: Extract<DragState, { phase: 'lifted' }>, reason: CancelReason) {
  const effects: DragEffect[] = [];
  if (state.pointerId !== undefined) {
    effects.push({ type: 'release-capture', pointerId: state.pointerId });
  }
  effects.push(
    {
      type: 'cancel',
      reason,
      swallowClick: state.input !== 'keyboard' && clickFollowsCancel(reason),
    },
    { type: 'announce', kind: 'cancelled' }
  );
  return { state: IDLE, effects };
}

/** The press never lifted: hand it back (a tap, a scroll, a swipe, a pinch). */
function abandonPress(state: Extract<DragState, { phase: 'pressed' }>): DragStep {
  return { state: IDLE, effects: state.input === 'mouse' ? [] : [{ type: 'clear-timer' }] };
}

function startPress(event: Extract<DragEvent, { type: 'down' }>): DragStep {
  const { input, pointerId, x, y } = event;
  const { gesture, grab } = event.press!;
  return {
    state: { phase: 'pressed', input, pointerId, x, y, gesture, grab },
    effects: input === 'mouse' ? [] : [{ type: 'start-timer', ms: DRAG.longPressMs }],
  };
}

/**
 * A pointer pressed. Single flight first: nothing happens while `committing`. Otherwise the
 * gesture under way (if any) ends, and the down may start a fresh press:
 *
 * | under way              | this down                  | ends as                 | fresh press |
 * | ---------------------- | -------------------------- | ----------------------- | ----------- |
 * | nothing                | primary                    |                         | yes         |
 * | a press                | the same pointer (up lost) | abandoned               | yes         |
 * | a press                | another pointer            | abandoned (a pinch)     | no          |
 * | a pointer lift         | the same pointer, primary  | cancel `lost-up`        | yes         |
 * | a pointer lift         | another pointer, primary   | cancel `second-pointer` | no          |
 * | a keyboard lift        | any pointer, primary       | cancel `pointer-down`   | yes         |
 * | a lift (either)        | a non-primary button       | cancel `button`         | no          |
 *
 * A non-primary button never presses. A fresh press also needs `event.press` (the binding
 * names it only for a draggable the person may move). Whether the cancelled gesture's click
 * is swallowed is `cancelLifted`'s rule: a cancel that hands its down to a fresh press never
 * swallows, so that press's own tap keeps its click.
 */
function onDown(state: DragState, event: Extract<DragEvent, { type: 'down' }>): DragStep {
  if (state.phase === 'committing') return same(state);
  const primary = event.button === 0;
  let ended: DragStep = { state: IDLE, effects: [] };
  let pressAgain = true;
  if (state.phase === 'pressed') {
    ended = abandonPress(state);
    pressAgain = event.pointerId === state.pointerId;
  } else if (state.phase === 'lifted') {
    const reason: CancelReason = !primary
      ? 'button'
      : state.pointerId === undefined
        ? 'pointer-down'
        : event.pointerId === state.pointerId
          ? 'lost-up'
          : 'second-pointer';
    ended = cancelLifted(state, reason);
    pressAgain = reason === 'lost-up' || reason === 'pointer-down';
  }
  if (!primary || !pressAgain || !event.press) return ended;
  const started = startPress(event);
  return { state: started.state, effects: [...ended.effects, ...started.effects] };
}

function liftFromPress(
  state: Extract<DragState, { phase: 'pressed' }>,
  target: DropTarget | null
): DragStep {
  const effects: DragEffect[] = [];
  if (state.input !== 'mouse') effects.push({ type: 'clear-timer' }, { type: 'haptic' });
  effects.push(
    { type: 'lift', input: state.input, gesture: state.gesture, grab: state.grab },
    { type: 'announce', kind: 'lifted' }
  );
  return {
    state: {
      phase: 'lifted',
      input: state.input,
      pointerId: state.pointerId,
      gesture: state.gesture,
      grab: state.grab,
      target,
    },
    effects,
  };
}

function drop(state: Extract<DragState, { phase: 'lifted' }>): DragStep {
  if (!state.target) return cancelLifted(state, 'no-target');
  return {
    state: { phase: 'committing' },
    effects: [
      {
        type: 'drop',
        input: state.input,
        gesture: state.gesture,
        grab: state.grab,
        target: state.target,
      },
    ],
  };
}

function onKey(state: DragState, event: Extract<DragEvent, { type: 'key' }>): DragStep {
  const { key, shift } = event;
  if (state.phase === 'idle') {
    if (key !== ' ' || !event.lift) return same(state);
    const { view, gesture, origin, endOrigin } = event.lift;
    return {
      state: {
        phase: 'lifted',
        input: 'keyboard',
        view,
        gesture,
        grab: origin,
        target: origin,
        ...(endOrigin ? { endGrab: endOrigin } : {}),
      },
      effects: [
        { type: 'lift', input: 'keyboard', gesture, grab: origin },
        { type: 'announce', kind: 'lifted', target: origin },
      ],
    };
  }
  if (state.phase === 'pressed') {
    return key === 'Escape' ? abandonPress(state) : same(state);
  }
  if (state.phase !== 'lifted') return same(state);

  if (key === 'Escape') return cancelLifted(state, 'escape');
  if (state.input !== 'keyboard' || !state.view) return same(state); // keys steer only a keyboard lift
  if (key === 'Enter') return drop(state);
  if (!ARROWS.has(key) || !state.target) return same(state);

  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  let next: Extract<DragState, { phase: 'lifted' }> = state;
  if (shift && vertical) {
    // Shift+↑/↓ resizes the END on a timeline. The first press turns an unmoved move into a
    // resize from the block's end; once moved, a resize would discard the move, so ignore it.
    if (state.gesture === 'move') {
      if (!state.endGrab || !targetsEqual(state.target, state.grab)) return same(state);
      next = { ...state, gesture: 'resize-end', grab: state.endGrab, target: state.endGrab };
    }
  } else if (state.gesture === 'resize-end') {
    return same(state); // a resize only grows or shrinks; plain arrows would move the end's day
  }
  const target = stepTarget(state.view, next.target!, key, shift, event.steps);
  if (targetsEqual(target, next.target) && next === state) return same(state);
  return {
    state: { ...next, target },
    effects: [{ type: 'announce', kind: 'over', target }],
  };
}

/** Advance the gesture by one event. Total: an event a phase does not expect is ignored. */
export function reduce(state: DragState, event: DragEvent): DragStep {
  switch (event.type) {
    case 'down':
      return onDown(state, event);
    case 'move': {
      if (state.phase === 'pressed' && event.pointerId === state.pointerId) {
        const distance = Math.hypot(event.x - state.x, event.y - state.y);
        if (state.input === 'mouse') {
          return distance >= DRAG.mouseSlopPx
            ? liftFromPress(state, event.target !== undefined ? event.target : state.grab)
            : same(state);
        }
        // Touch/pen moved before the hold finished: it is a scroll or a swipe.
        return distance > DRAG.touchSlopPx ? abandonPress(state) : same(state);
      }
      if (state.phase === 'lifted' && event.pointerId === state.pointerId) {
        if (event.target === undefined || targetsEqual(event.target, state.target)) {
          return same(state);
        }
        return { state: { ...state, target: event.target }, effects: [] };
      }
      return same(state);
    }
    case 'timer': {
      if (state.phase === 'pressed' && state.input !== 'mouse') {
        return liftFromPress(state, state.grab);
      }
      return same(state);
    }
    case 'up': {
      if (state.phase === 'pressed' && event.pointerId === state.pointerId) {
        return abandonPress(state); // a plain tap: the click goes through as today
      }
      if (state.phase === 'lifted' && event.pointerId === state.pointerId) return drop(state);
      return same(state);
    }
    case 'cancel': {
      if (state.phase === 'pressed') return abandonPress(state);
      if (state.phase === 'lifted') return cancelLifted(state, event.reason);
      return same(state); // a commit in flight is not interrupted
    }
    case 'key':
      return onKey(state, event);
    case 'settled':
      return state.phase === 'committing' ? { state: IDLE, effects: [] } : same(state);
  }
}

function clampDate(date: string, dates: readonly string[] | undefined): string {
  if (!dates?.length) return date;
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  return date < first ? first : date > last ? last : date;
}

/**
 * One keyboard step (Requirement 10):
 * - month: ←/→ a day, ↑/↓ a week;
 * - week timeline: ↑/↓ 15 minutes, ←/→ a day (inside `steps.dates` when given);
 *   a week DAY target (all-day row, strip pill) steps ←/→ a day, ↑/↓ nothing;
 * - day timeline: ↑/↓ 15 minutes, ←/→ a member column (inside `steps.memberIds`);
 * - Shift+↑/↓ on a timeline steps the same 15 minutes (the gesture says it is the end).
 * Minutes clamp to [00:00, 23:45]. A key that does not apply returns the target unchanged.
 */
export function stepTarget(
  dragView: DragView,
  target: DropTarget,
  key: string,
  shift: boolean,
  steps?: StepContext
): DropTarget {
  const dir = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  if (!vertical && !horizontal) return target;

  if (target.kind === 'day') {
    if (dragView === 'month') {
      return { ...target, date: addDaysYmd(target.date, dir * (vertical ? 7 : 1)) };
    }
    if (!horizontal || shift) return target;
    return { ...target, date: clampDate(addDaysYmd(target.date, dir), steps?.dates) };
  }

  if (vertical) {
    return { ...target, minutes: clampMinutes(target.minutes + dir * DRAG.snapMinutes) };
  }
  if (shift) return target;
  if (dragView === 'day') {
    const ids = steps?.memberIds;
    if (!ids?.length || target.memberId === undefined) return target;
    const at = ids.indexOf(target.memberId);
    const nextId = ids[Math.max(0, Math.min(ids.length - 1, (at < 0 ? 0 : at) + dir))]!;
    return { ...target, memberId: nextId };
  }
  return { ...target, date: clampDate(addDaysYmd(target.date, dir), steps?.dates) };
}
