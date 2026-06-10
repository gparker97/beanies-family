<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import { getActivityColor } from '@/stores/activityStore';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import { normalizeAssignees } from '@/utils/assignees';
import { toDateInputValue, formatNookDate, formatTime12 } from '@/utils/date';
import { useClash } from '@/composables/useClash';
import MemberChip from '@/components/ui/MemberChip.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';
import ClashIndicator from '@/components/planner/ClashIndicator.vue';
import type { FamilyActivity } from '@/types/models';

const { t } = useTranslation();

const props = withDefaults(
  defineProps<{
    activity: FamilyActivity;
    date: string;
    showDate?: boolean;
    showReminder?: boolean;
  }>(),
  { showDate: false, showReminder: false }
);

// External-calendar clash (#34) — undefined until/unless busy data lands for a
// clashing timed occurrence. Resolved through the single `useClash` seam.
const clash = useClash(
  () => props.activity.id,
  () => props.date
);

defineEmits<{ click: [] }>();

function formatDisplayDate(dateStr: string): string {
  const today = toDateInputValue(new Date());
  if (dateStr === today) return t('date.today');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === toDateInputValue(tomorrow)) return t('date.tomorrow');
  return formatNookDate(dateStr);
}
</script>

<template>
  <button
    type="button"
    class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white px-3 py-2.5 text-left shadow-[0_4px_20px_rgba(44,62,80,0.05)] transition-all hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)] dark:bg-slate-800"
    :style="{ borderLeftColor: getActivityColor(activity) }"
    @click="$emit('click')"
  >
    <!-- Category icon -->
    <span class="flex-shrink-0 text-base leading-none">
      {{ activity.icon ?? getActivityFallbackEmoji(activity.category) }}
    </span>

    <div class="min-w-0 flex-1">
      <!-- Line 1: Title + photo indicator + optional date -->
      <div class="flex items-center justify-between gap-2">
        <h4
          class="font-outfit text-secondary-500 flex min-w-0 items-center truncate text-sm font-semibold dark:text-gray-100"
        >
          <span class="truncate">{{ activity.title }}</span>
          <PhotoIndicator :photo-ids="activity.photoIds" />
          <ClashIndicator v-if="clash" :calendar-label="clash.calendarLabel" class="ml-1.5" />
        </h4>
        <span
          v-if="showDate"
          class="text-secondary-500/40 flex-shrink-0 text-xs dark:text-gray-500"
        >
          {{ formatDisplayDate(date) }}
        </span>
      </div>

      <!-- Line 2: Time + recurrence + reminder + assignees -->
      <div class="mt-0.5 flex items-center gap-2">
        <span v-if="activity.startTime" class="text-primary-500 text-xs font-medium">
          {{ formatTime12(activity.startTime)
          }}{{ activity.endTime ? ` - ${formatTime12(activity.endTime)}` : '' }}
        </span>
        <span v-else-if="activity.isAllDay" class="text-primary-500 text-xs font-medium">
          {{ t('planner.allDay') }}
        </span>
        <span
          v-if="activity.recurrence !== 'none'"
          class="bg-sky-silk-300/20 text-secondary-500/50 dark:bg-sky-silk-300/10 rounded-full px-1.5 py-px text-xs font-semibold dark:text-gray-400"
        >
          {{ t(`planner.recurrence.${activity.recurrence}`) }}
        </span>
        <span
          v-if="showReminder && activity.reminderMinutes > 0"
          class="text-secondary-500/30 text-xs dark:text-gray-500"
          title="Reminder set"
        >
          &#x1F514;
        </span>
        <span class="flex-1" />
        <MemberChip v-for="mid in normalizeAssignees(activity)" :key="mid" :member-id="mid" />
      </div>
    </div>
  </button>
</template>
