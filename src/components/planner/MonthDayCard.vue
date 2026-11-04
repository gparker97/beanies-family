<script setup lang="ts">
/**
 * The mobile month stream's day card: the shell around one day (#141).
 *
 * It owns the date column (the day of week, the numeral, and today's caption and
 * marker), the today outline and wash, and the empty-today exception. The day's
 * contents come from `MonthDayContents` with the stream's fixed `STREAM_DAY_CAPS`, the
 * same list the desktop popover and the phone day row render, so the three cannot
 * order, cap or call a day empty differently.
 *
 * Only `CalendarMonthStream` mounts it, and only below 768px: the desktop grid draws its
 * own `MonthGridCell`s. So it carries no desktop markup and no day tint.
 *
 * Recorded follow-up: the root `<button>` still nests the chip buttons, as it always
 * has. The fix, when it is done, is to provide `MONTH_CELL_CHIPS` with `interactive:
 * false` here, as the phone grid cell does.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { parseLocalDate } from '@/utils/date';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import type { HolidayOccurrence } from '@/types/models';
import type { MonthDayCellData } from '@/utils/monthCells';
import { dayCount } from '@/utils/monthDayItems';
import { STREAM_DAY_CAPS } from '@/constants/calendarCaps';
import { CALENDAR_TODAY, calendarDayBackground } from '@/constants/tileStyles';
import MonthDayContents from '@/components/planner/MonthDayContents.vue';

const props = defineProps<{
  cell: MonthDayCellData;
}>();

const emit = defineEmits<{
  'select-date': [date: string];
  'view-activity': [activityId: string, date: string];
  'holiday-click': [holiday: HolidayOccurrence];
  /** A derived birthday was tapped — the parent opens the read-only drawer. */
  'birthday-click': [birthday: BirthdayOccurrence];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
}>();

const { t } = useTranslation();

// The DOW abbreviation uses the same translation keys as the grid's column headers, so
// beanie mode and future locales pick up the override automatically.
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

/** An empty today shows nothing beyond its "Today" caption: it keeps its outline, wash
 *  and caption, and never reads "Nothing planned". Every other empty day does. */
const showContents = computed(() => !(props.cell.isToday && dayCount(props.cell) === 0));

/**
 * Border and background of the card root. Each is ONE class set per property, so two
 * classes never compete for the same property through Tailwind's variant order.
 */
const borderClass = computed(() =>
  props.cell.isToday
    ? `border-2 ${CALENDAR_TODAY.outline}`
    : 'border border-gray-200/60 dark:border-line/60'
);
const backgroundClass = computed(() =>
  calendarDayBackground(undefined, props.cell.isToday, 'bg-white dark:bg-surface-raised/40')
);
</script>

<template>
  <button
    :data-date="cell.date"
    type="button"
    class="font-outfit text-secondary-500 dark:text-ink relative flex w-full min-w-0 cursor-pointer flex-row gap-3 rounded-xl p-2.5 text-left transition-colors"
    :class="[borderClass, backgroundClass]"
    :aria-current="cell.isToday ? 'date' : undefined"
    @click="emit('select-date', cell.date)"
  >
    <!-- DOW + day-number column on the left. Today's caption sits at the top so the row
         reads as today even when its contents are empty. -->
    <div class="flex w-10 flex-shrink-0 flex-col items-center gap-0.5 pt-0.5">
      <span v-if="cell.isToday" class="text-xs font-bold" :class="CALENDAR_TODAY.text">
        {{ t('planner.today') }}
      </span>
      <span
        class="text-xs font-bold tracking-[0.14em] uppercase"
        :class="
          cell.isToday ? CALENDAR_TODAY.text : 'dark:text-ink-faint text-[var(--color-text-muted)]'
        "
      >
        {{ dowLabel }}
      </span>
      <span
        class="text-lg leading-none font-semibold"
        :class="cell.isToday ? CALENDAR_TODAY.text : ''"
      >
        {{ cell.day }}
      </span>
    </div>

    <MonthDayContents
      v-if="showContents"
      :cell="cell"
      :caps="STREAM_DAY_CAPS"
      @more="emit('select-date', cell.date)"
      @view-activity="(id, date) => emit('view-activity', id, date)"
      @vacation-click="(vid) => emit('vacation-click', vid)"
      @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
      @holiday-click="(h) => emit('holiday-click', h)"
      @birthday-click="(b) => emit('birthday-click', b)"
    />
  </button>
</template>
