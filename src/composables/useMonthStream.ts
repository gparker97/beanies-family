import { ref, onScopeDispose, nextTick, type Ref } from 'vue';
import { getAppScroller } from '@/utils/getAppScroller';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import { record as recordPerf } from '@/utils/perfTiming';

/**
 * The mobile month view's continuous stream: a bounded, sliding window of
 * months rendered as one scroll, plus the "which month am I looking at" probe
 * that keeps the command-bar label honest.
 *
 * Design notes worth keeping:
 *
 *  - **One mechanism, not two.** A single rAF-throttled scroll listener does the
 *    month-in-view probe AND the window extend/prune. An IntersectionObserver
 *    layer on top would be a second source of truth for the same question.
 *
 *  - **Compensate for ANY mutation above the viewport.** Prepending a month and
 *    pruning the top month both change the height above the scroll position; if
 *    `scrollTop` isn't adjusted by the same delta in the same frame, the content
 *    visibly jumps under the user's finger. (The approved mockup demonstrates
 *    only the prepend half — the prune half is just as load-bearing once the
 *    window is full.)
 *
 *  - **Single write-path.** Scroll position is written HERE and by
 *    `anchorToDate` in the stream component — nowhere else. A stray
 *    `watch(referenceDate, …)` that rebuilt the window would reintroduce the
 *    label→scroll→label feedback loop the re-anchor rule exists to prevent.
 */

export interface MonthKey {
  y: number;
  /** 0-indexed, matching `Date.getMonth()`. */
  m: number;
}

/** How many months may stay in the DOM before the far end is pruned. */
export const MAX_WINDOW_MONTHS = 5;
/** Distance from the stream's end at which the next month is appended. */
export const EXTEND_AHEAD_PX = 600;
/** Distance from the stream's start at which the previous month is prepended. */
export const EXTEND_BEHIND_PX = 400;

// ── Pure month arithmetic (exported for unit tests) ────────────────────────

export function monthKeyOf(date: Date): MonthKey {
  return { y: date.getFullYear(), m: date.getMonth() };
}

