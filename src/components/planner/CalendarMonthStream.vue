<script setup lang="ts">
/**
 * The mobile month view: a seamless, continuous vertical stream of day cards.
 *
 * Where the desktop grid shows exactly one month and stops dead at its edges,
 * this renders a bounded sliding WINDOW of months as one scroll — keep going
 * past 31 August and September's days simply continue, announced by an in-stream
 * month header. The command-bar label follows via `month-in-view`.
 *
 * It is a sibling of `CalendarGrid`, not a mode inside it: the page mounts one
 * or the other on the breakpoint. Two divergent render paths sharing one
 * `setup()` is how a 540-line component becomes a 900-line one, and keeping the
 * desktop grid's interface byte-identical is the strongest guard against
 * regressing a surface this change is not supposed to touch.
 *
 * Scroll position is written in exactly two places: `useMonthStream`'s window
 * compensation, and `anchorTo` below. Nothing else may write it — see the
 * single-write-path note in `useMonthStream`.
 */
import { computed, ref, watch, nextTick, onMounted } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatMonthYear } from '@/utils/date';
import { monthCellsFrom, prepareCellData, monthSpan, type WeekRangeMeta } from '@/utils/monthCells';
import {
  useMonthStream,
  monthKeyOf,
  monthKeyId,
  sameMonth,
  windowContains,
  type MonthKey,
} from '@/composables/useMonthStream';
import { getAppScroller } from '@/utils/getAppScroller';
import { useCalendarSlide } from '@/composables/useCalendarSlide';
import { useToday } from '@/composables/useToday';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import MonthDayCard, { type MonthDayCellData } from '@/components/planner/MonthDayCard.vue';
import { ALL_DAY_VISIBLE_CAP, TIMED_VISIBLE_CAP } from '@/constants/calendarCaps';
import type { HolidayOccurrence } from '@/types/models';

/** Where an imperative anchor request should land the view. */
/**
 * Where an imperative anchor request should land the view.
 *
 * `month-start` scrolls to the month's HEADER, not to the 1st's day card, so the
 * month's name is fully in view when you arrive — landing on the card alone put
 * the name just above the fold, which reads as having overshot the boundary.
 * (There was a `month-end` target for backward swipes; on device it made
 * swiping feel unlike scrolling, so both directions now land the same way.)
 */
export type AnchorTarget = 'today' | 'month-start';

const props = defineProps<{
  /** Controlled period — the page owns the canonical date (props down). */
  referenceDate: Date;
  selectedDate?: string;
  /**
   * ONE imperative channel for every "reposition the stream" request. Replaces
   * the old `todayTick`: bumping `tick` runs `anchorTo` for `target`, so a
   * "Today" tap and a swipe landing can never race two separate signals.
   */
  anchor?: { tick: number; target: AnchorTarget };
}>();

