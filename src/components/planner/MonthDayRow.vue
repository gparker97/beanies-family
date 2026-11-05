<script setup lang="ts">
/**
 * The phone month grid's open day (#141): a full-width row rendered directly under the
 * tapped day's week, with the whole day at full anatomy. A second tap on the same day
 * opens the Day view; the header says so. The header's close button (`close`) folds the
 * row back to the plain grid; the grid owns what closing does (and where focus goes).
 *
 * Small and presentational. The grid derives `cell` live from the selected date (so a
 * store change re-renders it, and a date that leaves the grid unrenders it) and binds
 * the row's `id` by attribute fallthrough: the cell's `aria-controls` names it, and the
 * grid scrolls it into view by that id (a template ref inside the week `v-for` would be
 * an array).
 *
 * It is a SIBLING of the week rows, so it inherits none of the cells' `--mg-*` heights
 * or their month chip context; `MonthDayContents` provides full anatomy itself, with
 * start times. Its list is capped (`PHONE_DAY_ROW_CAPS`) so the grid can make room for
 * the row without scrolling (the fit subtracts its height as an inset); "+N more"
 * emits `more`, which the grid treats as the second tap (the Day view).
 */
import { useTranslation } from '@/composables/useTranslation';
import { formatTodayCaption } from '@/utils/date';
import { dayCountLabel } from '@/utils/monthDayItems';
import type { MonthDayCellData } from '@/utils/monthCells';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import type { HolidayOccurrence } from '@/types/models';
import MonthDayContents from '@/components/planner/MonthDayContents.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { FOCUS_RING } from '@/constants/tileStyles';
import { PHONE_DAY_ROW_CAPS } from '@/constants/calendarCaps';

defineProps<{ cell: MonthDayCellData }>();

const emit = defineEmits<{
  'view-activity': [activityId: string, date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'holiday-click': [holiday: HolidayOccurrence];
  'birthday-click': [birthday: BirthdayOccurrence];
  /** The header's close button: fold the row back to the plain grid. */
  close: [];
  /** The capped list's "+N more": the grid opens the Day view. */
  more: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <div
    class="dark:border-line dark:bg-surface-raised border-y border-[var(--color-border)] bg-white px-3 pt-2 pb-2.5"
    data-testid="month-day-row"
  >
    <div class="mb-1 flex items-center gap-2">
      <p
        class="font-outfit text-secondary-500 dark:text-ink flex min-w-0 flex-1 items-baseline gap-2 text-sm font-bold"
      >
        {{ formatTodayCaption(cell.date) }}
        <span class="text-xs font-medium text-[var(--muted-text)]"
          >{{ dayCountLabel(cell, t) }} · {{ t('planner.dayRow.tapAgain') }}</span
        >
      </p>
      <!-- A 44px target with negative margins, so the header keeps its height. -->
      <button
        type="button"
        class="group text-secondary-500 dark:text-ink-soft -my-2.5 -mr-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors motion-reduce:transition-none"
        :class="FOCUS_RING"
        :aria-label="t('planner.dayRow.close')"
        :title="t('planner.dayRow.close')"
        data-testid="month-day-row-close"
        @click="emit('close')"
      >
        <span
          class="dark:bg-surface-overlay dark:group-hover:bg-surface-hover inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--tint-slate-5)] group-hover:bg-[var(--tint-slate-10)]"
          aria-hidden="true"
        >
          <BeanieIcon name="close" size="sm" />
        </span>
      </button>
    </div>
    <MonthDayContents
      :cell="cell"
      :caps="PHONE_DAY_ROW_CAPS"
      @more="emit('more')"
      @view-activity="(id, date) => emit('view-activity', id, date)"
      @vacation-click="(vid) => emit('vacation-click', vid)"
      @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
      @holiday-click="(h) => emit('holiday-click', h)"
      @birthday-click="(b) => emit('birthday-click', b)"
    />
  </div>
</template>
