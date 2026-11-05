/**
 * Calendar drag and drop (#142): the binding. One per view root. It feeds DOM events to the
 * pure gesture machine (`dragGesture.ts`) and executes the machine's effects; a drop goes to
 * `runDrop` and on to the orchestrator (`useCalendarMove`). The rules (slop, long-press,
 * second finger, single flight, keyboard steps) live in the machine; the patch math in
 * `dragMath`; the DOM protocol in `dragDom`; the listeners, ghost, guards, edge dwell and
 * telemetry in `./drag/`.
 *
 * Swipe coexistence: every event the machine owns (`ownsPointer`: mouse from press, touch once
 * lifted) is stopped with `stopImmediatePropagation()` in the root's capture phase, so the
 * view's bubble-phase swipe never sees it; a touch press before lift is not stopped, so scroll
 * and swipe behave as today. At lift the root takes pointer capture. Views also gate their
 * swipe and wheel paging on `isLifted`.
 *
 * Views pass `view` (+ `onEdge`, `autoScroll`, `steps`, `portal`, `onLift`, `snap`), ring the
 * drop target named by `overTarget`, render `liveLabel` in a polite live region, and bind
 * `onKeydown` / `onKeyup` on the root (the binding binds them on the portal itself). Timelines pass `snap: timelineSlot`: the binding then
 * exposes the would-be slot as `overSlot` (the view draws it) and snaps the pointer ghost to
 * it with a time readout.
 *
 * Plan: `~/projects/beanies-ops/docs/plans/2026-11-05-calendar-drag-and-drop-142.md`.
 */
import { nextTick, onScopeDispose, readonly, ref, shallowRef, type Ref } from 'vue';
import {
  logCancel,
  logCaptureFailed,
  logIneligible,
  logLift,
  reportDragFault,
} from '@/composables/drag/dragTelemetry';
import { grabAt, keyboardOrigin, sourceOf, targetAt } from '@/composables/drag/hitTest';
import { runDrop } from '@/composables/drag/runDrop';
import { slotRectAt, type TimelineSlot } from '@/composables/drag/timelineSlot';
import { useDragGhost } from '@/composables/drag/useDragGhost';
import { useDragGuards } from '@/composables/drag/useDragGuards';
import { useDragListeners } from '@/composables/drag/useDragListeners';
import { useEdgeDwell, type EdgeDir } from '@/composables/drag/useEdgeDwell';
import { dropWhenLabel, logDrop, resolveDragSource } from '@/composables/useCalendarMove';
import { escapeLayerCount, useEscapeClose } from '@/composables/useEscapeClose';
import { usePermissions } from '@/composables/usePermissions';
import { useTranslation } from '@/composables/useTranslation';
import { readWriteGate } from '@/services/automerge/worker/writeGate';
import { activityHostOf, readDragSourceRef, type DragSourceRef } from '@/utils/calendar/dragDom';
import {
  IDLE,
  ownsPointer,
  reduce,
  type DragEffect,
  type DragEvent,
  type DragState,
  type PointerInput,
  type StepContext,
} from '@/utils/calendar/dragGesture';
import type { DragGesture, DragSource, DragView, DropTarget } from '@/utils/calendar/dragMath';
import { fillTemplate } from '@/utils/fillTemplate';
import { hapticTick } from '@/utils/haptics';

export interface CalendarDragOptions {
  view: DragView;
  /** Month/week paging when the lifted item dwells at the root's left/right edge. */
  onEdge?: (dir: EdgeDir) => void;
  /** Timelines: auto-scroll `<main>` near its top/bottom while lifted. */
  autoScroll?: boolean;
  /** Keyboard step bounds, read at each arrow: the week's visible dates, the day's member columns. */
  steps?: () => StepContext;
  /** A teleported part of the view that also holds drag sources (the desktop month popover). */
  portal?: Readonly<Ref<HTMLElement | null>>;
  /**
   * A pointer lift happened (the month grid closes its popover so the cells are visible). Not
   * called for a keyboard lift: closing would unmount the focused chip and strand focus on
   * `<body>`, where no arrow or Enter reaches the binding.
   */
  onLift?: () => void;
  /** Timelines (`timelineSlot`): the slot a drop on `target` would fill, for `overSlot` and the ghost. */
  snap?: (target: DropTarget, source: DragSource, gesture: DragGesture) => TimelineSlot | null;
}

