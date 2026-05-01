<script setup lang="ts">
/**
 * "You are here" marker that renders as a subordinate chip directly
 * underneath today's date header on the trip timeline. It does NOT
 * stand in for the date header — every day, including today, gets the
 * same rail circle + "Day N · Mon DD" header treatment, and this
 * marker simply adds the trip-relative context ("Day 4 of 10", or
 * "free day · Day 4 of 10") immediately below.
 *
 * Heritage Orange is intentional — it's the only orange element on the
 * vacation-teal surface, so it's impossible to miss without being loud.
 * Day number + total days give trip-relative scale that the calendar
 * date alone doesn't convey.
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
  <div
    class="today-marker mt-1 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--heritage-orange)]/30 bg-gradient-to-r from-[rgba(241,93,34,0.10)] via-[rgba(241,93,34,0.05)] to-transparent px-4 py-2"
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
        v-if="props.isFreeDay"
        class="font-outfit truncate text-xs text-[var(--color-text-muted)] italic"
      >
        {{ t('travel.today.freeDay') }}
      </span>
    </div>
    <span
      class="font-outfit flex-shrink-0 text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap text-[var(--heritage-orange)]/80 uppercase"
    >
      {{ t('travel.today.dayPrefix') }} {{ props.dayNumber }} {{ t('travel.today.of') }}
      {{ props.totalDays }}
    </span>
  </div>
</template>
