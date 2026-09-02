<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import { useActivityIdentity } from '@/composables/useActivityIdentity';

import { toDateInputValue, formatNookDate, formatTime12 } from '@/utils/date';
import { useClash } from '@/composables/useClash';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';
import ClashIndicator from '@/components/planner/ClashIndicator.vue';
import type { FamilyActivity } from '@/types/models';

const { t } = useTranslation();
const { describeActivity } = useRecurrenceLabel();

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

const { identityFor } = useActivityIdentity();

/** One classification per card, not one per binding. */
const identity = computed(() => identityFor(props.activity));
</script>

<template>
  <button
    type="button"
    class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white px-3 py-2.5 text-left shadow-[0_4px_20px_rgba(44,62,80,0.05)] transition-all hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)] dark:bg-slate-800"
    :class="[
      identity.dashed ? 'border-dashed' : '',
      identity.celebration.celebrating ? 'is-celebration' : '',
    ]"
    :data-sticker="identity.sticker"
    :style="identity.edgeStyle"
    @click="$emit('click')"
  >
    <!-- Category icon -->
    <span class="flex-shrink-0 text-base leading-none">
      {{ identity.emoji }}
    </span>

    <div class="min-w-0 flex-1">
      <!-- Line 1: Title + photo indicator + optional date -->
      <div class="flex items-center justify-between gap-2">
        <h4
          class="font-outfit text-secondary-500 flex min-w-0 items-center truncate text-sm font-semibold dark:text-gray-100"
        >
          <span class="truncate">{{ activity.title }}</span>
          <PhotoIndicator :photo-ids="activity.photoIds" />
          <ClashIndicator :clash="clash" class="ml-1.5" />
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
        <!--
          #70: was `t('planner.recurrence.' + activity.recurrence)` — a translated
          enum, so an every-3-weeks rule printed "Weekly". Now the canonical
          summary, truncated because this chip sits in a dense row, with the full
          text on hover. `activity.recurrence !== 'none'` stays the visibility
          gate: that bit of the shadow is faithful for every rule (see the
          fidelity contract in adapters.ts).
        -->
        <span
          v-if="activity.recurrence !== 'none'"
          class="bg-sky-silk-300/20 text-secondary-500/50 dark:bg-sky-silk-300/10 max-w-[10rem] truncate rounded-full px-1.5 py-px text-xs font-semibold dark:text-gray-400"
          :title="describeActivity(activity)"
        >
          {{ describeActivity(activity) }}
        </span>
        <span
          v-if="showReminder && activity.reminderMinutes > 0"
          class="text-secondary-500/30 text-xs dark:text-gray-500"
          :title="t('planner.reminderSet')"
          aria-hidden="true"
        >
          <!-- eslint-disable vue/no-bare-strings-in-template -->
          &#x1F514;
          <!-- eslint-enable vue/no-bare-strings-in-template -->
        </span>
        <span class="flex-1" />
        <ActivityOwnerStack :members="identity.stackMembers" size="sm" />
      </div>
    </div>
  </button>
</template>