export function useCalendarDrag(root: Ref<HTMLElement | null>, opts: CalendarDragOptions) {
  const { t } = useTranslation();
  const { canEditActivities } = usePermissions();
  const ghost = useDragGhost();
  const guards = useDragGuards();
  const { onEdge } = opts;
  const pager = onEdge
    ? useEdgeDwell(root, {
        axis: 'horizontal',
        onEdge: (dir) => {
          onEdge(dir);
          void nextTick(retarget);
        },
      })
    : null;
  const scroller = opts.autoScroll
    ? useEdgeDwell(root, { axis: 'vertical', onScroll: retarget })
    : null;

  const isLifted = ref(false);
  const liveLabel = ref('');
  const overTarget = shallowRef<DropTarget | null>(null);
  const overSlot = shallowRef<TimelineSlot | null>(null);
  let state: DragState = IDLE;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let press: {
    el: HTMLElement;
    ref: DragSourceRef;
    source: DragSource;
    grab: DropTarget | null;
  } | null = null;
  let point = { x: 0, y: 0 };
  let layersAtLift = 0;

  /** Who may lift (Requirement 11): the record checks live in `resolveDragSource`. */
  function resolvePress(el: HTMLElement, grab: DropTarget | null) {
    const ineligible = !canEditActivities.value
      ? 'no-permission'
      : readWriteGate()?.block
        ? 'read-only'
        : null;
    if (ineligible) {
      logIneligible(ineligible);
      return null;
    }
    const sourceRef = readDragSourceRef(el);
    const source = resolveDragSource(sourceRef, grab);
    return sourceRef && source ? { el, ref: sourceRef, source, grab } : null;
  }

  function dispatch(event: DragEvent): void {
    const step = reduce(state, event);
    const abandoned = state.phase === 'pressed' && step.state.phase === 'idle';
    state = step.state;
    if (abandoned) endGesture(false); // a tap, scroll or pinch: nothing was lifted
    for (const effect of step.effects) {
      // An effect dispatched again (a ghost failure cancels the lift it is part of): the
      // newer step's effects have run, and the rest of this one no longer applies.
      if (state !== step.state) break;
      run(effect);
    }
    if (state.phase === 'lifted') {
      overTarget.value = state.target;
      overSlot.value = slotFor(state);
    }
  }

  /** The `snap` slot for the lifted state. A keyboard Shift+arrow re-grabs at the block's end. */
  function slotFor(lifted: Extract<DragState, { phase: 'lifted' }>): TimelineSlot | null {
    if (!opts.snap || !press || !lifted.target) return null;
    const source =
      lifted.grab === press.grab ? press.source : resolveDragSource(press.ref, lifted.grab);
    return source ? opts.snap(lifted.target, source, lifted.gesture) : null;
  }

  function run(effect: DragEffect): void {
    if (effect.type === 'start-timer') {
      clearTimer();
      timer = setTimeout(() => dispatch({ type: 'timer' }), effect.ms);
    } else if (effect.type === 'clear-timer') clearTimer();
    else if (effect.type === 'haptic') hapticTick();
    else if (effect.type === 'lift') onLifted(effect);
    else if (effect.type === 'announce') announce(effect.kind, effect.target);
    else if (effect.type === 'release-capture') releaseCapture(effect.pointerId);
    else if (effect.type === 'cancel') {
      logCancel(opts.view, effect.reason);
      endGesture(effect.swallowClick);
    } else void commitDrop(effect);
  }

  function announce(kind: 'lifted' | 'over' | 'cancelled', target?: DropTarget): void {
    if (kind === 'lifted')
      liveLabel.value = fillTemplate(t('planner.drag.a11y.lifted'), {
        title: press?.source.activity.title ?? '',
      });
    else if (kind === 'over' && target)
      liveLabel.value = fillTemplate(t('planner.drag.a11y.over'), { when: dropWhenLabel(target) });
    else if (kind === 'cancelled') liveLabel.value = t('planner.drag.a11y.cancelled');
  }

  function onLifted(effect: Extract<DragEffect, { type: 'lift' }>): void {
    if (!press) return;
    const { activity } = press.source;
    // A resize handle lifts its block: the block is the placeholder and the ghost.
    const block =
      effect.gesture === 'resize-end' ? (activityHostOf(press.el) ?? press.el) : press.el;
    try {
      ghost.show(block, effect.input === 'keyboard' ? null : point);
    } catch (error) {
      reportDragFault(
        'Could not build the drag ghost',
        { action: 'lift', detail: 'ghost', activity_id: activity.id },
        error
      );
      // Never drag blind: with no ghost the person cannot see what they are moving.
      dispatch({ type: 'cancel', reason: 'ghost' });
      return;
    }
    if (state.phase === 'lifted' && state.pointerId !== undefined) {
      try {
        root.value?.setPointerCapture(state.pointerId);
      } catch (error) {
        logCaptureFailed('set-failed', error);
      }
    }
    isLifted.value = true;
    layersAtLift = escapeLayerCount();
    logLift(opts.view, activity, effect.input, effect.gesture);
    if (effect.input !== 'keyboard') opts.onLift?.();
  }

  async function commitDrop(drop: Extract<DragEffect, { type: 'drop' }>): Promise<void> {
    const held = press;
    endGesture(drop.input !== 'keyboard'); // the chip springs back now, even while a scope prompt is open
    const ctx = { view: opts.view, gesture: drop.gesture, input: drop.input };
    let source: DragSource | null = null;
    try {
      source = held && resolveDragSource(held.ref, drop.grab);
      if (source) liveLabel.value = await runDrop({ ...ctx, source, target: drop.target });
    } catch (error) {
      reportDragFault(
        'A calendar drop failed unexpectedly',
        { action: 'drop', stage: 'failed', activity_id: source?.activity.id },
        error
      );
      if (source) logDrop({ ...ctx, source }, 'failed');
    } finally {
      dispatch({ type: 'settled' });
    }
  }

  /** Visual and global teardown of a press or lift. Idempotent. */
  function endGesture(swallowClick: boolean): void {
    clearTimer();
    pager?.stop();
    scroller?.stop();
    ghost.hide();
    guards.disarm(swallowClick);
    isLifted.value = false;
    overTarget.value = null;
    overSlot.value = null;
    press = null;
  }

  /** Re-hit-test under a pointer that has not moved (after a page turn or an auto-scroll). */
  function retarget(): void {
    if (state.phase !== 'lifted' || state.pointerId === undefined) return;
    dispatch({
      type: 'move',
      pointerId: state.pointerId,
      ...point,
      t: performance.now(),
      target: targetAt(point.x, point.y),
    });
    placeGhost();
  }

  /** Under the pointer, or snapped to the timeline slot (`overSlot`) with its time readout. */
  function aboveFinger(): boolean {
    return opts.view !== 'month' && overTarget.value?.kind === 'day';
  }

  function placeGhost(): void {
    const slot = overSlot.value;
    const rect = slot && slotRectAt(point, slot);
    if (slot && rect) ghost.place(point, rect, slot.readout);
    // Over a day target on a timeline view (a strip pill, an all-day cell) the ghost would
    // cover the very thing it is about to drop on; float it above the finger instead.
    else ghost.place(point, undefined, undefined, aboveFinger());
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function releaseCapture(pointerId: number): void {
    try {
      if (root.value?.hasPointerCapture?.(pointerId)) root.value.releasePointerCapture(pointerId);
    } catch (error) {
      logCaptureFailed('release-failed', error);
    }
  }

  function onPointer(e: PointerEvent): void {
    // A down may begin a new gesture, so only the machine's answer AFTER it says whether it is
    // ours (a touch re-press must still reach the swipe). Any other event is ours if the
    // gesture owned it before (the up that drops leaves the machine owning nothing) or after.
    const owned = e.type !== 'pointerdown' && ownsPointer(state, e.pointerId);
    const { pointerId } = e;
    point = { x: e.clientX, y: e.clientY };
    if (e.type === 'pointerdown') onDown(e);
    else if (e.type === 'pointermove') {
      const hitTest =
        state.phase === 'lifted' || (state.phase === 'pressed' && state.input === 'mouse');
      dispatch({
        type: 'move',
        pointerId,
        ...point,
        t: e.timeStamp,
        ...(hitTest ? { target: targetAt(point.x, point.y) } : {}),
      });
      if (state.phase === 'lifted' && state.pointerId === pointerId) {
        if (escapeLayerCount() > layersAtLift + 1) dispatch({ type: 'cancel', reason: 'overlay' });
        else {
          placeGhost();
          pager?.track(point);
          scroller?.track(point);
        }
      }
    } else if (e.type === 'pointerup') dispatch({ type: 'up', pointerId });
    else if (
      (state.phase === 'pressed' || state.phase === 'lifted') &&
      state.pointerId === pointerId
    )
      dispatch({ type: 'cancel', reason: 'pointercancel' });
    if (owned || ownsPointer(state, pointerId)) e.stopImmediatePropagation();
  }

  /**
   * The machine decides what a down does (`dragGesture.onDown`): end the gesture under way,
   * start a fresh press, both, or neither. The binding names the press it would start (only a
   * primary press on a draggable the person may move, so a right-click never logs as
   * ineligible) and adopts it if the machine pressed.
   */
  function onDown(e: PointerEvent): void {
    const input: PointerInput =
      e.pointerType === 'mouse' || e.pointerType === 'pen' ? e.pointerType : 'touch';
    const el = e.button === 0 ? sourceOf(e.target) : null;
    const candidate = el && resolvePress(el, grabAt(point.x, point.y, el, opts.portal?.value));
    dispatch({
      type: 'down',
      input,
      pointerId: e.pointerId,
      button: e.button,
      ...point,
      t: e.timeStamp,
      press: candidate ? { gesture: candidate.ref.gesture, grab: candidate.grab } : null,
    });
    if (candidate && state.phase === 'pressed' && state.pointerId === e.pointerId) {
      press = candidate;
      guards.arm();
    }
  }

  /** Space lifts a focused chip; Enter drops; arrows step (Requirement 10). Escape: `useEscapeClose`. */
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === ' ' && state.phase === 'idle') {
      const el = sourceOf(e.target);
      if (!el) return;
      const { origin, endOrigin } = keyboardOrigin(el);
      press = resolvePress(el, origin);
      if (!press) return; // not ours to move: Space activates the chip as before
      e.preventDefault();
      dispatch({
        type: 'key',
        key: ' ',
        shift: false,
        lift: { view: opts.view, gesture: 'move', origin, endOrigin },
      });
    } else if (
      state.phase === 'lifted' &&
      (e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow'))
    ) {
      e.preventDefault();
      dispatch({ type: 'key', key: e.key, shift: e.shiftKey, steps: opts.steps?.() });
    }
  }

  /** A button activates on Space keyup: never while a keyboard lift is pending or active. */
  function onKeyup(e: KeyboardEvent): void {
    if (e.key === ' ' && state.phase !== 'idle') e.preventDefault();
  }

  const cancel = (reason: 'escape' | 'hidden' | 'dispose') => dispatch({ type: 'cancel', reason });
  useEscapeClose(isLifted, () => cancel('escape'));
  useDragListeners(root, opts.portal, {
    onPointer,
    onTouchMove: (e) => {
      if (state.phase === 'lifted') e.preventDefault();
    },
    onDragStart: (e) => {
      if (sourceOf(e.target)) e.preventDefault();
    },
    onHidden: () => cancel('hidden'),
    onKeydown,
    onKeyup,
  });
  onScopeDispose(() => {
    cancel('dispose');
    endGesture(false);
  });

  return {
    isLifted: readonly(isLifted),
    liveLabel: readonly(liveLabel),
    overTarget: readonly(overTarget),
    overSlot: readonly(overSlot),
    onKeydown,
    onKeyup,
  };
}
