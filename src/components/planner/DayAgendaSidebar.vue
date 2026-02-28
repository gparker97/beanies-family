<script setup lang="ts">
import { computed } from 'vue';
import BaseSidePanel from '@/components/ui/BaseSidePanel.vue';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { toDateInputValue as formatDate } from '@/utils/date';
import type { ActivityRecurrence } from '@/types/models';

const props = defineProps<{
  date: string;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'add-activity': [];
  'edit-activity': [id: string];
}>();

const { t } = useTranslation();
const { getMemberName, getMemberColor } = useMemberInfo();
const activityStore = useActivityStore();

/** Format the selected date as a readable header (e.g. "Saturday, March 15") */
const dateHeader = computed(() => {
  const d = new Date(props.date + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
});

/** Activities for the selected day, sorted by startTime */
const dayActivities = computed(() => {
  const d = new Date(props.date + 'T00:00:00');
  const year = d.getFullYear();
  const month = d.getMonth();
  const occurrences = activityStore.monthActivities(year, month);
  return occurrences
    .filter((o) => o.date === props.date)
    .sort((a, b) => (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? ''));
});

/** Upcoming activities in the next 14 days after the selected date */
const upcomingActivities = computed(() => {
  const start = new Date(props.date + 'T00:00:00');
  const nextDay = new Date(start);
  nextDay.setDate(nextDay.getDate() + 1);
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + 14);

  const results: { activity: (typeof dayActivities.value)[0]['activity']; date: string }[] = [];

  // We need to check up to 2 months to cover the 14-day window
  for (let i = 0; i < 2; i++) {
    const y = nextDay.getFullYear();
    const m = nextDay.getMonth() + i;
    const occurrences = activityStore.monthActivities(y, m);
    for (const occ of occurrences) {
      if (occ.date > props.date && occ.date <= formatDate(endDate)) {
        results.push(occ);
      }
    }
  }

  results.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? '');
  });

  // Deduplicate by activity id + date
  const seen = new Set<string>();
  return results
    .filter((r) => {
      const key = `${r.activity.id}-${r.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
});

function formatDisplayDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function recurrenceLabel(recurrence: ActivityRecurrence) {
  return t(`planner.recurrence.${recurrence}` as const);
}
</script>

<template>
  <BaseSidePanel :open="open" :title="t('planner.dayAgenda')" @close="emit('close')">
    <!-- Date header -->
    <div class="mb-5">
      <h3 class="font-outfit text-base font-bold text-[#2C3E50] dark:text-gray-100">
        {{ dateHeader }}
      </h3>
    </div>

    <!-- Day's activities -->
    <div v-if="dayActivities.length > 0" class="space-y-1.5">
      <button
        v-for="(occ, i) in dayActivities"
        :key="`${occ.activity.id}-${i}`"
        type="button"
        class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white px-3 py-2.5 text-left shadow-[0_4px_20px_rgba(44,62,80,0.05)] transition-all hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)] dark:bg-slate-700"
        :style="{ borderLeftColor: getActivityColor(occ.activity) }"
        @click="emit('edit-activity', occ.activity.id)"
      >
        <!-- Category dot -->
        <span
          class="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
          :style="{ backgroundColor: getActivityColor(occ.activity) }"
        />

        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <h4
              class="font-outfit truncate text-sm font-semibold text-[#2C3E50] dark:text-gray-100"
            >
              {{ occ.activity.title }}
            </h4>
          </div>

          <div class="mt-0.5 flex items-center gap-2">
            <span v-if="occ.activity.startTime" class="text-xs font-medium text-[#F15D22]">
              {{ occ.activity.startTime
              }}{{ occ.activity.endTime ? ` - ${occ.activity.endTime}` : '' }}
            </span>
            <span
              v-if="occ.activity.recurrence !== 'none'"
              class="rounded-full bg-[#AED6F1]/20 px-1.5 py-px text-[0.6rem] font-semibold text-[#2C3E50]/50 dark:bg-[#AED6F1]/10 dark:text-gray-400"
            >
              {{ recurrenceLabel(occ.activity.recurrence) }}
            </span>
            <span class="flex-1" />
            <span
              v-if="occ.activity.assigneeId"
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-medium text-white"
              :style="{ backgroundColor: getMemberColor(occ.activity.assigneeId) }"
            >
              {{ getMemberName(occ.activity.assigneeId) }}
            </span>
          </div>
        </div>
      </button>
    </div>

    <!-- Empty state -->
    <div v-else class="rounded-2xl bg-gray-50 py-8 text-center dark:bg-slate-700/50">
      <p class="text-sm text-[#2C3E50]/40 dark:text-gray-500">
        {{ t('planner.noActivitiesForDay') }}
      </p>
    </div>

    <!-- Add Activity button -->
    <button
      type="button"
      class="font-outfit mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#F15D22] to-[#E67E22] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
      @click="emit('add-activity')"
    >
      {{ t('planner.addActivity') }}
    </button>

    <!-- Upcoming activities after this day -->
    <div v-if="upcomingActivities.length > 0" class="mt-8">
      <h3 class="font-outfit mb-3 text-base font-bold text-[#2C3E50] dark:text-gray-100">
        {{ t('planner.upcomingAfterDay') }}
      </h3>

      <div class="space-y-1.5">
        <button
          v-for="(occ, i) in upcomingActivities"
          :key="`upcoming-${occ.activity.id}-${occ.date}-${i}`"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white px-3 py-2.5 text-left shadow-[0_4px_20px_rgba(44,62,80,0.05)] transition-all hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)] dark:bg-slate-700"
          :style="{ borderLeftColor: getActivityColor(occ.activity) }"
          @click="emit('edit-activity', occ.activity.id)"
        >
          <span
            class="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
            :style="{ backgroundColor: getActivityColor(occ.activity) }"
          />

          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <h4
                class="font-outfit truncate text-sm font-semibold text-[#2C3E50] dark:text-gray-100"
              >
                {{ occ.activity.title }}
              </h4>
              <span class="flex-shrink-0 text-xs text-[#2C3E50]/40 dark:text-gray-500">
                {{ formatDisplayDate(occ.date) }}
              </span>
            </div>

            <div class="mt-0.5 flex items-center gap-2">
              <span v-if="occ.activity.startTime" class="text-xs font-medium text-[#F15D22]">
                {{ occ.activity.startTime }}
              </span>
              <span
                v-if="occ.activity.recurrence !== 'none'"
                class="rounded-full bg-[#AED6F1]/20 px-1.5 py-px text-[0.6rem] font-semibold text-[#2C3E50]/50 dark:bg-[#AED6F1]/10 dark:text-gray-400"
              >
                {{ recurrenceLabel(occ.activity.recurrence) }}
              </span>
              <span class="flex-1" />
              <span
                v-if="occ.activity.assigneeId"
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-medium text-white"
                :style="{ backgroundColor: getMemberColor(occ.activity.assigneeId) }"
              >
                {{ getMemberName(occ.activity.assigneeId) }}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </BaseSidePanel>
</template>
