<script setup lang="ts">
/**
 * The month grid (#141): six week rows of seven days that fill the viewport below the
 * command bar, every week with an all-day lane, each day showing as many chips as its
 * measured row holds before "+N more".
 *
 * Props down, intents up: the page owns the date (`referenceDate`), the presentation
 * (`display`, one `MonthGridDisplay`) and whether anything renders below the grid
 * (`bleedBottom`); the grid emits navigation, opens and preference changes.
 *
 * ⚠️ `display.variant` is CONSTANT for an instance: the page keys the grid by it
 * (`:key="monthGridDisplay.variant"`), so crossing 768px remounts rather than mutating
 * one instance between desktop and phone. Setup-time choices (the fit's `format`, wheel
 * gating) and local state (the open popover, the selected day) can therefore never be
 * stale for the other variant. The grid reads no breakpoint of its own.
 *
 * Data: `monthCells` (42 cells, padding days with their own data) → `assignMonthLayout`
 * (lane winner and stack per cell) → `cellCapacity` against the row height from
 * `useMonthGridFit`. Geometry is `MONTH_CELL_METRICS[density]`, bound on each cell as
 * `--mg-*` custom properties.
 *
 * Phone (Phase 2): a full-bleed card on the page ground with a Faces · Bars · Titles
 * label row above the day headers; a two-finger pinch steps the same density. A tap on
 * a day opens its `MonthDayRow` under that week (Escape or a month change closes it); a
 * second tap on the same day drills into the Day view.
 *
 * Drag and drop (#142): one `useCalendarDrag` on the root covers the cells, the phone day
 * row and (as a portal, it is teleported) the desktop "+N more" popover. Each cell is a day
 * drop target; `overTarget` rings the cell a lifted chip would land on, holding it at the
 * grid's left/right edge pages the month, and swipe and wheel paging stand down while
 * something is lifted. A pointer lift closes the popover so the cells are visible.
 */
import { ref, computed, nextTick, watch, useId } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDayExtras } from '@/composables/useDayExtras';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import { useTranslation } from '@/composables/useTranslation';
import { monthCells, monthSpan, weekRows, type MonthDayCellData } from '@/utils/monthCells';
import {
  assignMonthLayout,
  cellCapacity,
  fitCount,
  minRowPx,
  stepDensity,
  type MonthGridDisplay,
} from '@/utils/monthGridLayout';
import {
  MONTH_CELL_METRICS,
  PHONE_DENSITIES,
  monthCellCssVars,
  type PhoneDensity,
  MIN_CELL_PX_FOR_TIMES,
} from '@/constants/calendarCaps';
import { isWeekendYmd } from '@/utils/date';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';
import MonthGridCell from '@/components/planner/MonthGridCell.vue';
import MonthDayPopover from '@/components/planner/MonthDayPopover.vue';
import MonthDayRow from '@/components/planner/MonthDayRow.vue';
import { useCalendarDrag } from '@/composables/useCalendarDrag';
import { useCalendarSlide } from '@/composables/useCalendarSlide';
import { useWheelMonthPaging } from '@/composables/useWheelMonthPaging';
import { useMonthGridFit } from '@/composables/useMonthGridFit';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { publishedHeight } from '@/composables/usePublishedHeight';
import type { MonthPrefChange } from '@/composables/useMonthGridPrefs';
import type { PinchDirection } from '@/composables/useHorizontalSwipe';
import { useToday } from '@/composables/useToday';
import { logEvent } from '@/services/telemetry/logEvent';
import type { HolidayOccurrence } from '@/types/models';
import type { CalendarDayTint } from '@/constants/tileStyles';

const props = defineProps<{
  /** Controlled period — the page owns the canonical date; the grid derives
   *  its displayed month from it (props down, no internal nav state). */
  referenceDate: Date;
  /** The grid's single presentation input, built once by the page. */
  display: MonthGridDisplay;
  /** Nothing renders below the grid: let the card eat `<main>`'s bottom padding so the
   *  page has zero scroll and the card reaches the window (or tab bar) edge. */
  bleedBottom: boolean;
}>();

