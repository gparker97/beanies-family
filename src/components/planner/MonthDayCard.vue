<script setup lang="ts">
/**
 * One cell of the month calendar grid. Owns the visual rendering for a
 * single day: the day number (with today highlight), holiday + all-day
 * chip lane, timed-activity chip row (via `MonthChip`), travel-segment
 * chips, and vacation bars.
 *
 * Extracted from `CalendarGrid.vue` during Phase A of the calendar
 * refactor so the parent stays focused on month-level data assembly
 * (occurrence map, vacation spans, holidays) while this owns rendering.
 *
 * Layout adapts at the `md` breakpoint:
 *   - desktop (md+) → vertical stack: day number on top, events below
 *   - mobile (<md)  → horizontal card: DOW + number on the left, events on the right
 * The 7-column grid → vertical day-stack collapse lives in the parent
 * `CalendarGrid` (which switches its own layout); this card just adapts
 * its internal direction to match.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { parseLocalDate } from '@/utils/date';
import HolidayChip from '@/components/planner/HolidayChip.vue';
import AllDayActivityChip from '@/components/planner/AllDayActivityChip.vue';
import TravelSegmentChip from '@/components/planner/TravelSegmentChip.vue';
import MonthChip from '@/components/planner/MonthChip.vue';
import type { FamilyActivity, HolidayOccurrence } from '@/types/models';
import type { TravelSegmentOccurrence } from '@/utils/vacation';

export interface CellAllDayItem {
  activity: FamilyActivity;
  isStart: boolean;
  isEnd: boolean;
}

export interface CellVacation {
  id: string;
  name: string;
  emoji: string;
  /** First covered day of the trip — renders the name + rounds the left edge. */
  isStart: boolean;
  /** Last covered day of the trip — rounds the right edge so a multi-day trip
   *  reads as one connected band across its cells. */
  isEnd: boolean;
}

export interface CellTimedOccurrence {
  activity: FamilyActivity;
  date: string;
}

export interface MonthDayCellData {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  weekRow: number;
  timedOccurrences: CellTimedOccurrence[];
  vacations: CellVacation[];
  segments: TravelSegmentOccurrence[];
  allDayItems: CellAllDayItem[];
  holidays: HolidayOccurrence[];
}

const props = defineProps<{
  cell: MonthDayCellData;
  /** Visible cap for the all-day lane on this cell. Parent owns the number
      so future tuning (or breakpoint-aware caps) live in one place. */
  allDayCap: number;
  /** Visible cap for the timed chip row. */
  timedCap: number;
  /** Highlight class for the selected date (parent owns the selection ref). */
  selected: boolean;
  /** Cell background class (parent computes from vacation/holiday/today rules). */
  bgClass: string;
}>();

const emit = defineEmits<{
  'select-date': [date: string];
  'view-activity': [activityId: string, date: string];
  'holiday-click': [holiday: HolidayOccurrence];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
}>();

const { t } = useTranslation();

// DOW abbreviation (mobile only). Uses the same translation keys as the
// CalendarGrid column headers so beanie mode + future locales pick up the
// override automatically.
const DOW_KEYS = [
  'planner.day.sun',
  'planner.day.mon',
  'planner.day.tue',
  'planner.day.wed',
  'planner.day.thu',
  'planner.day.fri',
  'planner.day.sat',
] as const;

const dowLabel = computed(() => {
  const idx = parseLocalDate(props.cell.date).getDay();
  return t(DOW_KEYS[idx]!);
});

// Timed chips visible vs overflow count. Cap protects against extremely
// busy days ballooning a single row's height beyond reason.
const visibleTimed = computed(() => props.cell.timedOccurrences.slice(0, props.timedCap));

const timedOverflow = computed(() =>
  Math.max(0, props.cell.timedOccurrences.length - props.timedCap)
);

const allDayOverflow = computed(() =>
  Math.max(0, props.cell.holidays.length + props.cell.allDayItems.length - props.allDayCap)
);

