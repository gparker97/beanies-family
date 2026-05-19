<script setup lang="ts">
/**
 * 2-week date navigator that sits above the weekly timeline. Each day is
 * a compact pill (DOW + day-number + event-density dots) aligned to the
 * timeline columns below. Today is highlighted in Heritage Orange; the
 * row representing the currently-focused week gets a left accent strip
 * and a soft Sky-Silk ring on its pills so users can see "this is the
 * week you're looking at" at a glance.
 *
 * Added in Phase B of the calendar refactor so the weekly view answers
 * "what's the shape of the next two weeks?" without forcing the user
 * into the monthly view. Renders on desktop AND mobile — on mobile it
 * complements (not replaces) the existing pill-strip + single-day
 * timeline pattern.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

export interface WeekStripDay {
  dateStr: string;
  dayNum: number;
  dowLabel: string;
  isToday: boolean;
  isOutsideCurrentMonth?: boolean;
  /** Up to N distinct member colors for the dot-density indicator. */
  memberColors: string[];
  /** Count of members beyond what fits in `memberColors`. */
  moreCount: number;
}

export interface WeekStripWeek {
  /** Translation-key label that prefixes the row ("this week", "next week", "upcoming"). */
  labelKey: 'planner.weekThis' | 'planner.weekNext' | 'planner.weekUpcoming';
  /** Optional "wk 21" ISO week number rendered below the label. */
  weekNumberLabel?: string;
  /** Whether this is the week currently shown in the timeline below. */
  isFocused: boolean;
  days: WeekStripDay[];
}

const props = defineProps<{
  weeks: WeekStripWeek[];
}>();

const emit = defineEmits<{
  'select-date': [dateStr: string];
}>();

const { t } = useTranslation();

const hasContent = computed(() => props.weeks.length > 0);

function onDayClick(dateStr: string) {
  emit('select-date', dateStr);
}
</script>

<template>
  <div v-if="hasContent" class="flex flex-col gap-1.5 px-2 pt-3 pb-2 md:px-3 md:pt-3 md:pb-2">
    <div
      v-for="(week, wi) in weeks"
      :key="wi"
      class="grid items-stretch gap-1 md:gap-1.5"
      :class="
        week.isFocused
          ? 'grid-cols-[64px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)]'
          : 'grid-cols-[64px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)]'
      "
    >
      <!-- Row label + (optional) week number, with an orange accent stripe
           on the currently-focused week. -->
      <div
        class="font-outfit flex flex-col justify-center pr-2 text-right leading-tight"
        :class="
          week.isFocused
            ? 'text-primary-500 relative pl-2'
            : 'text-secondary-500/50 dark:text-gray-500'
        "
      >
        <span
          v-if="week.isFocused"
          class="bg-primary-500 absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full"
          aria-hidden="true"
        />
        <span class="text-[0.625rem] font-bold tracking-[0.12em] uppercase">
          {{ t(week.labelKey) }}
        </span>
        <span v-if="week.weekNumberLabel" class="text-[0.625rem] font-medium opacity-70">
          {{ week.weekNumberLabel }}
        </span>
      </div>

      <!-- Day pills, one per visible day. -->
      <button
        v-for="day in week.days"
        :key="day.dateStr"
        type="button"
        class="font-outfit flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 py-1 transition-colors md:min-h-[48px]"
        :class="[
          day.isToday
            ? 'border-primary-500 bg-primary-500/10 text-primary-500'
            : week.isFocused
              ? 'text-secondary-500 border-sky-200/60 bg-white hover:border-sky-300 dark:border-slate-600/60 dark:bg-slate-700/60 dark:text-gray-200'
              : 'text-secondary-500/70 border-gray-200/60 bg-white hover:border-gray-300 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-gray-400',
          day.isOutsideCurrentMonth ? 'opacity-60' : '',
        ]"
        :aria-label="`${day.dowLabel} ${day.dayNum}`"
        @click="onDayClick(day.dateStr)"
      >
        <span class="text-[0.5625rem] font-bold tracking-[0.12em] uppercase opacity-70">
          {{ day.dowLabel }}
        </span>
        <span class="text-sm leading-none font-semibold">
          {{ day.dayNum }}
        </span>
        <!-- Event-density dots — same grammar as the chip member-color bars. -->
        <div
          v-if="day.memberColors.length > 0 || day.moreCount > 0"
          class="mt-0.5 flex h-1.5 items-center gap-[2px]"
          aria-hidden="true"
        >
          <span
            v-for="(color, i) in day.memberColors"
            :key="i"
            class="h-1 w-1 rounded-full"
            :style="{ backgroundColor: color }"
          />
          <span
            v-if="day.moreCount > 0"
            class="text-secondary-500/40 text-[0.5rem] leading-none font-semibold dark:text-gray-500"
          >
            +{{ day.moreCount }}
          </span>
        </div>
        <div v-else class="mt-0.5 h-1.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