const emit = defineEmits<{
  selectDate: [date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'view-activity': [activityId: string, date: string];
  'holiday-click': [holiday: HolidayOccurrence];
  'birthday-click': [birthday: BirthdayOccurrence];
  /** Swipe navigation — the page advances the shared reference date. */
  prev: [];
  next: [];
  /** A preference changed from the grid itself (phone pinch or density label). */
  'set-month-pref': [change: MonthPrefChange, via: 'pinch' | 'label'];
  /**
   * Whether a desktop cell is wide enough to show start times (`MIN_CELL_PX_FOR_TIMES`).
   * The command bar hides its Hide Times toggle while this is false, so the toggle never
   * sits there doing nothing.
   */
  'update:timesRoom': [value: boolean];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const settingsStore = useSettingsStore();

// Reactive "today" from the app-wide singleton — updates on a DST-safe midnight
// timer + visibilitychange + bfcache restore. Using a frozen `new Date()` here
// caused the "ghost today border": a tab left open across midnight kept marking
// yesterday as today. See issue #25.
const { today: todayStr } = useToday();
const currentYear = computed(() => props.referenceDate.getFullYear());
const currentMonth = computed(() => props.referenceDate.getMonth());

/** Fixed for the instance (the page keys the grid by variant). */
const format = props.display.variant;
const isDesktop = format === 'desktop';

const allDayLabels = [
  () => t('planner.day.sun'),
  () => t('planner.day.mon'),
  () => t('planner.day.tue'),
  () => t('planner.day.wed'),
  () => t('planner.day.thu'),
  () => t('planner.day.fri'),
  () => t('planner.day.sat'),
];

const dayLabels = computed(() => {
  const start = settingsStore.weekStartDay;
  return Array.from({ length: 7 }, (_, i) => allDayLabels[(i + start) % 7]!());
});

/**
 * The grid's full span INCLUDING padding cells, hoisted so the shared day-extras
 * query can be given a window. Same numbers `monthData` uses below.
 */
const gridSpan = computed(() =>
  monthSpan(currentYear.value, currentMonth.value, settingsStore.weekStartDay)
);
/** Birthdays, holidays and trips — the ONE query the beanie wall asks too. */
const { extras: dayExtras } = useDayExtras(
  computed(() => gridSpan.value.startYmd),
  computed(() => gridSpan.value.endYmd)
);

const monthData = computed(() => {
  const { startYmd, endYmd } = gridSpan.value;
  return monthCells({
    year: currentYear.value,
    month: currentMonth.value,
    weekStartDay: settingsStore.weekStartDay,
    todayStr: todayStr.value,
    // EVENTS: one chip per event (an overnight tail is not a chip of its own).
    occurrences: activityStore.eventsInRange(startYmd, endYmd),
    segments: vacationStore.travelSegmentOccurrencesInRange(startYmd, endYmd),
    vacations: vacationStore.vacations,
    // Derived from each member's date of birth over the SAME span as everything else.
    extras: dayExtras.value,
  });
});

const calendarDays = computed<MonthDayCellData[]>(() => monthData.value.days);
const layouts = computed(() => assignMonthLayout(calendarDays.value));
const metrics = computed(() => MONTH_CELL_METRICS[props.display.density]);
const cssVars = computed(() => monthCellCssVars(metrics.value));

/**
 * The cell tint: holiday, else weekend. (The old `'vacation'` day tint is not used here:
 * the trip lane carries trips now. The tint entry stays for other callers.)
 */
function cellTint(cell: MonthDayCellData): CalendarDayTint | undefined {
  if (monthData.value.holidayDates.has(cell.date)) return 'holiday';
  if (isWeekendYmd(cell.date)) return 'weekend';
  return undefined;
}

// ── Viewport fit ───────────────────────────────────────────────────────────
const swipeRef = ref<HTMLElement | null>(null);
/** The grid body — the wheel pager's own element, deliberately NOT `swipeRef`.
 *  Both composables animate `style.transform`; sharing one element let a wheel
 *  slide and a mouse-drag swipe overwrite each other's transform (and left the
 *  grid stuck at `opacity: 0` when a swipe's cleanup landed after a commit). */
const gridBodyRef = ref<HTMLElement | null>(null);

const { rowPx, remPx, bleedPx, degraded, cellPx } = useMonthGridFit(swipeRef, gridBodyRef, {
  format,
  reservePx: () => (format === 'phone' ? publishedHeight('--mobile-nav-h') : 0),
  minRowPx: (rem) => minRowPx(metrics.value, rem),
});

/**
 * What the cells draw. Desktop times yield to the title on a narrow cell
 * (`MIN_CELL_PX_FOR_TIMES`): the page's `showTime` says the person wants times,
 * the measured width says whether there is room for them.
 */
// Only the desktop variant has times to make room for; the phone grid reports true so a
// phone-sized window never leaves the page's flag stale for the desktop toggle.
const timesRoom = computed(
  () => format !== 'desktop' || cellPx.value === null || cellPx.value >= MIN_CELL_PX_FOR_TIMES
);
watch(timesRoom, (v) => emit('update:timesRoom', v), { immediate: true });
const cellDisplay = computed<MonthGridDisplay>(() => {
  const d = props.display;
  if (d.variant !== 'desktop' || !d.showTime || timesRoom.value) return d;
  return { ...d, showTime: false };
});

const capacities = computed(() =>
  calendarDays.value.map((_, i) =>
    cellCapacity({
      rowPx: rowPx.value,
      remPx: remPx.value,
      metrics: metrics.value,
      hasLane: !!layouts.value[i]!.lane,
      count: layouts.value[i]!.stack.length,
    })
  )
);

const weeks = computed(() =>
  weekRows(
    calendarDays.value.map((cell, i) => ({
      cell,
      layout: layouts.value[i]!,
      capacity: capacities.value[i]!,
      tint: cellTint(cell),
    }))
  )
);

const rowStyle = computed(() =>
  rowPx.value === null ? undefined : { height: `${rowPx.value}px` }
);

const cardClass = computed(() =>
  isDesktop
    ? [
        'dark:bg-surface-raised bg-white shadow-[var(--card-shadow)]',
        props.bleedBottom && rowPx.value !== null ? 'rounded-t-3xl' : 'rounded-3xl',
      ]
    : '-mx-4'
);
const cardStyle = computed(() =>
  props.bleedBottom && rowPx.value !== null ? { marginBottom: `-${bleedPx.value}px` } : undefined
);

// ── grid_fit telemetry ─────────────────────────────────────────────────────
// Fires after the first successful measure (rowPx is null until then, and while the
// planner is hidden), then only when the key changes, so a drag-resize that keeps the
// same slot count is one event; logEvent's 50/surface/min cap bounds the rest.
const fitKey = computed(() => {
  if (rowPx.value === null) return null;
  const slots = fitCount({
    rowPx: rowPx.value,
    remPx: remPx.value,
    metrics: metrics.value,
    hasLane: false,
  });
  return { slots, key: `${format}|${props.display.density}|${slots}|${degraded.value}` };
});
watch(
  () => fitKey.value?.key,
  (key) => {
    if (!key || !fitKey.value) return;
    logEvent({
      level: 'info',
      surface: 'calendar-month-grid',
      message: 'grid_fit',
      context: {
        action: 'grid_fit',
        format,
        kind: props.display.density,
        count: fitKey.value.slots,
        detail: degraded.value ? 'scroll' : 'fits',
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
      },
    });
  },
  { immediate: true }
);

// ── Desktop "+N more" popover (one per grid, keyed by date) ────────────────
const popover = ref<InstanceType<typeof MonthDayPopover> | null>(null);
const popoverDate = ref<string | null>(null);
const popoverCell = computed(() =>
  popoverDate.value ? (calendarDays.value.find((d) => d.date === popoverDate.value) ?? null) : null
);

function onMore(date: string, trigger: HTMLElement): void {
  popover.value?.openFor(date, trigger);
}

// ── Phone day selection ────────────────────────────────────────────────────
// A tap opens the day's `MonthDayRow` under its week (found by this id, never by a ref
// inside the week `v-for`); a second tap on the same day drills into the Day view.
const dayRowId = useId();
const selectedDate = ref<string | null>(null);
const selectedCell = computed(() =>
  selectedDate.value
    ? (calendarDays.value.find((d) => d.date === selectedDate.value) ?? null)
    : null
);
// A month change clears the selected day and closes the popover (its cell goes `null`).
watch([currentYear, currentMonth], () => {
  selectedDate.value = null;
  popoverDate.value = null;
});
useEscapeClose(
  computed(() => selectedDate.value !== null),
  () => closeDayRow('escape')
);

/**
 * Fold the open day row back to the plain grid (the row's close button, or Escape), and
 * hand focus back to the day's cell so a keyboard or screen-reader user is not dropped
 * onto the page body when the button they pressed unmounts.
 */
function closeDayRow(stage: 'close_button' | 'escape'): void {
  const date = selectedDate.value;
  if (date === null) return;
  selectedDate.value = null;
  logEvent({
    level: 'info',
    surface: 'calendar-month-grid',
    message: 'day_closed',
    context: { action: 'day_closed', format: 'phone', stage },
  });
  void nextTick(() => {
    gridBodyRef.value?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  });
}

function onTapDay(date: string): void {
  if (selectedDate.value === date) {
    logEvent({
      level: 'info',
      surface: 'calendar-month-grid',
      message: 'day_drilled',
      context: { action: 'day_drilled', format: 'phone', stage: 'second_tap' },
    });
    emit('selectDate', date);
    return;
  }
  selectedDate.value = date;
  logEvent({
    level: 'info',
    surface: 'calendar-month-grid',
    message: 'day_opened',
    context: { action: 'day_opened', format: 'phone', stage: 'tap' },
  });
  void nextTick(() => {
    document.getElementById(dayRowId)?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  });
}

function handleDayClick(date: string) {
  emit('selectDate', date);
}

// ── Phone density (label row and pinch) ────────────────────────────────────
const PHONE_DENSITY_LABEL_KEYS = {
  faces: 'planner.monthGrid.faces',
  bars: 'planner.monthGrid.bars',
  titles: 'planner.monthGrid.titles',
} as const satisfies Record<PhoneDensity, string>;

const phoneDensity = computed<PhoneDensity | null>(() =>
  props.display.variant === 'phone' ? props.display.density : null
);

/** Emit a phone density change; a no-op (the active word, a pinch at a clamp end) emits nothing. */
function setPhoneDensity(value: PhoneDensity, via: 'pinch' | 'label'): void {
  if (phoneDensity.value === null || value === phoneDensity.value) return;
  emit('set-month-pref', { name: 'phoneDensity', value }, via);
}

/** Spread = more detail, pinch = less, clamped at Faces and Titles. */
function onPinch(dir: PinchDirection): void {
  if (phoneDensity.value === null) return;
  setPhoneDensity(stepDensity(phoneDensity.value, dir === 'spread' ? 1 : -1), 'pinch');
}

const densityWordClass = (active: boolean) =>
  active
    ? 'text-secondary-500 decoration-primary-500 dark:text-accent-lift dark:decoration-accent-lift font-semibold underline decoration-2 underline-offset-4'
    : 'dark:text-ink-faint text-[var(--color-text-muted)]';

// ── Gestures ───────────────────────────────────────────────────────────────
// Drag and drop (#142). Declared first: the swipe and the wheel pager gate on `isLifted`.
const { isLifted, liveLabel, overTarget, onKeydown, onKeyup } = useCalendarDrag(swipeRef, {
  view: 'month',
  onEdge: (dir) => (dir === 'prev' ? emit('prev') : emit('next')),
  autoScroll: false,
  portal: computed(() => popover.value?.el ?? null),
  onLift: () => popover.value?.close(false),
});
const dropDate = computed(() => (overTarget.value?.kind === 'day' ? overTarget.value.date : null));

// Continuing to scroll at the grid's own edge turns the month (desktop only; the
// page's surface choice, via `display.variant`, is the single source).
const { isPaging } = useWheelMonthPaging(gridBodyRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
  enabled: computed(() => isDesktop && !isLifted.value),
});

// Swipe emits the navigation intent; the page advances the shared reference
// date (one-way data flow — the grid never mutates the date itself).
// Disabled while the wheel pager owns a transition, so a mouse drag during the
// slide cannot emit a SECOND `next` for what the user felt as one gesture.
// A two-finger pinch on the phone steps the density (reading the variant at setup is
// safe: the instance is keyed by it). The pinch is not gated by `enabled`.
useCalendarSlide(swipeRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
  enabled: computed(() => !isPaging.value && !isLifted.value),
  onPinch: isDesktop ? undefined : onPinch,
});
</script>

