/**
 * Desktop wheel/trackpad month paging with a rubber-band "resistance then
 * turn" feel (approved mockup variant B1 —
 * `docs/mockups/calendar-continuous-months-2026-08-29.html`).
 *
 * The contract is deliberately view-agnostic: an element, its edge, and two
 * callbacks. Nothing here knows about the planner, the month grid, or the
 * reference date — the caller supplies `onNext` / `onPrev` and gates
 * `enabled` (the planner gates on `!isMobile`).
 *
 * Behaviour:
 *
 *  - **Listener placement**: `wheel` is bound to the TARGET element, not
 *    window/document, so wheel events over any other page region are
 *    structurally incapable of paging the month.
 *
 *  - **Consume condition** (both terms required): a wheel-DOWN is consumed
 *    only when the target's bottom edge is visible inside the app scroller
 *    AND the scroller is at its downward scroll limit. Mirrored for
 *    wheel-UP. Without the at-limit term, every wheel-down over the grid
 *    would page the month the moment its bottom edge scrolled into view,
 *    making the content below it unreachable. When either term fails the
 *    event is left completely untouched — no `preventDefault`, no
 *    accumulation — so ordinary scrolling proceeds.
 *
 *  - **Delta normalization**: `deltaY` is only in pixels when
 *    `deltaMode === DOM_DELTA_PIXEL`. Firefox on Windows/Linux reports
 *    `DOM_DELTA_LINE` with ~±3 per notch; accumulating that raw would make
 *    the 140px threshold unreachable while `preventDefault` still fired —
 *    a silent dead zone that eats the wheel and does nothing. Line and page
 *    modes are converted to pixels before accumulating.
 *
 *  - **Resistance**: while consuming, normalized delta accumulates and the
 *    target is translated `translateY(-clamp(acc / 8, ±24px))`. An idle
 *    timeout (260ms) springs the transform back and resets the accumulator,
 *    so a half-hearted nudge never leaves the grid displaced.
 *
 *  - **Commit** at |acc| ≥ 140: a vertical two-phase slide mirroring
 *    {@link useCalendarSlide}'s pattern — phase out (220ms) in the scroll
 *    direction while fading, then `onNext`/`onPrev` (Vue re-renders), snap
 *    to the opposite offset, phase in (320ms) back to centre. A 420ms
 *    cooldown follows during which further wheels **in the committing
 *    direction** are consumed and discarded — that swallows the trackpad
 *    momentum tail so one flick is exactly one month. Wheels in the OPPOSITE
 *    direction are left alone, so reversing to reach content above the grid
 *    never feels frozen.
 *
 *  - **Reduced motion**: no stretch, no slide. The commit still requires the
 *    same 140px of accumulation, it just swaps instantly.
 *
 *  - **Overlay guard**: inert while any modal/drawer is open
 *    (`hasOpenOverlays()`). Belt-and-braces — a listener on the grid element
 *    is already inert under a covering overlay — but it names the real
 *    ref-counted signal rather than inventing a parallel one.
 *
 *  - **ctrl+wheel / pinch**: browsers deliver trackpad pinch-zoom as a
 *    cancelable `wheel` with `ctrlKey` set. Consuming it would suppress
 *    browser zoom — an accessibility regression — so those events are never
 *    touched.
 *
 *  - **Liveness**: every commit runs under a generation token. Teardown, a
 *    superseding commit, or a cancelled animation invalidates it, and the
 *    run bails BEFORE calling `onNext`/`onPrev` — a disposed scope must
 *    never emit a navigation intent (e.g. switching to Week view mid-slide
 *    used to land the user a month ahead).
 *
 *  - **`isPaging`**: true from commit start until the slide and cooldown are
 *    both finished. The caller gates its horizontal swipe on `!isPaging` so
 *    a drag cannot emit a second `next` during the vertical slide, and so
 *    the two composables never fight over `style.transform`.
 *
 *  - **Teardown**: `onScopeDispose` removes the listener, clears every
 *    timer, cancels any in-flight animation and resets the transform.
 */