const visibleAllDayItems = computed(() =>
  props.cell.allDayItems.slice(0, Math.max(0, props.allDayCap - props.cell.holidays.length))
);

/** A day with nothing on it — collapsed to a thin "nothing planned" line on
 *  mobile (today is never collapsed; it keeps its anchor + "TODAY" caption). */
const isEmptyDay = computed(
  () =>
    props.cell.timedOccurrences.length === 0 &&
    props.cell.allDayItems.length === 0 &&
    props.cell.holidays.length === 0 &&
    props.cell.segments.length === 0 &&
    props.cell.vacations.length === 0
);

function onCellClick() {
  emit('select-date', props.cell.date);
}

function onMoreClick(event: MouseEvent) {
  event.stopPropagation();
  // Same affordance as the day number: opens the day-detail surface via
  // the existing select-date handler. Distinct from the chip clicks which
  // open the activity drawer.
  emit('select-date', props.cell.date);
}
</script>

<template>
  <button
    :data-date="cell.date"
    type="button"
    class="font-outfit relative flex w-full min-w-0 cursor-pointer flex-row gap-3 rounded-xl border bg-white p-2.5 text-left transition-colors md:h-auto md:min-h-[140px] md:flex-col md:items-center md:gap-1 md:rounded-xl md:border-0 md:bg-transparent md:px-1.5 md:pt-1.5 md:pb-1 dark:bg-slate-800/40 md:dark:bg-transparent"
    :class="[
      cell.isCurrentMonth
        ? 'text-secondary-500 dark:text-gray-200'
        : 'text-secondary-500/30 md:bg-transparent dark:text-gray-600',
      bgClass,
      // Today on mobile gets a 3px orange left bar + soft orange wash so it
      // stands out in the vertical day-stack even when there are zero events.
      // Desktop suppresses the border (md:!border-transparent + md:!bg-...) since
      // the gradient day-number pill below already carries the today marker.
      cell.isToday
        ? 'border-primary-500 border-l-[3px] bg-[rgba(241,93,34,0.04)] md:!border-transparent md:!bg-transparent'
        : 'border-gray-200/60 dark:border-slate-700/60',
      selected ? 'ring-primary-500 ring-2 ring-inset' : '',
    ]"
    @click="onCellClick"
  >
    <!-- Mobile-only DOW + day-number column on the left -->
    <div class="flex w-10 flex-shrink-0 flex-col items-center gap-0.5 pt-0.5 md:hidden">
      <span
        class="text-[0.625rem] font-bold tracking-[0.14em] uppercase"
        :class="cell.isToday ? 'text-primary-500' : 'text-secondary-500/50 dark:text-gray-500'"
      >
        {{ dowLabel }}
      </span>
      <span
        class="text-lg leading-none font-semibold"
        :class="cell.isToday ? 'text-primary-500' : ''"
      >
        {{ cell.day }}
      </span>
      <!-- Empty-day "today" badge: when today has no events, the events
           column is collapsed; this small caption makes the row read as
           an intentional placeholder rather than blank space. -->
      <span
        v-if="
          cell.isToday &&
          cell.timedOccurrences.length === 0 &&
          cell.allDayItems.length === 0 &&
          cell.holidays.length === 0
        "
        class="text-primary-500 mt-0.5 text-[0.5625rem] font-bold tracking-[0.12em] uppercase"
      >
        {{ t('planner.today') }}
      </span>
    </div>

    <!-- Desktop-only centered day-number pill -->
    <span
      class="hidden h-7 w-7 items-center justify-center rounded-full text-sm font-semibold md:flex"
      :class="
        cell.isToday
          ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white shadow-[0_2px_6px_rgba(241,93,34,0.3)]'
          : ''
      "
    >
      {{ cell.day }}
    </span>

    <!-- Events column — right of day-num on mobile, stacked below on desktop -->
    <div class="flex min-w-0 flex-1 flex-col gap-1 md:w-full md:gap-px">
      <!-- Holidays + all-day chips share a lane, capped to `allDayCap`. -->
      <template v-if="cell.holidays.length > 0 || cell.allDayItems.length > 0">
        <HolidayChip
          v-for="(h, hi) in cell.holidays.slice(0, allDayCap)"
          :key="'h:' + hi"
          :holiday="h"
          :is-start="true"
          :is-end="true"
          class="block w-full"
          @click.stop="emit('holiday-click', h)"
        />
        <AllDayActivityChip
          v-for="(item, i) in visibleAllDayItems"
          :key="item.activity.id + ':' + i"
          :activity="item.activity"
          :is-start="item.isStart"
          :is-end="item.isEnd"
          class="block w-full"
          @click.stop="emit('view-activity', item.activity.id, cell.date)"
        />
        <span
          v-if="allDayOverflow > 0"
          class="text-secondary-500/40 px-0.5 text-[0.5625rem] leading-tight dark:text-gray-500"
          aria-hidden="true"
        >
          +{{ allDayOverflow }}
        </span>
      </template>

      <!-- Timed chips (NEW — replaces the legacy colored-dot row) -->
      <MonthChip
        v-for="occ in visibleTimed"
        :key="occ.activity.id + ':timed:' + occ.date"
        :occurrence="occ"
        @view-activity="(id, date) => emit('view-activity', id, date)"
      />
      <button
        v-if="timedOverflow > 0"
        type="button"
        class="font-outfit text-secondary-500/50 hover:text-primary-500 self-start rounded-md px-1 py-0.5 text-[0.625rem] font-semibold tracking-wide transition-colors dark:text-gray-500"
        :aria-label="t('planner.moreEvents').replace('{count}', String(timedOverflow))"
        @click="onMoreClick"
      >
        +{{ timedOverflow }} {{ t('planner.moreEventsShort') }}
      </button>

      <!-- Travel-segment chips (kept as-is — they share the chip-row real estate) -->
      <div v-if="cell.segments.length > 0" class="flex flex-wrap items-center gap-[2px]">
        <TravelSegmentChip
          v-for="seg in cell.segments.slice(0, 2)"
          :key="seg.segmentId + '-' + seg.kind"
          :occurrence="seg"
          @click="(vid, sidx) => emit('view-segment', vid, sidx)"
        />
        <span
          v-if="cell.segments.length > 2"
          class="text-secondary-500/40 text-[0.5625rem]"
          aria-hidden="true"
        >
          +{{ cell.segments.length - 2 }}
        </span>
      </div>

      <!-- Empty-day collapse (mobile only): a thin "nothing planned" line so
           busy days stand out in the agenda. Today is never collapsed. -->
      <span
        v-if="isEmptyDay && !cell.isToday"
        class="font-inter text-secondary-500/40 self-start text-xs italic md:hidden dark:text-gray-600"
      >
        {{ t('planner.nothingPlanned') }}
      </span>

      <!-- Vacation band (anchored to bottom of cell on desktop, inline on mobile).
           Rounds only the trip's outer ends so a multi-day trip reads as one
           connected band across its cells. -->
      <div class="hidden flex-1 md:block" />
      <div
        v-for="vac in cell.vacations"
        :key="vac.id"
        class="w-full cursor-pointer overflow-hidden"
        :class="
          vac.isStart && vac.isEnd
            ? 'rounded-md'
            : vac.isStart
              ? 'rounded-l-md'
              : vac.isEnd
                ? 'rounded-r-md'
                : 'rounded-none'
        "
        style="background: rgb(0 180 216 / 12%)"
        @click.stop="emit('vacation-click', vac.id)"
      >
        <span
          v-if="vac.isStart"
          class="font-outfit block truncate px-1 text-[0.625rem] leading-tight font-bold text-[#0077B6] dark:text-[#00B4D8]"
        >
          {{ vac.emoji }} {{ vac.name }}
        </span>
        <span v-else class="block h-[10px]" />
      </div>
    </div>
  </button>
</template>