<template>
  <div
    ref="swipeRef"
    class="flex flex-col overflow-hidden"
    :class="cardClass"
    :style="[{ touchAction: 'pan-y', willChange: 'transform' }, cardStyle]"
    @keydown="onKeydown"
    @keyup="onKeyup"
  >
    <!-- The drag's spoken progress (#142): lifted / over / dropped / cancelled. -->
    <span class="sr-only" aria-live="polite" data-testid="month-drag-live">{{ liveLabel }}</span>
    <!-- Phone density label row (Faces · Bars · Titles), a 1rem row of toggle buttons
         (not a radiogroup, so no arrow-key roving to build). Pinch steps the same pref. -->
    <div
      v-if="phoneDensity"
      role="group"
      :aria-label="t('planner.monthGrid.phoneDensity')"
      class="flex h-4 flex-none items-center justify-end gap-3 px-2"
    >
      <template v-for="(density, i) in PHONE_DENSITIES" :key="density">
        <span
          v-if="i > 0"
          class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
          aria-hidden="true"
          >·</span
        >
        <button
          type="button"
          class="text-xs leading-none"
          :class="densityWordClass(density === phoneDensity)"
          :aria-pressed="density === phoneDensity"
          :data-testid="`month-density-${density}`"
          @click="setPhoneDensity(density, 'label')"
        >
          {{ t(PHONE_DENSITY_LABEL_KEYS[density]) }}
        </button>
      </template>
    </div>

    <!-- Day-of-week column headers -->
    <div class="dark:border-line grid flex-none grid-cols-7 border-b border-[var(--color-border)]">
      <div
        v-for="label in dayLabels"
        :key="label"
        class="font-outfit dark:text-ink-faint text-center text-xs leading-none font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
        :class="isDesktop ? 'py-1.5' : 'py-[0.3125rem]'"
      >
        {{ label }}
      </div>
    </div>

    <!-- Six week rows, each its own grid row element (so `last:border-r-0` works and
         each row can bind its fitted height). -->
    <div ref="gridBodyRef" class="flex flex-col">
      <template v-for="(week, w) in weeks" :key="week[0]!.cell.date">
        <div class="grid grid-cols-7" :style="rowStyle" data-testid="month-week-row">
          <MonthGridCell
            v-for="entry in week"
            :key="entry.cell.date"
            :cell="entry.cell"
            :layout="entry.layout"
            :capacity="entry.capacity"
            :tint="entry.tint"
            :display="cellDisplay"
            :css-vars="cssVars"
            :day-row-id="dayRowId"
            :selected="selectedCell?.date === entry.cell.date"
            :is-drop-target="dropDate === entry.cell.date"
            @select-date="handleDayClick"
            @tap-day="onTapDay"
            @more="onMore"
            @view-activity="(id, date) => emit('view-activity', id, date)"
            @vacation-click="(vid) => emit('vacation-click', vid)"
            @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
            @holiday-click="(h) => emit('holiday-click', h)"
            @birthday-click="(b) => emit('birthday-click', b)"
          />
        </div>
        <!-- Phone: the tapped day's row, a block between week rows (rows keep their fitted
           height; the page scrolls to show it). -->
        <MonthDayRow
          v-if="selectedCell && selectedCell.weekRow === w"
          :id="dayRowId"
          :cell="selectedCell"
          @close="closeDayRow('close_button')"
          @view-activity="(id, date) => emit('view-activity', id, date)"
          @vacation-click="(vid) => emit('vacation-click', vid)"
          @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
          @holiday-click="(h) => emit('holiday-click', h)"
          @birthday-click="(b) => emit('birthday-click', b)"
        />
      </template>
    </div>

    <MonthDayPopover
      v-if="isDesktop"
      ref="popover"
      :cell="popoverCell"
      @update:date="(d) => (popoverDate = d)"
      @view-activity="(id, date) => emit('view-activity', id, date)"
      @vacation-click="(vid) => emit('vacation-click', vid)"
      @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
      @holiday-click="(h) => emit('holiday-click', h)"
      @birthday-click="(b) => emit('birthday-click', b)"
    />
  </div>
</template>
