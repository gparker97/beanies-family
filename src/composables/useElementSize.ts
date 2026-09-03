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
 * threshold options. Two hand-rolled `ResizeObserver`s already exist
 * (`ExpandableText.vue`, `CalendarCommandBar.vue`) and NEITHER consumes a size
 * value — one reads `scrollHeight - clientHeight` imperatively, the other pushes
 * `offsetHeight` into a custom property with bespoke unmount cleanup. Growing
 * this composable to serve all three would produce exactly the multi-mode API
 * `WallBeanColumn`'s docblock warns against. They migrate only if they can do so
 * WITHOUT adding a mode flag — follow-up F3 in
 * `docs/plans/2026-09-03-wall-time-grid.md`. Until then, please do not write a
 * fourth observer: extend this one, or say why it does not fit.
 *
 * Everything that can fail, fails loudly and keeps working:
 *  - no `ResizeObserver` (an old iPad, a test DOM) → one `warn`, then measure on
 *    mount and on window resize, so the grid is stale-but-right rather than blank.
 *  - a throw inside the observer callback → caught. An uncaught throw out of a
 *    ResizeObserver callback kills the observer permanently and silently, which
 *    is the lesson `CalendarCommandBar` learned the hard way.
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
  target: Ref<HTMLElement | null>,
  options: { surface?: string } = {}
): ElementSize {
  const surface = options.surface ?? 'element-size';
  const width = ref(0);
  const height = ref(0);

  let observer: ResizeObserver | null = null;
  let frame: number | null = null;
  let warned = false;

  function measure(): void {
    const el = target.value;
    if (!el) return;
    try {
      width.value = el.clientWidth;
      height.value = el.clientHeight;
    } catch (err) {
      // Reading layout can throw on a detached or cross-document node. Never let
      // it escape — see the observer note above.
      console.warn(`[${surface}] element measurement threw; keeping the last size`, err);
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
        console.warn(`[${surface}] resize callback threw; observer kept alive`, err);
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
