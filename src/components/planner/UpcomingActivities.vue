<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import type { ActivityRecurrence } from '@/types/models';

const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const { t } = useTranslation();

const emit = defineEmits<{ edit: [id: string] }>();

const PAGE_SIZE = 6;
const visibleCount = ref(PAGE_SIZE);

const upcoming = computed(() => activityStore.upcomingActivities);
const visibleUpcoming = computed(() => upcoming.value.slice(0, visibleCount.value));
const hasMore = computed(() => upcoming.value.length > visibleCount.value);

function showMore() {
  visibleCount.value += PAGE_SIZE;
}

function getMemberName(id?: string) {
  if (!id) return null;
  return familyStore.members.find((m) => m.id === id)?.name ?? null;
}

function getMemberColor(id?: string) {
  if (!id) return '#95A5A6';
  return familyStore.members.find((m) => m.id === id)?.color ?? '#95A5A6';
}

function formatDisplayDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (dateStr === formatDate(today)) return 'Today';
  if (dateStr === formatDate(tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function recurrenceLabel(recurrence: ActivityRecurrence) {
  return t(`planner.recurrence.${recurrence}` as const);
}
</script>

<template>
  <div>
    <h3 class="font-outfit mb-3 text-base font-bold text-[#2C3E50] dark:text-gray-100">
      {{ t('planner.upcoming') }}
    </h3>

    <div
      v-if="upcoming.length === 0"
      class="rounded-3xl bg-white p-6 text-center shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    >
      <p class="text-sm text-[#2C3E50]/40 dark:text-gray-500">{{ t('planner.noUpcoming') }}</p>
    </div>

    <div v-else class="space-y-1.5">
      <button
        v-for="(occ, i) in visibleUpcoming"
        :key="`${occ.activity.id}-${occ.date}-${i}`"
        type="button"
        class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white px-3 py-2.5 text-left shadow-[0_4px_20px_rgba(44,62,80,0.05)] transition-all hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)] dark:bg-slate-800"
        :style="{ borderLeftColor: getActivityColor(occ.activity) }"
        @click="emit('edit', occ.activity.id)"
      >
        <!-- Category dot -->
        <span
          class="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
          :style="{ backgroundColor: getActivityColor(occ.activity) }"
        />

        <div class="min-w-0 flex-1">
          <!-- Line 1: Title + date -->
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

          <!-- Line 2: Time + recurrence + reminder + assignee -->
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
            <span
              v-if="occ.activity.reminderMinutes > 0"
              class="text-[0.6rem] text-[#2C3E50]/30 dark:text-gray-500"
              title="Reminder set"
            >
              &#x1F514;
            </span>
            <span class="flex-1" />
            <span
              v-if="getMemberName(occ.activity.assigneeId)"
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-medium text-white"
              :style="{ backgroundColor: getMemberColor(occ.activity.assigneeId) }"
            >
              {{ getMemberName(occ.activity.assigneeId) }}
            </span>
          </div>
        </div>
      </button>

      <!-- View more -->
      <button
        v-if="hasMore"
        type="button"
        class="mt-2 w-full cursor-pointer rounded-2xl py-2 text-center text-sm font-semibold text-[#F15D22] transition-colors hover:bg-[#F15D22]/5"
        @click="showMore"
      >
        {{ t('planner.viewMore') }}
      </button>
    </div>
  </div>
</template>