import { getCurrentInstance, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue';
import { getAppScroller } from '@/utils/getAppScroller';
import { hasOpenOverlays } from '@/utils/overlayStack';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';

export interface UseWheelMonthPagingOptions {
  /** Wheeling down past the bottom edge → advance a month. */
  onNext: () => void;
  /** Wheeling up past the top edge → go back a month. */
  onPrev: () => void;
  /** Reactive gate — the caller passes `!isMobile`. Default: always on. */
  enabled?: Ref<boolean>;
}

export interface UseWheelMonthPagingReturn {
  /**
   * True while a commit owns the element: from the moment the threshold is
   * crossed until the slide has finished AND the momentum cooldown expired.
   * Gate any other transform-owning gesture (the horizontal swipe) on this.
   */
  isPaging: Ref<boolean>;
}

/** iOS system page-transition easing, shared with `useCalendarSlide`. */
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const PHASE_OUT_MS = 220;
const PHASE_IN_MS = 320;
/** Momentum-tail swallow window after a commit. */
const COOLDOWN_MS = 420;
/** No wheel for this long → spring back and forget the accumulation. */
const IDLE_RESET_MS = 260;
/** Accumulated |deltaY| (in CSS pixels) that turns the month. */
const COMMIT_THRESHOLD_PX = 140;
/** Rubber-band damping: pixels of stretch per pixel of wheel delta. */
const STRETCH_DIVISOR = 8;
/** Hard cap on the rubber-band displacement. */
const MAX_STRETCH_PX = 24;
/** Vertical travel of the commit slide. */
const SLIDE_PX = 40;
/** Slop for "at the scroll limit" / "edge is visible" comparisons. */
const EPSILON_PX = 2;
/** `DOM_DELTA_LINE` → pixels. Matches the browsers' own ~1 line ≈ 16px. */
const LINE_HEIGHT_PX = 16;
/** `DOM_DELTA_PAGE` fallback when the scroller has no measurable height. */
const FALLBACK_PAGE_PX = 800;
/** Ceiling on the wait for the between-phase frame (hidden tabs never rAF). */
const FRAME_TIMEOUT_MS = 100;

const SURFACE = 'calendar-nav';

export function useWheelMonthPaging(
  target: Ref<HTMLElement | null>,
  options: UseWheelMonthPagingOptions
): UseWheelMonthPagingReturn {
  const { prefersReducedMotion } = useReducedMotion();

  /** Public: a commit owns the element (slide in flight or cooling down). */
  const isPaging = ref(false);

  /** Element the listener is currently bound to (null = detached). */
  let bound: HTMLElement | null = null;
  let acc = 0;
  /** True from commit start until the cooldown expires. */
  let cooling = false;
  /** Direction of the commit whose momentum tail we are swallowing. */
  let coolingDir: 1 | -1 | null = null;
  /** True while the two-phase slide is in flight. */
  let animating = false;
  /** Invalidation token — bumped by every commit and by teardown. */
  let generation = 0;
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAnimation: Animation | null = null;

  function syncPaging(): void {
    isPaging.value = cooling || animating;
  }

  function clearIdleTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearCooldownTimer(): void {
    if (cooldownTimer !== null) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  }

  function clearFrameTimer(): void {
    if (frameTimer !== null) {
      clearTimeout(frameTimer);
      frameTimer = null;
    }
  }

  function cancelAnimation(): void {
    if (!activeAnimation) return;
    try {
      activeAnimation.cancel();
    } catch {
      // Already finished or disposed — nothing to unwind.
    }
    activeAnimation = null;
  }

  function resetTransform(el: HTMLElement | null): void {
    if (!el) return;
    el.style.transform = '';
    el.style.opacity = '';
  }

  function canAnimate(el: HTMLElement): boolean {
    return typeof el.animate === 'function' && !prefersReducedMotion.value;
  }

  /** A commit run is live only while it owns the newest generation. */
  function isLive(gen: number): boolean {
    return !disposed && gen === generation;
  }

  /**
   * Wheel deltas are only pixels in `DOM_DELTA_PIXEL` (0). Firefox on
   * Windows/Linux uses `DOM_DELTA_LINE` (1) with ~±3 per notch, and some
   * configurations use `DOM_DELTA_PAGE` (2).
   */
  function normalizeDelta(event: WheelEvent, scroller: HTMLElement): number {
    if (event.deltaMode === 1) return event.deltaY * LINE_HEIGHT_PX;
    if (event.deltaMode === 2) return event.deltaY * (scroller.clientHeight || FALLBACK_PAGE_PX);
    return event.deltaY;
  }

  /**
   * Both halves of the Pass-4 consume rule, against an already-resolved
   * scroller.
   */
  function canConsume(el: HTMLElement, scroller: HTMLElement, dir: 1 | -1): boolean {
    const scrollerRect = scroller.getBoundingClientRect();
    const rect = el.getBoundingClientRect();

    if (dir === 1) {
      const atScrollLimit =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EPSILON_PX;
      const edgeVisible = rect.bottom <= scrollerRect.bottom + EPSILON_PX;
      return atScrollLimit && edgeVisible;
    }

    const atScrollTop = scroller.scrollTop <= EPSILON_PX;
    const edgeVisible = rect.top >= scrollerRect.top - EPSILON_PX;
    return atScrollTop && edgeVisible;
  }

  function applyStretch(el: HTMLElement): void {
    const raw = acc / STRETCH_DIVISOR;
    const stretch = Math.max(-MAX_STRETCH_PX, Math.min(MAX_STRETCH_PX, raw));
    el.style.transform = `translateY(${-stretch}px)`;
  }

  function scheduleIdleReset(el: HTMLElement): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      acc = 0;
      if (!cooling && !animating) resetTransform(el);
    }, IDLE_RESET_MS);
  }

  function startCooldown(el: HTMLElement | null, dir: 1 | -1 | null): void {
    cooling = true;
    coolingDir = dir;
    syncPaging();
    clearCooldownTimer();
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      cooling = false;
      coolingDir = null;
      acc = 0;
      if (!animating) resetTransform(el);
      syncPaging();
    }, COOLDOWN_MS);
  }

  /** Self-heal: whatever went wrong, drop back to a known-good resting state. */
  function recover(el: HTMLElement | null, error: unknown, detail: string): void {
    reportError({
      surface: SURFACE,
      message: 'Wheel month paging failed — resetting to a resting state',
      severity: 'warning',
      error,
      context: { action: 'wheel-page-error', detail },
    });
    cancelAnimation();
    clearFrameTimer();
    animating = false;
    acc = 0;
    resetTransform(el);
    startCooldown(el, coolingDir);
  }

  /**
   * Resolves on the next animation frame, or after `FRAME_TIMEOUT_MS` —
   * a backgrounded tab never fires rAF, and an un-resolvable await would
   * strand the grid at `opacity: 0` with `animating` stuck true.
   */
  function nextFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearFrameTimer();
        resolve();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
      clearFrameTimer();
      frameTimer = setTimeout(finish, FRAME_TIMEOUT_MS);
    });
  }

  async function runAnimation(
    el: HTMLElement,
    gen: number,
    from: { transform: string; opacity: string },
    to: { transform: string; opacity: string },
    duration: number
  ): Promise<boolean> {
    const animation = el.animate([from, to], { duration, easing: EASING, fill: 'forwards' });
    activeAnimation = animation;
    try {
      await animation.finished;
    } catch {
      // Cancelled on dispose or superseded — both are expected outcomes.
    }
    if (activeAnimation === animation) activeAnimation = null;
    // A cancelled or superseded run must not touch the element any more:
    // the scope may be gone, or a newer commit may already own the styles.
    if (!isLive(gen)) return false;
    // Commit the end state to inline style so a forwards-filled WAAPI can't
    // shadow the next transform we set.
    el.style.transform = to.transform;
    el.style.opacity = to.opacity;
    try {
      animation.cancel();
    } catch {
      // Already disposed.
    }
    return true;
  }

  function fire(dir: 1 | -1): void {
    if (dir === 1) options.onNext();
    else options.onPrev();
  }

  async function commit(el: HTMLElement, dir: 1 | -1): Promise<void> {
    const gen = ++generation;
    clearIdleTimer();
    acc = 0;
    startCooldown(el, dir);

    logEvent({
      surface: SURFACE,
      level: 'info',
      message: 'wheel month paging commit',
      context: { action: 'wheel-page-commit', detail: dir === 1 ? 'next' : 'prev' },
    });

    if (!canAnimate(el)) {
      // Reduced motion (or an environment without WAAPI): instant swap, same
      // accumulation requirement, no visual displacement left behind.
      try {
        resetTransform(el);
        fire(dir);
      } catch (error) {
        recover(el, error, 'reduced-commit');
      }
      return;
    }

    animating = true;
    syncPaging();
    try {
      // Phase A — continue off in the direction of travel while fading out.
      const outDone = await runAnimation(
        el,
        gen,
        { transform: el.style.transform || 'translateY(0px)', opacity: '1' },
        { transform: `translateY(${-dir * SLIDE_PX}px)`, opacity: '0' },
        PHASE_OUT_MS
      );
      if (!outDone) return;

      // Swap content while the grid is invisible — the user perceives one
      // continuous slide. Guarded above: a disposed scope never gets here.
      fire(dir);

      // Snap to the opposite offset so the new month enters from the side the
      // old one left towards.
      el.style.transform = `translateY(${dir * SLIDE_PX}px)`;
      el.style.opacity = '0';

      // One frame for Vue's re-render to land before the inbound animation.
      await nextFrame();
      if (!isLive(gen)) return;

      // Phase B — glide back to centre.
      await runAnimation(
        el,
        gen,
        { transform: `translateY(${dir * SLIDE_PX}px)`, opacity: '0' },
        { transform: 'translateY(0px)', opacity: '1' },
        PHASE_IN_MS
      );
    } catch (error) {
      if (isLive(gen)) recover(el, error, 'slide');
    } finally {
      // Only the owning generation resets shared state — a superseding commit
      // or a teardown has already taken care of its own.
      if (gen === generation) {
        animating = false;
        clearFrameTimer();
        if (!disposed) resetTransform(el);
        syncPaging();
      }
    }
  }

  function onWheel(event: WheelEvent): void {
    const el = target.value;
    if (!el) return;
    if (options.enabled && !options.enabled.value) return;
    // Pinch-zoom / ctrl+wheel is browser zoom — never suppress it.
    if (event.ctrlKey) return;
    if (hasOpenOverlays()) return;

    const dir = Math.sign(event.deltaY);
    if (dir !== 1 && dir !== -1) return;

    // Momentum tail / in-flight slide. Only the committing direction is
    // swallowed: reversing must stay free so content above the grid is
    // reachable immediately after a page turn.
    if (cooling || animating) {
      if (dir === coolingDir) event.preventDefault();
      return;
    }

    let scroller: HTMLElement | null;
    let consumable: boolean;
    try {
      scroller = getAppScroller(el);
      consumable = scroller ? canConsume(el, scroller, dir) : false;
    } catch (error) {
      recover(el, error, 'consume-check');
      return;
    }
    if (!scroller || !consumable) {
      // Not at the edge — leave the event completely alone so the page (and
      // anything below the grid) keeps scrolling normally.
      return;
    }

    event.preventDefault();
    acc += normalizeDelta(event, scroller);

    try {
      if (!prefersReducedMotion.value) applyStretch(el);

      if (Math.abs(acc) >= COMMIT_THRESHOLD_PX) {
        void commit(el, dir);
        return;
      }

      scheduleIdleReset(el);
    } catch (error) {
      recover(el, error, 'wheel');
    }
  }

  function attach(el: HTMLElement): void {
    if (bound === el) return;
    detach();
    el.addEventListener('wheel', onWheel, { passive: false });
    bound = el;
  }

  function detach(): void {
    if (!bound) return;
    bound.removeEventListener('wheel', onWheel);
    resetTransform(bound);
    bound = null;
  }

  function reset(): void {
    // Invalidate any commit in flight so it can never call onNext/onPrev or
    // re-apply styles after this point.
    generation++;
    clearIdleTimer();
    clearCooldownTimer();
    clearFrameTimer();
    cancelAnimation();
    acc = 0;
    cooling = false;
    coolingDir = null;
    animating = false;
    syncPaging();
  }

  function sync(): void {
    const el = target.value;
    const on = options.enabled ? options.enabled.value : true;
    if (el && on) {
      attach(el);
      return;
    }
    reset();
    detach();
  }

  // `onMounted` binds as soon as the template ref resolves (a post-flush watch
  // would not run until the next tick, leaving the first frame unbound); the
  // watch then tracks every later change to the element or the gate.
  if (getCurrentInstance()) onMounted(() => sync());
  watch(
    () => [target.value, options.enabled ? options.enabled.value : true] as const,
    () => sync(),
    { flush: 'post' }
  );

  onScopeDispose(() => {
    disposed = true;
    reset();
    detach();
  });

  return { isPaging };
}
