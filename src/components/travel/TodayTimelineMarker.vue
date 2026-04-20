<script setup lang="ts">
/**
 * "You are here" rail marker for the trip timeline. Slots between
 * past-day groups and today's group (or stands alone at the correct
 * rail position if today is a free day with no segments).
 *
 * Heritage Orange accent is intentional — it's the only orange element
 * on the vacation-teal surface, so it's impossible to miss without
 * being loud about it. A subtle pulse on the rail diamond reinforces
 * "this is live, this is right now" and respects `prefers-reduced-motion`.
 *
 * Day number + total days give trip-relative scale ("Day 4 of 10")
 * independent of the calendar date, which is genuinely useful on a
 * multi-day trip.
 */
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort } from '@/utils/date';

interface Props {
  date: string;
  dayNumber: number;
  totalDays: number;
  isFreeDay: boolean;
}
const props = defineProps<Props>();

const { t } = useTranslation();
</script>

<template>
  <div class="today-marker relative my-4">
    <!-- Rail diamond node (aligns with the timeline vertical line at -33px) -->
    <div
      class="today-marker-node absolute top-1/2 -left-[37px] z-[3] h-3 w-3 -translate-y-1/2 rotate-45 rounded-[2px] bg-[var(--heritage-orange)]"
      aria-hidden="true"
    />

    <!-- Main bar -->
    <div
      class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--heritage-orange)]/30 bg-gradient-to-r from-[rgba(241,93,34,0.10)] via-[rgba(241,93,34,0.05)] to-transparent px-4 py-2.5"
      role="status"
      :aria-label="`${t('travel.today.label')} — ${formatDateShort(props.date)}`"
    >
      <div class="flex min-w-0 items-baseline gap-2">
        <span
          class="font-outfit text-[10px] font-bold tracking-[0.16em] whitespace-nowrap text-[var(--heritage-orange)] uppercase"
        >
          ● {{ t('travel.today.label') }}
        </span>
        <span
          class="font-outfit text-xs font-semibold whitespace-nowrap text-[var(--color-text)] dark:text-gray-100"
        >
          {{ formatDateShort(props.date) }}
        </span>
        <span
          v-if="props.isFreeDay"
          class="font-outfit truncate text-xs text-[var(--color-text-muted)] italic"
        >
          · {{ t('travel.today.freeDay') }}
        </span>
      </div>
      <span
        class="font-outfit flex-shrink-0 text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap text-[var(--heritage-orange)]/80 uppercase"
      >
        {{ t('travel.today.dayPrefix') }} {{ props.dayNumber }} {{ t('travel.today.of') }}
        {{ props.totalDays }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Rail-node pulse — hex literal rather than CSS var since browsers don't
   interpolate vars inside keyframes reliably. Heritage Orange = #F15D22. */
@keyframes today-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 3px var(--color-bg, #fff),
      0 0 0 5px rgb(241 93 34 / 40%);
  }

  50% {
    box-shadow:
      0 0 0 3px var(--color-bg, #fff),
      0 0 0 9px rgb(241 93 34 / 10%);
  }
}

.today-marker-node {
  box-shadow:
    0 0 0 3px var(--color-bg, #fff),
    0 0 0 5px rgb(241 93 34 / 40%);
}

@media (prefers-reduced-motion: no-preference) {
  .today-marker-node {
    animation: today-pulse 2s ease-in-out infinite;
  }
}
</style>
