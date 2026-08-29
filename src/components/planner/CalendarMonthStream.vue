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
 * compensation, and `anchorToDate` below. Nothing else may write it — see the
 * single-write-path note in `useMonthStream`.
 */
import { computed, ref, watch, nextTick, onMounted } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatMonthYear, toDateInputValue } from '@/utils/date';
import { monthCells, monthSpan, type WeekRangeMeta } from '@/utils/monthCells';
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
import type { HolidayOccurrence } from '@/types/models';

/** Where an imperative anchor request should land the view. */
export type AnchorTarget = 'today' | 'month-start' | 'month-end';

const props = defineProps<{
  /** Controlled period — the page owns the canonical date (props down). */
  referenceDate: Date;
  selectedDate?: string;
  /**
   * ONE imperative channel for every "reposition the stream" request. Replaces
   * the old `todayTick`: bumping `tick` runs `anchorToDate` for `target`, so a
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

const ALL_DAY_VISIBLE_CAP = 3;
const TIMED_VISIBLE_CAP = 4;

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

  const occurrences = activityStore.activitiesInRange(spanStart, spanEnd);
  const segments = vacationStore.travelSegmentOccurrencesInRange(spanStart, spanEnd);
  const holidays = holidayStore.holidaysInRange(spanStart, spanEnd);
  const vacations = vacationStore.vacations;

  return list.map((key) => {
    const cells = monthCells({
      year: key.y,
      month: key.m,
      weekStartDay,
      todayStr: todayStr.value,
      occurrences,
      segments,
      vacations,
      holidays,
    });
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

/** Resolve the date an anchor request means, for the CURRENT reference month. */
function resolveAnchorDate(target: AnchorTarget): string {
  const ref = props.referenceDate;
  if (target === 'month-end') {
    return toDateInputValue(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  }
  if (target === 'month-start') {
    return toDateInputValue(new Date(ref.getFullYear(), ref.getMonth(), 1));
  }
  return todayStr.value;
}

/**
 * Scroll the stream to `dateStr`, pulling its month into the window first when
 * it is out of range.
 *
 * The old `scrollMobileToToday` returned silently at four separate guard points
 * — so a scroll that never happened looked exactly like one that did. Here the
 * only unexplained outcome (the card genuinely isn't in the DOM) is reported.
 */
async function anchorToDate(dateStr: string, opts: { smooth?: boolean } = {}): Promise<void> {
  const targetMonth: MonthKey = {
    y: Number(dateStr.slice(0, 4)),
    m: Number(dateStr.slice(5, 7)) - 1,
  };
  if (!windowContains(months.value, targetMonth)) {
    resetWindow(targetMonth);
    await nextTick();
  }
  await nextTick();

  const root = rootRef.value;
  const scroller = getAppScroller(root);
  if (!root || !scroller) return; // not mounted yet — a later anchor will land

  const card = root.querySelector<HTMLElement>(`[data-date="${dateStr}"]`);
  if (!card) {
    reportError({
      surface: 'calendar-nav',
      message: `[monthStream] no day card for ${dateStr} — the stream could not be positioned (month window may not have rendered)`,
      severity: 'warning',
      context: { action: 'stream-anchor-failed' },
    });
    return;
  }
  const offsetWithinScroller =
    card.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  // 80px headroom so the anchored card clears the topbar.
  scroller.scrollTo({
    top: Math.max(0, offsetWithinScroller - 80),
    behavior: opts.smooth ? 'smooth' : 'auto',
  });
  syncNow();
}

watch(
  () => props.anchor?.tick,
  (tick, prev) => {
    if (tick === undefined || tick === prev) return;
    const target = props.anchor?.target ?? 'today';
    void anchorToDate(resolveAnchorDate(target), { smooth: true }).then(() => {
      if (target !== 'today') {
        logEvent({
          surface: 'calendar-nav',
          level: 'info',
          message: 'month stream swipe landing',
          context: { action: 'swipe-landing', detail: target === 'month-start' ? 'start' : 'end' },
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
    const target = monthKeyOf(props.referenceDate);
    if (sameMonth(target, monthInView.value)) return;
    void anchorToDate(toDateInputValue(new Date(target.y, target.m, 1)), { smooth: true });
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
onMounted(() => {
  void nextTick().then(() => {
    const refKey = monthKeyOf(props.referenceDate);
    const todayKey: MonthKey = {
      y: Number(todayStr.value.slice(0, 4)),
      m: Number(todayStr.value.slice(5, 7)) - 1,
    };
    const target = sameMonth(refKey, todayKey)
      ? todayStr.value
      : toDateInputValue(new Date(refKey.y, refKey.m, 1));
    void anchorToDate(target);
  });
});

defineExpose({ anchorToDate });
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
          class="flex items-center gap-2.5 px-1"
          :class="monthIdx === 0 ? 'sr-only' : 'pt-5 pb-1.5'"
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