const emit = defineEmits<{
  selectDate: [date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'view-activity': [activityId: string, date: string];
  'holiday-click': [holiday: HolidayOccurrence];
  prev: [];
  next: [];
  /** The month now filling the top of the viewport — the page syncs its label. */
  'month-in-view': [firstOfMonth: Date];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const settingsStore = useSettingsStore();
const holidayStore = useHolidayStore();
const { today: todayStr } = useToday();

const rootRef = ref<HTMLElement | null>(null);

const { months, monthInView, resetWindow, syncNow } = useMonthStream(
  monthKeyOf(props.referenceDate),
  {
    root: rootRef,
    onMonthInView: (key) => emit('month-in-view', new Date(key.y, key.m, 1)),
  }
);

/**
 * Every rendered month, cells included.
 *
 * Store data is fetched ONCE across the whole window span and handed to the
 * pure `monthCells` helper per month — per-month store queries would multiply
 * the scans by the window size on every recompute.
 */
const renderedMonths = computed(() => {
  const list = months.value;
  if (list.length === 0) return [];
  const weekStartDay = settingsStore.weekStartDay;
  const spanStart = monthSpan(list[0]!.y, list[0]!.m, weekStartDay).startYmd;
  const spanEnd = monthSpan(
    list[list.length - 1]!.y,
    list[list.length - 1]!.m,
    weekStartDay
  ).endYmd;

  // Query the stores once across the window, and partition once — then build
  // each month from the prepared lookups. Doing the partition per month made it
  // O(months x span) inside the scroll rAF.
  const prepared = prepareCellData({
    occurrences: activityStore.activitiesInRange(spanStart, spanEnd),
    segments: vacationStore.travelSegmentOccurrencesInRange(spanStart, spanEnd),
    vacations: vacationStore.vacations,
    holidays: holidayStore.holidaysInRange(spanStart, spanEnd),
    spanStart,
    spanEnd,
  });

  return list.map((key) => {
    const cells = monthCellsFrom(
      { year: key.y, month: key.m, weekStartDay, todayStr: todayStr.value },
      prepared
    );
    return {
      key,
      id: monthKeyId(key),
      label: formatMonthYear(new Date(key.y, key.m, 1)),
      // The stream shows whole months only — padding days belong to the
      // 7-column grid's alignment, and the boundary header replaces the
      // context they used to provide.
      days: cells.days.filter((d) => d.isCurrentMonth),
      weekSeparatorDates: new Set(
        [...cells.weekSeparatorIndexes]
          .map((i) => cells.days[i]?.date)
          .filter((d): d is string => !!d)
      ),
      weekRanges: cells.weekRanges,
      vacationDates: cells.vacationDates,
      holidayDates: cells.holidayDates,
    };
  });
});

function weekMeta(
  month: { weekRanges: Map<number, WeekRangeMeta> },
  cell: MonthDayCellData
): WeekRangeMeta | undefined {
  return month.weekRanges.get(cell.weekRow);
}

// ── Swipe ──────────────────────────────────────────────────────────────────
// Emits the intent only; the page advances the shared reference date, then
// bumps `anchor` so the stream lands at the right end of the target month.
useCalendarSlide(rootRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
});

// ── Anchoring (the ONLY other writer of scroll position) ───────────────────

/**
 * Scroll the stream so `target` is in view, pulling its month into the window
 * first when it is out of range.
 *
 * The old `scrollMobileToToday` returned silently at four separate guard points
 * — so a scroll that never happened looked exactly like one that did. Here the
 * only unexplained outcome (the element genuinely isn't in the DOM) is reported.
 */
let anchorSeq = 0;

/** Headroom above the anchored element, so it clears the topbar with air to spare. */
const ANCHOR_HEADROOM_PX = 80;

async function anchorTo(target: AnchorTarget, opts: { smooth?: boolean } = {}): Promise<void> {
  // Last caller wins. Two anchor requests can be in flight at once (a window
  // reset costs an extra tick), and without this the SLOWER one landed last —
  // which is how "Today" ended up scrolling to the 1st of the month.
  const seq = ++anchorSeq;

  const refKey = monthKeyOf(props.referenceDate);
  const todayKey: MonthKey = {
    y: Number(todayStr.value.slice(0, 4)),
    m: Number(todayStr.value.slice(5, 7)) - 1,
  };
  const targetMonth = target === 'today' ? todayKey : refKey;
  // A month lands on its header (name visible); today lands on its own card.
  const selector =
    target === 'today'
      ? `[data-date="${todayStr.value}"]`
      : `[data-month-key="${monthKeyId(refKey)}"]`;

  if (!windowContains(months.value, targetMonth)) {
    resetWindow(targetMonth);
    await nextTick();
  }
  await nextTick();
  if (seq !== anchorSeq) return; // superseded by a later request

  const root = rootRef.value;
  const scroller = getAppScroller(root);
  if (!root || !scroller) return; // not mounted yet — a later anchor will land

  const el = root.querySelector<HTMLElement>(selector);
  if (!el) {
    reportError({
      surface: 'calendar-nav',
      message: `[monthStream] nothing matching ${selector} — the stream could not be positioned (the month window may not have rendered)`,
      severity: 'warning',
      context: { action: 'stream-anchor-failed' },
    });
    return;
  }
  const offsetWithinScroller =
    el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({
    top: Math.max(0, offsetWithinScroller - ANCHOR_HEADROOM_PX),
    behavior: opts.smooth ? 'smooth' : 'auto',
  });
  syncNow();
}

/**
 * An anchor bump and a `referenceDate` change arrive together for the same user
 * action (Today, a swipe, a command-bar arrow). This watcher is registered
 * first and claims the flush, so the `referenceDate` watcher below stands down
 * — the anchor carries the more specific intent ("land on today", "land on the
 * last day"), and letting both run raced two scrolls with the vaguer one
 * landing last.
 */
let anchorOwnsFlush = false;

watch(
  () => props.anchor?.tick,
  (tick, prev) => {
    if (tick === undefined || tick === prev) return;
    anchorOwnsFlush = true;
    void nextTick().then(() => {
      anchorOwnsFlush = false;
    });
    const target = props.anchor?.target ?? 'today';
    void anchorTo(target, { smooth: true }).then(() => {
      if (target !== 'today') {
        logEvent({
          surface: 'calendar-nav',
          level: 'info',
          message: 'month stream month landing',
          context: { action: 'swipe-landing', detail: 'start' },
        });
      }
    });
  }
);

/**
 * Keep the stream in step with an EXTERNAL reference-date change (command-bar
 * arrows, a jump to another month).
 *
 * The re-anchor rule is what makes this loop-safe: when the new reference month
 * is ALREADY the month in view — exactly the case when the change came from our
 * own `month-in-view` emit — we do nothing. Only a genuinely different month
 * scrolls, so the label can never fight the user's own scrolling.
 *
 * Swipes are excluded: they arrive with an `anchor` bump that lands the view at
 * the correct end of the month, and that watcher owns the scroll.
 */
watch(
  () => `${props.referenceDate.getFullYear()}-${props.referenceDate.getMonth()}`,
  () => {
    if (anchorOwnsFlush) return; // an anchor bump accompanies this change and owns the scroll
    const target = monthKeyOf(props.referenceDate);
    if (sameMonth(target, monthInView.value)) return;
    void anchorTo('month-start', { smooth: true });
  }
);

/**
 * First mount: land on today — but only when today is in the month the page is
 * actually showing. Arriving on some other month (a drill-in from elsewhere, a
 * view switch that carried its own date) must stay there; jumping to today
 * would silently discard where the user asked to be. This is the same
 * period-continuity rule the old `scrollMobileToToday` enforced with its
 * `todayInView` guard.
 *
 * Anchoring to `referenceDate` rather than unconditionally to today also keeps
 * this deferred call from fighting a navigation that lands between mount and
 * the next tick: both now aim at the same month.
 */
/**
 * Wait until the stack has actually laid out before measuring it.
 *
 * The day cards render progressively after a route nav / view switch and the
 * beanpod hydrates afterwards, so `scrollHeight` grows over many frames — and
 * the stream mounts THREE months where the old day-stack mounted one, so it
 * settles strictly later. Measuring mid-render lands on a stale (often near-
 * zero) position, and nothing re-anchors afterwards: today ends up hundreds of
 * pixels off-screen with the card present in the DOM, so not even
 * `stream-anchor-failed` fires. This is the `scrollToTodayWhenSettled` guard
 * the old CalendarGrid carried, kept for the same reason.
 */
function whenLayoutSettles(run: () => void): void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
    run();
    return;
  }
  const deadline = performance.now() + 1500;
  let lastHeight = -1;
  let stableFrames = 0;
  const tick = () => {
    const h = getAppScroller(rootRef.value)?.scrollHeight ?? -1;
    if (h === lastHeight) stableFrames += 1;
    else {
      stableFrames = 0;
      lastHeight = h;
    }
    if (stableFrames >= 2 || performance.now() >= deadline) {
      run();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

onMounted(() => {
  void nextTick().then(() => {
    const refKey = monthKeyOf(props.referenceDate);
    const todayKey: MonthKey = {
      y: Number(todayStr.value.slice(0, 4)),
      m: Number(todayStr.value.slice(5, 7)) - 1,
    };
    const target: AnchorTarget = sameMonth(refKey, todayKey) ? 'today' : 'month-start';
    whenLayoutSettles(() => void anchorTo(target));
  });
});

defineExpose({ anchorTo });
</script>

<template>
  <div
    ref="rootRef"
    class="rounded-3xl bg-white p-3 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    style="touch-action: pan-y; will-change: transform"
  >
    <div class="flex flex-col gap-1.5">
      <template v-for="(month, monthIdx) in renderedMonths" :key="month.id">
        <!-- Month boundary — the seam made visible. The first rendered month
             carries the marker too (as an anchor for the probe) but hides its
             heading chrome, since the command bar already names it. -->
        <div
          :data-month-key="month.id"
          class="flex items-center gap-2.5 px-1 pt-5 pb-1.5"
          :class="monthIdx === 0 ? 'pt-1' : ''"
        >
          <span class="font-outfit text-primary-500 text-base font-bold lowercase">
            {{ month.label }}
          </span>
          <span
            class="from-primary-500 h-0.5 flex-1 rounded-sm bg-gradient-to-r via-[#E67E22] to-transparent"
          />
        </div>

        <template v-for="cell in month.days" :key="cell.date">
          <!-- Week separator before the first cell of each week -->
          <div
            v-if="month.weekSeparatorDates.has(cell.date)"
            class="flex items-center gap-2 px-1 pt-1 pb-0.5"
            :class="
              weekMeta(month, cell)?.isCurrent
                ? 'text-primary-500'
                : 'text-secondary-500/50 dark:text-gray-500'
            "
          >
            <span class="font-outfit text-[0.625rem] font-bold tracking-[0.14em] uppercase">
              {{ t(weekMeta(month, cell)?.labelKey ?? 'planner.weekUpcoming') }}
            </span>
            <span
              class="font-outfit text-[0.625rem] font-medium normal-case"
              :class="weekMeta(month, cell)?.isCurrent ? 'opacity-90' : 'opacity-70'"
            >
              · {{ weekMeta(month, cell)?.range }}
            </span>
            <span
              class="h-px flex-1"
              :class="
                weekMeta(month, cell)?.isCurrent
                  ? 'bg-primary-500/30'
                  : 'bg-gray-200 dark:bg-slate-700'
              "
            />
          </div>

          <MonthDayCard
            :cell="cell"
            :all-day-cap="ALL_DAY_VISIBLE_CAP"
            :timed-cap="TIMED_VISIBLE_CAP"
            :selected="props.selectedDate === cell.date"
            :bg-class="''"
            @select-date="(d) => emit('selectDate', d)"
            @view-activity="(id, date) => emit('view-activity', id, date)"
            @holiday-click="(h) => emit('holiday-click', h)"
            @vacation-click="(vid) => emit('vacation-click', vid)"
            @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
          />
        </template>
      </template>
    </div>
  </div>
</template>
