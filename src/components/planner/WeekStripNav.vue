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
import SmoothHeight from '@/components/ui/SmoothHeight.vue';
import type { RelativeWeekLabelKey } from '@/utils/calendarWeek';

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
  /** Translation-key label that prefixes the row. Resolves to the row's
   *  position relative to today's week (see utils/calendarWeek — single
   *  source of truth, shared with the month-view week dividers). */
  labelKey: RelativeWeekLabelKey;
  /** Optional "wk 21" ISO week number rendered below the label. */
  weekNumberLabel?: string;
  /** Whether this is the week currently shown in the timeline below. */
  isFocused: boolean;
  days: WeekStripDay[];
}

const props = defineProps<{
  weeks: WeekStripWeek[];
  /**
   * The day currently "selected" in the timeline below — gets the strongest
   * highlight on its pill (filled orange background). Separate from "today",
   * which gets a subtler outline-only treatment so users can always see
   * where today is even when looking at a different week.
   */
  selectedDate?: string;
  /** When true (smart-collapse on scroll), show only the focused week so the
   *  day timeline below gets more room. Defaults to the full two weeks. */
  collapsed?: boolean;
}>();

const emit = defineEmits<{
  'select-date': [dateStr: string];
  /** Toggle the on-demand "peek" of the next week (1 ↔ 2 weeks). */
  'toggle-peek': [];
}>();

const { t } = useTranslation();

const hasContent = computed(() => props.weeks.length > 0);

// Collapsed → just the focused week (the one being viewed); expanded → both.
const visibleWeeks = computed(() => {
  if (!props.collapsed) return props.weeks;
  const focused = props.weeks.filter((w) => w.isFocused);
  return focused.length ? focused : props.weeks.slice(0, 1);
});

function onDayClick(dateStr: string) {
  emit('select-date', dateStr);
}
</script>

<template>
  <div v-if="hasContent" class="px-2 pt-3 pb-2 md:px-3 md:pt-3 md:pb-2">
    <SmoothHeight :revision="visibleWeeks.length" class="flex flex-col gap-1.5">
      <div
        v-for="(week, wi) in visibleWeeks"
        :key="(week.days[0]?.dateStr ?? '') + ':' + wi"
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
              : 'text-secondary-500/50 dark:text-ink-faint'
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

        <!-- Day pills, one per visible day. Visual hierarchy (strongest first):
           selected day (filled orange) > today (orange outline) > focused week
           pill (sky outline) > other week pill (neutral). -->
        <button
          v-for="day in week.days"
          :key="day.dateStr"
          type="button"
          class="font-outfit flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 py-1 transition-colors md:min-h-[48px]"
          :class="[
            day.dateStr === selectedDate
              ? 'border-primary-500 bg-primary-500 text-white shadow-[0_2px_8px_rgba(241,93,34,0.25)]'
              : day.isToday
                ? 'border-primary-500 bg-primary-500/10 text-primary-500'
                : week.isFocused
                  ? 'text-secondary-500 dark:border-line-strong/60 dark:bg-surface-overlay/60 dark:text-ink border-sky-200/60 bg-white hover:border-sky-300'
                  : 'text-secondary-500/70 dark:border-line/60 dark:bg-surface-raised/40 dark:text-ink-soft border-gray-200/60 bg-white hover:border-gray-300',
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
              class="text-[0.5rem] leading-none font-semibold"
              :class="
                day.dateStr === selectedDate
                  ? 'text-white/85'
                  : 'text-secondary-500/40 dark:text-ink-faint'
              "
            >
              +{{ day.moreCount }}
            </span>
          </div>
          <div v-else class="mt-0.5 h-1.5" aria-hidden="true" />
        </button>
      </div>
    </SmoothHeight>

    <!-- Peek toggle — reveal / hide the next week on demand. The strip
         defaults to just this week to save space. -->
    <button
      v-if="weeks.length > 1"
      type="button"
      class="font-outfit text-secondary-500/55 hover:text-primary-500 dark:text-ink-faint mt-1 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[0.625rem] font-bold tracking-[0.1em] uppercase transition-colors"
      @click="emit('toggle-peek')"
    >
      <span>{{ collapsed ? t('planner.peekNextWeek') : t('action.showLess') }}</span>
      <span aria-hidden="true">{{ collapsed ? '▾' : '▴' }}</span>
    </button>
  </div>
</template>
