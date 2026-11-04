/**
 * Fit the month grid's six week rows to the viewport (#141).
 *
 * Measures how much height is left between the card's top and the bottom of the app's
 * scroller (minus a reserve, the phone tab bar's published height), divides it by six,
 * floors it to a whole pixel, and never goes below a rem-based minimum. Below that the
 * grid keeps the minimum and the page scrolls: a chip, lane or "+N more" is never
 * clipped. Each week row then binds an explicit `height`, so the card is content-sized
 * and ends at the viewport (or nav) edge within the flooring slack.
 *
 * Observes through `useElementSize` (the one guarded observer, no new ResizeObserver):
 * the app scroller (window resizes) and the card's PARENT (command-bar height changes,
 * the router view becoming visible). Re-measures on the next tick when either height
 * changes, when the root font size moves (Large reading mode, the `useFirstThatFits`
 * precedent), when `reservePx()` changes, and when the density's floor changes.
 *
 * ⚠️ CONVERGENCE INVARIANT. No input to `measure()` depends on the card's own height or on
 * the rows it sizes: `available` is the scroller's client height minus the card's offset
 * from the scroller's top, the reserve and the header (label row plus weekday row, which
 * the rows do not size). So a re-measure triggered by the grid's own resize returns the
 * same `rowPx`, and the observer loop settles after one pass. That is why `rowPx` comes
 * from the AVAILABLE height, never from the body's laid-out height. Inserting content
 * inside the card (the phone day row) does not move it, and no "frozen" flag is needed.
 *
 * Why whole pixels: six fractional rows can sum to a subpixel more than the available
 * height, and `<main>`'s integer `scrollHeight` then rounds up to a 1px scroll. Flooring
 * costs at most 5px of slack and keeps cell borders crisp.
 *
 * Why skip while hidden: on a cold start the planner mounts under `v-show` (the loading
 * skeleton), where every rect reads 0. `card.offsetParent === null` (the card is never
 * `position: fixed`) skips the measure, keeps the last value and emits nothing; the
 * parent observer fires when the planner becomes visible and the real measure follows.
 *
 * Failure (no scroller, or a layout read that throws) sets `rowPx` to `null`, which the
 * grid renders as content-sized rows with `fallbackSlots` (never clipped), and reports
 * `fit_measure_failed` (warning) once per mount.
 *
 * `format` is constant for an instance: the page keys the grid by its variant.
 */
import { computed, nextTick, onMounted, ref, watch, type Ref } from 'vue';
import { useElementSize } from '@/composables/useElementSize';
import { useSettingsStore } from '@/stores/settingsStore';
import { getAppScroller } from '@/utils/getAppScroller';
import { reportError } from '@/utils/errorReporter';

const SURFACE = 'calendar-month-grid';
const ROWS = 6;
const ROWS_PER_WEEK = 7;

export interface MonthGridFitOptions {
  format: 'desktop' | 'phone';
  /** Pixels reserved below the grid (the phone tab bar); read reactively. */
  reservePx: () => number;
  /** The row floor for the current density at a root font size, in px. */
  minRowPx: (remPx: number) => number;
}

export interface MonthGridFit {
  /** The week row height in whole px; `null` = not measured or measurement failed. */
  rowPx: Ref<number | null>;
  /** The root font size in px. */
  remPx: Ref<number>;
  /** How far the card may bleed into the scroller's bottom padding, in px. */
  bleedPx: Ref<number>;
  /** True when the rows sit at the minimum and the page scrolls. */
  degraded: Ref<boolean>;
  /** The width of one day cell in px (the body's width over seven); `null` until measured. */
  cellPx: Ref<number | null>;
}

export function useMonthGridFit(
  cardRef: Readonly<Ref<HTMLElement | null>>,
  bodyRef: Readonly<Ref<HTMLElement | null>>,
  opts: MonthGridFitOptions
): MonthGridFit {
  const settingsStore = useSettingsStore();
  const rowPx = ref<number | null>(null);
  const remPx = ref(16);
  const bleedPx = ref(0);
  const degraded = ref(false);
  const cellPx = ref<number | null>(null);

  const scrollerRef = computed(() => getAppScroller(cardRef.value));
  const parentRef = computed(() => cardRef.value?.parentElement ?? null);
  const { width: scrollerWidth, height: scrollerHeight } = useElementSize(scrollerRef, {
    surface: SURFACE,
  });
  const { height: parentHeight } = useElementSize(parentRef, { surface: SURFACE });

  let reported = false;
  function fail(detail: 'no_scroller' | 'measure_threw', error?: unknown): void {
    rowPx.value = null;
    degraded.value = false;
    if (reported) return;
    reported = true;
    reportError({
      surface: SURFACE,
      message: 'fit_measure_failed',
      severity: 'warning',
      error,
      context: { action: 'fit_measure_failed', format: opts.format, detail },
    });
  }

  function measure(): void {
    const card = cardRef.value;
    const body = bodyRef.value;
    if (!card || !body) return;
    try {
      const scroller = scrollerRef.value;
      if (!scroller) {
        fail('no_scroller');
        return;
      }
      // Hidden (cold-start skeleton, v-show): keep the last value, no telemetry.
      if (card.offsetParent === null) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const cardTop = card.getBoundingClientRect().top;
      const top = cardTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const headerPx = body.getBoundingClientRect().top - cardTop;
      const reserve = opts.reservePx();
      const available = scroller.clientHeight - top - reserve - headerPx;
      const min = opts.minRowPx(rem);
      const even = Math.floor(available / ROWS);
      remPx.value = rem;
      rowPx.value = Math.max(even, Math.ceil(min));
      degraded.value = even < min;
      cellPx.value = body.clientWidth / ROWS_PER_WEEK;
      bleedPx.value = Math.max(
        0,
        (parseFloat(getComputedStyle(scroller).paddingBottom) || 0) - reserve
      );
    } catch (err) {
      fail('measure_threw', err);
    }
  }

  function remeasure(): void {
    void nextTick(measure);
  }

  watch([scrollerWidth, scrollerHeight, parentHeight], remeasure);
  watch(() => settingsStore.textSize, remeasure);
  watch(() => opts.reservePx(), remeasure);
  // A density change moves the floor (the grid is not remounted for it).
  watch(() => opts.minRowPx(remPx.value), remeasure);
  onMounted(remeasure);

  return { rowPx, remPx, bleedPx, degraded, cellPx };
}