/** Step a month key by `delta` months, normalising the year rollover. */
export function stepMonthKey(key: MonthKey, delta: number): MonthKey {
  const d = new Date(key.y, key.m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

export function sameMonth(a: MonthKey, b: MonthKey): boolean {
  return a.y === b.y && a.m === b.m;
}

export function monthKeyId(key: MonthKey): string {
  return `${key.y}-${key.m}`;
}

/** The initial window: one month either side of the anchor. */
export function windowAround(anchor: MonthKey): MonthKey[] {
  return [stepMonthKey(anchor, -1), anchor, stepMonthKey(anchor, 1)];
}

export function windowContains(months: MonthKey[], key: MonthKey): boolean {
  return months.some((m) => sameMonth(m, key));
}

/**
 * Which month owns the probe line (the viewport's upper third)? Returns the
 * LAST month whose header sits at or above the line — i.e. the month whose days
 * currently fill the top of the screen.
 *
 * Pure: takes measured offsets so it unit-tests without a DOM.
 */
export function monthInViewFrom(
  monthOffsets: Array<{ key: MonthKey; offsetTop: number }>,
  probeLine: number
): MonthKey | null {
  let current: MonthKey | null = null;
  for (const entry of monthOffsets) {
    if (entry.offsetTop <= probeLine) current = entry.key;
    else break;
  }
  return current ?? monthOffsets[0]?.key ?? null;
}

// ── The composable ─────────────────────────────────────────────────────────

export interface UseMonthStreamOptions {
  /** The stream's root element — used to resolve the app scroller + measure. */
  root: Ref<HTMLElement | null>;
  /** Fired when the month occupying the top of the viewport changes. */
  onMonthInView: (key: MonthKey) => void;
}

export interface UseMonthStreamApi {
  months: Ref<MonthKey[]>;
  /** The month currently filling the top of the viewport (drives the re-anchor rule). */
  monthInView: Ref<MonthKey>;
  /** Replace the window with one centred on `key` (used when anchoring out of range). */
  resetWindow: (key: MonthKey) => void;
  /** Force a probe/extend cycle (e.g. after an imperative scroll). */
  syncNow: () => void;
}

export function useMonthStream(
  anchor: MonthKey,
  options: UseMonthStreamOptions
): UseMonthStreamApi {
  const months = ref<MonthKey[]>(windowAround(anchor));
  const monthInView = ref<MonthKey>(anchor);
  let lastReported = monthKeyId(anchor);
  let frame: number | null = null;
  let scroller: HTMLElement | null = null;
  let detach: (() => void) | null = null;

  function resetWindow(key: MonthKey): void {
    months.value = windowAround(key);
    monthInView.value = key;
    lastReported = monthKeyId(key);
  }

  /** Measured offsets of each rendered month header, relative to the scroller. */
  function measureMonths(): Array<{ key: MonthKey; offsetTop: number }> {
    const root = options.root.value;
    if (!root || !scroller) return [];
    const scrollerTop = scroller.getBoundingClientRect().top;
    const out: Array<{ key: MonthKey; offsetTop: number }> = [];
    for (const el of root.querySelectorAll<HTMLElement>('[data-month-key]')) {
      const key = el.dataset.monthKey;
      if (!key) continue;
      const [y, m] = key.split('-').map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
      out.push({
        key: { y: y as number, m: m as number },
        offsetTop: el.getBoundingClientRect().top - scrollerTop + scroller.scrollTop,
      });
    }
    return out;
  }

  /**
   * Mutate the window above the viewport and keep the visual position fixed.
   * Measures the scroll height on both sides of the DOM update and applies the
   * delta to `scrollTop` — the difference between "seamless" and "the calendar
   * jumped".
   */
  async function mutateAbove(mutate: () => void): Promise<void> {
    if (!scroller) {
      mutate();
      return;
    }
    const before = scroller.scrollHeight;
    const prevTop = scroller.scrollTop;
    mutate();
    await nextTick();
    const delta = scroller.scrollHeight - before;
    if (delta !== 0) scroller.scrollTop = prevTop + delta;
  }

  function extendAndPrune(): void {
    if (!scroller) return;
    const started = performance.now();
    const { scrollTop, scrollHeight, clientHeight } = scroller;

    // Append ahead, pruning the far (top) end — a top prune removes height
    // ABOVE the viewport, so it compensates exactly like a prepend.
    if (scrollTop + clientHeight > scrollHeight - EXTEND_AHEAD_PX) {
      const last = months.value[months.value.length - 1];
      if (last) {
        const next = stepMonthKey(last, 1);
        if (months.value.length >= MAX_WINDOW_MONTHS) {
          void mutateAbove(() => {
            months.value = [...months.value.slice(1), next];
          });
        } else {
          months.value = [...months.value, next];
        }
        logEvent({
          surface: 'calendar-nav',
          level: 'debug',
          message: 'month stream extended',
          context: { action: 'stream-extend', detail: 'append' },
        });
        recordPerf('calendar.streamExtend', performance.now() - started);
        return;
      }
    }

    // Prepend behind, pruning the far (bottom) end — a bottom prune is below
    // the viewport and needs no compensation, but the prepend itself does.
    if (scrollTop < EXTEND_BEHIND_PX) {
      const first = months.value[0];
      if (first) {
        const prev = stepMonthKey(first, -1);
        void mutateAbove(() => {
          months.value =
            months.value.length >= MAX_WINDOW_MONTHS
              ? [prev, ...months.value.slice(0, -1)]
              : [prev, ...months.value];
        });
        logEvent({
          surface: 'calendar-nav',
          level: 'debug',
          message: 'month stream extended',
          context: { action: 'stream-extend', detail: 'prepend' },
        });
        recordPerf('calendar.streamExtend', performance.now() - started);
      }
    }
  }

  function probeMonthInView(): void {
    if (!scroller) return;
    // Upper-third probe line: the month filling the top of the screen is the
    // one the user reads as "current", which is what the label should say.
    const probeLine = scroller.scrollTop + scroller.clientHeight / 3;
    const key = monthInViewFrom(measureMonths(), probeLine);
    if (!key) return;
    const id = monthKeyId(key);
    if (id === lastReported) return;
    lastReported = id;
    monthInView.value = key;
    options.onMonthInView(key);
  }

  function onScroll(): void {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      try {
        probeMonthInView();
        extendAndPrune();
      } catch (err) {
        // Never let a measurement failure wedge scrolling — report and carry on.
        reportError({
          surface: 'calendar-nav',
          message:
            '[monthStream] scroll sync failed — the month label may lag until the next scroll',
          error: err,
          severity: 'warning',
          context: { action: 'stream-sync-failed' },
        });
      }
    });
  }

  function attach(): void {
    scroller = getAppScroller(options.root.value);
    if (!scroller) return;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    detach = () => scroller?.removeEventListener('scroll', onScroll);
  }

  // The scroller OUTLIVES this component (route change, view switch, breakpoint
  // flip), so a leaked listener would keep emitting month-in-view from a dead
  // component. Teardown removes it and cancels any queued frame.
  onScopeDispose(() => {
    detach?.();
    detach = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    scroller = null;
  });

  void nextTick().then(attach);

  return {
    months,
    monthInView,
    resetWindow,
    syncNow: () => {
      if (!scroller) attach();
      onScroll();
    },
  };
}
