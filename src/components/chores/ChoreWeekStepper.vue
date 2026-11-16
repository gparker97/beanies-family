<script setup lang="ts">
/**
 * Stars and rewards (#148): a grown-up's week stepper, on the Choreboard's Chores view and the
 * Star Report. The label ("This week" / "Last week" from `relativeWeekLabelKey`, beside the
 * week's dates) and the EXISTING period navigator (`planner/CalendarPeriodNav`) with its three
 * optional props: "previous" is disabled on the oldest week offered, "next" on this week, and the
 * middle button reads "Back to This Week" while stepped back (hidden on this week).
 *
 * The stepper decides nothing: it walks the list it is given (`weeks`, newest first, from
 * `starStore.lookbackWeeks`) and cannot leave it. A value that is not in the list reads as the
 * newest week. Page state only (a `v-model`), never a URL parameter: a reload returns to this week.
 *
 * Dark mode: the arrows and the middle button are `CalendarPeriodNav`'s own (a disabled arrow
 * `secondary-400` / `ink-faint`); the label is `secondary-500` / `ink`, the dates `secondary-400` /
 * `ink-faint`. Nothing is painted behind it.
 */
import { computed } from 'vue';
import CalendarPeriodNav from '@/components/planner/CalendarPeriodNav.vue';
import { formatWeekRange } from '@/composables/useCalendarNavigation';
import { useTranslation } from '@/composables/useTranslation';
import { relativeWeekLabelKey } from '@/utils/calendarWeek';
import { parseLocalDate } from '@/utils/date';
import { shiftChoreDay } from '@/utils/chores';

const props = defineProps<{
  /** The week starts offered, newest first (this week, then back). */
  weeks: readonly string[];
  /** The week start showing. */
  modelValue: string;
  todayYmd: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [weekStart: string] }>();

const { t } = useTranslation();

const index = computed(() => Math.max(0, props.weeks.indexOf(props.modelValue)));
const current = computed(() => props.weeks[index.value] ?? props.modelValue);
const isNewest = computed(() => index.value === 0);
const isOldest = computed(() => index.value >= props.weeks.length - 1);

const relative = computed(() => {
  if (!current.value) return '';
  const key = relativeWeekLabelKey(current.value, shiftChoreDay(current.value, 6), props.todayYmd);
  return key === 'planner.weekThis' || key === 'planner.weekLast' ? t(key) : '';
});
const range = computed(() =>
  current.value
    ? formatWeekRange(
        parseLocalDate(current.value),
        parseLocalDate(shiftChoreDay(current.value, 6)),
        false
      )
    : ''
);

function go(i: number): void {
  const next = props.weeks[i];
  if (next !== undefined && next !== current.value) emit('update:modelValue', next);
}
</script>

<template>
  <div
    class="flex min-w-0 items-center gap-1"
    data-testid="chore-week-stepper"
    :data-week="current"
  >
    <p class="font-outfit min-w-0 truncate text-sm" data-testid="chore-week-stepper-label">
      <b v-if="relative" class="text-secondary-500 dark:text-ink mr-1.5 font-bold">{{
        relative
      }}</b>
      <span class="text-secondary-400 dark:text-ink-faint">{{ range }}</span>
    </p>
    <CalendarPeriodNav
      :prev-disabled="isOldest"
      :next-disabled="isNewest"
      :today-label="isNewest ? null : t('choreStars.week.backToThis')"
      @prev="go(index + 1)"
      @next="go(index - 1)"
      @today="go(0)"
    />
  </div>
</template>
