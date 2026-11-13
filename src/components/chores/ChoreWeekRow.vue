<script setup lang="ts">
/**
 * A bean's "This week" row on their day (#146): plain counts of chores done each day, today
 * ringed in Heritage Orange, days still to come shown as a dot, and the week's total beside one
 * small star. History the list itself cannot show. Stars count chores done; what a star is
 * worth is #148 and nothing here stores a value.
 *
 * Dark mode: each day is a `surface-overlay` tile with `ink` counts and `ink-faint` labels; the
 * today ring stays Heritage Orange (a UI outline, 4.40:1 on raised) and its label lifts.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { choreDayOfWeek, type ChoreWeekCounts } from '@/utils/chores';
import { fillTemplate } from '@/utils/fillTemplate';
import { CHORE_DAY_LABEL_KEYS } from '@/constants/choreBlocks';

const props = defineProps<{ week: ChoreWeekCounts; todayYmd: string }>();

const { t } = useTranslation();

const days = computed(() =>
  props.week.days.map((d) => ({
    ...d,
    label: t(CHORE_DAY_LABEL_KEYS[choreDayOfWeek(d.ymd)] ?? 'planner.day.mon'),
    isToday: d.ymd === props.todayYmd,
    isFuture: d.ymd > props.todayYmd,
  }))
);

const totalAria = computed(() =>
  fillTemplate(
    t(props.week.total === 1 ? 'choreboard.week.totalAria.one' : 'choreboard.week.totalAria.other'),
    { count: props.week.total }
  )
);
</script>

<template>
  <section data-testid="chore-week-row">
    <div class="mb-1.5 flex items-center gap-2">
      <h3
        class="font-outfit dark:text-ink-faint text-secondary-400 text-xs font-semibold tracking-[0.08em] uppercase"
      >
        {{ t('choreboard.week.title') }}
      </h3>
      <span class="flex-1" />
      <span
        class="font-outfit dark:text-ink-soft text-secondary-500 text-sm font-semibold"
        :aria-label="totalAria"
        data-testid="chore-week-total"
        ><span aria-hidden="true">⭐ {{ week.total }}</span></span
      >
    </div>
    <ol class="grid grid-cols-7 gap-1">
      <li
        v-for="d in days"
        :key="d.ymd"
        class="font-outfit dark:bg-surface-overlay rounded-2xl bg-white py-1.5 text-center text-xs font-semibold"
        :class="
          d.isToday
            ? 'ring-primary-500 text-primary-700 dark:text-accent-lift ring-2'
            : 'dark:text-ink-faint text-secondary-400'
        "
        data-testid="chore-week-day"
        :data-ymd="d.ymd"
        :aria-current="d.isToday ? 'date' : undefined"
      >
        {{ d.label }}
        <b
          class="block text-base leading-tight font-extrabold"
          :class="
            d.isFuture
              ? 'dark:text-ink-faint text-secondary-400'
              : 'dark:text-ink text-secondary-500'
          "
          >{{ d.isFuture ? '·' : d.count }}</b
        >
      </li>
    </ol>
  </section>
</template>
