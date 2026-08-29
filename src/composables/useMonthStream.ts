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
  /** True while a window mutation is in flight — a second pass mid-flight would
   *  measure a half-applied DOM and compensate against the wrong height. */
  let busy = false;
  /** Set at scope dispose so the deferred attach can never bind after teardown. */
  let disposed = false;
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
   * Apply a window change that alters content ABOVE the viewport, holding the
   * visual position fixed.
   *
   * Measured around ONE mutation at a time, deliberately. An earlier version
   * combined "prune the top month" and "append a bottom month" into a single
   * measured block, and compensated by the NET `scrollHeight` delta — which for
   * two months of similar height is ~0, so the guard skipped the write entirely
   * and the content leapt a whole month under the user's finger. Worse, the
   * extend condition still held afterwards (and a programmatic `scrollTop`
   * write fires another `scroll` event), so the stream ran away through months
   * until the finger stopped. Above-viewport and below-viewport mutations are
   * now applied separately, and only the former is compensated.
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

  /** Mutations below the viewport need no compensation — nothing shifts. */
  function mutateBelow(mutate: () => void): void {
    mutate();
  }

  /**
   * Grow (and bound) the window as the user approaches either end of the
   * STREAM — measured against the stream element's own edges, not the
   * scroller's extent.
   *
   * The distinction matters: the planner renders the Google-Calendar connect
   * nudge and the inactive-activities list BELOW the stream inside the same
   * scroller. Measuring the scroller's `scrollHeight` meant that content ate
   * the entire look-ahead budget, so October only appeared once the user had
   * scrolled past September's last day and into unrelated content — the
   * "stops dead at the month edge" behaviour this feature exists to remove,
   * reproducing only for users who HAVE content below the calendar.
   */
  async function extendAndPrune(): Promise<void> {
    const root = options.root.value;
    if (!scroller || !root || busy) return;
    const started = performance.now();
    const rootRect = root.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const distanceToEnd = rootRect.bottom - scrollerRect.bottom;
    const distanceToStart = scrollerRect.top - rootRect.top;

    if (distanceToEnd < EXTEND_AHEAD_PX) {
      const last = months.value[months.value.length - 1];
      if (!last) return;
      busy = true;
      try {
        const next = stepMonthKey(last, 1);
        // Append below the viewport first (no shift), THEN prune the top as its
        // own compensated step.
        mutateBelow(() => {
          months.value = [...months.value, next];
        });
        if (months.value.length > MAX_WINDOW_MONTHS) {
          await nextTick();
          await mutateAbove(() => {
            months.value = months.value.slice(1);
          });
        }
        emitExtended('append', started);
      } finally {
        busy = false;
      }
      return;
    }

    if (distanceToStart < EXTEND_BEHIND_PX) {
      const first = months.value[0];
      if (!first) return;
      busy = true;
      try {
        const prev = stepMonthKey(first, -1);
        // Prepend above the viewport (compensated), then drop the far bottom
        // month, which is below the fold and shifts nothing.
        await mutateAbove(() => {
          months.value = [prev, ...months.value];
        });
        if (months.value.length > MAX_WINDOW_MONTHS) {
          mutateBelow(() => {
            months.value = months.value.slice(0, -1);
          });
        }
        emitExtended('prepend', started);
      } finally {
        busy = false;
      }
    }
  }

  /**
   * Report the extension AFTER the DOM work has settled — timing only the
   * synchronous slice measured ~0ms, which the 250ms telemetry floor then
   * dropped entirely, leaving the feature's main performance risk with no data
   * at all. The `debug` event is the floor-exempt counter that makes the RATE
   * measurable; the timing is for the pathological case.
   */
  function emitExtended(detail: 'append' | 'prepend', started: number): void {
    void nextTick().then(() => {
      logEvent({
        surface: 'calendar-nav',
        level: 'debug',
        message: 'month stream extended',
        context: { action: 'stream-extend', detail },
      });
      recordPerf('calendar.streamExtend', performance.now() - started);
    });
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
        void extendAndPrune();
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

  /**
   * Bind to the app scroller.
   *
   * Two failure modes this guards, both previously silent:
   *  - **Late attach after dispose.** The bind is deferred a tick, and this
   *    component is `v-if`'d on view + breakpoint, so a mount-then-unmount
   *    inside one flush (a deep link resolving to week view, a fast view tap, a
   *    resize flutter across 767px) used to leave `detach` null at dispose and
   *    then bind a PERMANENT listener to `<main>` — which, on any short page,
   *    appended a month on every scroll frame app-wide, forever.
   *  - **Unresolvable scroller.** Bailing quietly degraded the stream to a
   *    static three-month list: the label froze and scrolling stopped dead,
   *    with nothing in CloudWatch to say why.
   */
  function attach(): void {
    if (disposed || detach) return;
    scroller = getAppScroller(options.root.value);
    if (!scroller) {
      reportError({
        surface: 'calendar-nav',
        message:
          '[monthStream] could not resolve the app scroll container (<main>) — the month stream will not extend or track the month in view. Check the App.vue layout still renders <main> as the scroller.',
        severity: 'warning',
        context: { action: 'stream-attach-failed' },
      });
      return;
    }
    const el = scroller;
    el.addEventListener('scroll', onScroll, { passive: true });
    detach = () => el.removeEventListener('scroll', onScroll);
  }

  // The scroller OUTLIVES this component (route change, view switch, breakpoint
  // flip), so a leaked listener would keep emitting month-in-view from a dead
  // component. Teardown removes it and cancels any queued frame.
  onScopeDispose(() => {
    disposed = true;
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
      attach(); // idempotent; also the recovery path if the first bind missed
      onScroll();
    },
  };
}
