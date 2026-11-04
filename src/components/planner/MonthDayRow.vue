<script setup lang="ts">
/**
 * The phone month grid's open day (#141): a full-width row rendered directly under the
 * tapped day's week, with the whole day at full anatomy. A second tap on the same day
 * opens the Day view; the header says so.
 *
 * Small and presentational. The grid derives `cell` live from the selected date (so a
 * store change re-renders it, and a date that leaves the grid unrenders it) and binds
 * the row's `id` by attribute fallthrough: the cell's `aria-controls` names it, and the
 * grid scrolls it into view by that id (a template ref inside the week `v-for` would be
 * an array).
 *
 * It is a SIBLING of the week rows, so it inherits none of the cells' `--mg-*` heights
 * or their month chip context; `MonthDayContents` provides full anatomy itself.
 */
import { useTranslation } from '@/composables/useTranslation';
import { formatTodayCaption } from '@/utils/date';
import { dayCountLabel } from '@/utils/monthDayItems';
import type { MonthDayCellData } from '@/utils/monthCells';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import type { HolidayOccurrence } from '@/types/models';
import MonthDayContents from '@/components/planner/MonthDayContents.vue';

defineProps<{ cell: MonthDayCellData }>();

const emit = defineEmits<{
  'view-activity': [activityId: string, date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'holiday-click': [holiday: HolidayOccurrence];
  'birthday-click': [birthday: BirthdayOccurrence];
}>();

const { t } = useTranslation();
</script>

<template>
  <div
    class="dark:border-line dark:bg-surface-raised border-y border-[var(--color-border)] bg-white px-3 pt-2 pb-2.5"
    data-testid="month-day-row"
  >
    <p
      class="font-outfit text-secondary-500 dark:text-ink mb-1 flex items-baseline gap-2 text-sm font-bold"
    >
      {{ formatTodayCaption(cell.date) }}
      <span class="text-xs font-medium text-[var(--muted-text)]"
        >{{ dayCountLabel(cell, t) }} · {{ t('planner.dayRow.tapAgain') }}</span
      >
    </p>
    <MonthDayContents
      :cell="cell"
      @view-activity="(id, date) => emit('view-activity', id, date)"
      @vacation-click="(vid) => emit('vacation-click', vid)"
      @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
      @holiday-click="(h) => emit('holiday-click', h)"
      @birthday-click="(b) => emit('birthday-click', b)"
    />
  </div>
</template>
