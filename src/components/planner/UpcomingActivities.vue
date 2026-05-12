<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';
import { toDateInputValue, formatNookDate, addDays } from '@/utils/date';
import ActivityListCard from '@/components/planner/ActivityListCard.vue';
import type { HolidayOccurrence } from '@/types/models';

const activityStore = useActivityStore();
const holidayStore = useHolidayStore();
const { t } = useTranslation();

const emit = defineEmits<{
  edit: [id: string, date: string];
  'holiday-click': [holiday: HolidayOccurrence];
}>();

/** Public holidays in the next 30 days (read-only; empty when no country set). */
const upcomingHolidays = computed<HolidayOccurrence[]>(() => {
  const today = toDateInputValue(new Date());
  const end = toDateInputValue(addDays(new Date(), 30));
  return holidayStore.holidaysInRange(today, end);
});

const PAGE_SIZE = 6;
const visibleCount = ref(PAGE_SIZE);

const upcoming = computed(() => activityStore.upcomingActivities);
const visibleUpcoming = computed(() => upcoming.value.slice(0, visibleCount.value));
const hasMore = computed(() => upcoming.value.length > visibleCount.value);

/** Group visible upcoming activities by date */
const groupedUpcoming = computed(() => {
  const groups: { date: string; label: string; items: typeof visibleUpcoming.value }[] = [];
  let currentDate = '';

  for (const occ of visibleUpcoming.value) {
    if (occ.date !== currentDate) {
      currentDate = occ.date;
      groups.push({ date: occ.date, label: formatGroupDate(occ.date), items: [] });
    }
    groups[groups.length - 1]!.items.push(occ);
  }

  return groups;
});

function formatGroupDate(dateStr: string): string {
  const today = toDateInputValue(new Date());
  if (dateStr === today) return t('date.today');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === toDateInputValue(tomorrow)) return t('date.tomorrow');
  return formatNookDate(dateStr);
}

function showMore() {
  visibleCount.value += PAGE_SIZE;
}
</script>

<template>
  <div>
    <!-- Upcoming public holidays (next 30 days) -->
    <div v-if="upcomingHolidays.length > 0" class="mb-4">
      <h3 class="font-outfit text-secondary-500 mb-2 text-base font-bold dark:text-gray-100">
        {{ t('holiday.upcomingHeading') }}
      </h3>
      <div class="space-y-1.5">
        <button
          v-for="(h, i) in upcomingHolidays"
          :key="`${h.date}-${i}`"
          type="button"
          class="font-outfit flex w-full cursor-pointer items-center gap-2 rounded-xl bg-[var(--holiday-clay-tint)] px-2.5 py-1.5 text-left text-sm text-[var(--holiday-clay)] transition-opacity hover:opacity-80"
          @click="emit('holiday-click', h)"
        >
          <span class="min-w-0 flex-1 truncate font-semibold"
            >{{ h.name }} ({{ h.countryCode }})</span
          >
          <span class="flex-shrink-0 text-xs opacity-70">{{ formatGroupDate(h.date) }}</span>
        </button>
      </div>
    </div>

    <h3 class="font-outfit text-secondary-500 mb-3 text-base font-bold dark:text-gray-100">
      {{ t('planner.upcoming') }}
    </h3>

    <div
      v-if="upcoming.length === 0"
      class="rounded-3xl bg-white p-6 text-center shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    >
      <p class="text-secondary-500/40 text-sm dark:text-gray-500">{{ t('planner.noUpcoming') }}</p>
    </div>

    <div v-else class="space-y-3">
      <div v-for="group in groupedUpcoming" :key="group.date">
        <!-- Date header -->
        <p
          class="font-outfit text-secondary-500/50 mb-1.5 text-xs font-semibold tracking-wide uppercase dark:text-gray-500"
        >
          {{ group.label }}
        </p>
        <div class="space-y-1.5">
          <ActivityListCard
            v-for="(occ, i) in group.items"
            :key="`${occ.activity.id}-${occ.date}-${i}`"
            :activity="occ.activity"
            :date="occ.date"
            show-reminder
            @click="emit('edit', occ.activity.id, occ.date)"
          />
        </div>
      </div>

      <!-- View more -->
      <button
        v-if="hasMore"
        type="button"
        class="text-primary-500 hover:bg-primary-500/5 mt-2 w-full cursor-pointer rounded-2xl py-2 text-center text-sm font-semibold transition-colors"
        @click="showMore"
      >
        {{ t('planner.viewMore') }}
      </button>
    </div>
  </div>
</template>
