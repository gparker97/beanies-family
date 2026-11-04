/**
 * The measured size of one element, as reactive refs.
 *
 * Written for the beanie wall's time grid, which lays out to a HEIGHT: the
 * concertina axis divides the available pixels between the day's live minutes,
 * so it cannot draw anything until it knows how tall its plot actually is, and
 * flexbox only settles that after the first paint. Guessing left a hundred
 * pixels of white space under the last event of the day.
 *
 * ⚠️ It is deliberately NARROW — reactive `width`/`height` plus an imperative
 * `measure()`. No `onResize` callback, no CSS-variable publishing, no clamp or
 * threshold options. Growing this composable into a multi-mode API is exactly what
 * `WallBeanColumn`'s docblock warns against; consumers compose it instead.
 * `CalendarCommandBar`'s hand-rolled observer has migrated (follow-up F3 in
 * `docs/plans/2026-09-03-wall-time-grid.md`), through `usePublishedHeight` and with no
 * mode flag, and the month grid's viewport fit (`useMonthGridFit`) observes through it
 * too. `ExpandableText.vue` is the one remaining hand-rolled observer (it reads
 * `scrollHeight - clientHeight` imperatively). Please do not write another: extend
 * this one, or say why it does not fit.
 *
 * Everything that can fail, fails loudly and keeps working:
 *  - no `ResizeObserver` (an old iPad, a test DOM) → one `warn`, then measure on
 *    mount and on window resize, so the grid is stale-but-right rather than blank.
 *  - a throw inside the observer callback → caught. An uncaught throw out of a
 *    ResizeObserver callback kills the observer permanently and silently, which
 *    is the lesson `CalendarCommandBar` learned the hard way.
 *  - a layout read that throws (or, defensively, the callback around it) → the last
 *    size is kept, and one `element_size_measure_failed` warn per instance reaches
 *    the firehose on the caller's `surface`, like `element_size_unobservable`.
 */
import { onMounted, onScopeDispose, ref, watch, type Ref } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';

export interface ElementSize {
  width: Ref<number>;
  height: Ref<number>;
  /** Measure now. Idempotent, and safe to call before mount. */
  measure: () => void;
}

export function useElementSize(
  target: Readonly<Ref<HTMLElement | null>>,
  options: { surface?: string } = {}
): ElementSize {
  const surface = options.surface ?? 'element-size';
  const width = ref(0);
  const height = ref(0);

  let observer: ResizeObserver | null = null;
  let frame: number | null = null;
  let warned = false;
  let measureWarned = false;

  /** One console warn per failure, and one firehose event per instance. */
  function warnMeasureFailed(code: 'measure_threw' | 'callback_threw', err: unknown): void {
    console.warn(
      code === 'measure_threw'
        ? `[${surface}] element measurement threw; keeping the last size`
        : `[${surface}] resize callback threw; observer kept alive`,
      err
    );
    if (measureWarned) return;
    measureWarned = true;
    logEvent({
      level: 'warn',
      surface,
      message: 'element_size_measure_failed',
      context: { action: 'measure', error_code: code },
      error: err,
    });
  }

  function measure(): void {
    const el = target.value;
    if (!el) return;
    try {
      width.value = el.clientWidth;
      height.value = el.clientHeight;
    } catch (err) {
      // Reading layout can throw on a detached or cross-document node. Never let
      // it escape — see the observer note above.
      warnMeasureFailed('measure_threw', err);
    }
  }

  /** Coalesce a burst of resizes into one measure per frame. */
  function scheduleMeasure(): void {
    if (frame !== null) return;
    const raf =
      typeof window !== 'undefined' && window.requestAnimationFrame
        ? window.requestAnimationFrame.bind(window)
        : (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16);
    frame = raf(() => {
      frame = null;
      measure();
    }) as unknown as number;
  }

  function warnUnobservable(): void {
    if (warned) return;
    warned = true;
    logEvent({
      level: 'warn',
      surface,
      message: 'element_size_unobservable',
      context: { action: 'measure', error_code: 'no_resize_observer' },
    });
    console.warn(
      `[${surface}] ResizeObserver is unavailable — falling back to window resize. ` +
        `Sizes will be correct on mount and on resize, but not when a sibling reflows.`
    );
  }

  function attach(el: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') {
      warnUnobservable();
      window.addEventListener('resize', scheduleMeasure);
      measure();
      return;
    }
    // Measured synchronously here, NOT through `scheduleMeasure`. That coalescer
    // exists for the window-resize fallback, which can fire many times per frame;
    // ResizeObserver already delivers at most one callback per frame, so adding a
    // rAF hop would only defer the layout by a frame without removing any work.
    observer = new ResizeObserver(() => {
      try {
        measure();
      } catch (err) {
        warnMeasureFailed('callback_threw', err);
      }
    });
    observer.observe(el);
    measure();
  }

  function detach(): void {
    observer?.disconnect();
    observer = null;
    if (typeof window !== 'undefined') window.removeEventListener('resize', scheduleMeasure);
    if (frame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame?.(frame);
      frame = null;
    }
  }

  onMounted(() => {
    if (target.value) attach(target.value);
  });

  // The element can arrive after mount (a `v-if` branch, a lazily rendered view),
  // so follow the ref rather than assuming it is populated once.
  watch(target, (el, prev) => {
    if (el === prev) return;
    detach();
    if (el) attach(el);
  });

  onScopeDispose(detach);

  return { width, height, measure };
}
