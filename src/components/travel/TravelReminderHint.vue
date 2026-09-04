<script setup lang="ts">
/**
 * Travel-plan creation hint (#55) — a quiet Sky-Silk line telling families a
 * departure reminder exists and where to tune it. Self-contained (reads the
 * device lead for the segment type) so it can drop into every travel-segment
 * form branch without duplicating the logic. Shown only for a travel type that
 * actually fires an OS reminder (SupportedTravelType) and only while reminders
 * are enabled.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatLeadLabel } from '@/utils/reminderSchedule';
import { isSupportedTravelType } from '@/utils/vacation';
import { REMINDERS_OPEN } from '@/constants/settingsDeepLinks';
import type { VacationTravelType } from '@/types/models';

const props = defineProps<{ type?: VacationTravelType }>();
const { t } = useTranslation();
const settingsStore = useSettingsStore();

const supported = computed(() => !!props.type && isSupportedTravelType(props.type));
const show = computed(() => supported.value && settingsStore.remindersEnabled);
const text = computed(() => {
  if (!props.type || !isSupportedTravelType(props.type)) return '';
  const lead = settingsStore.travelReminderLeads[props.type];
  return fillTemplate(t('reminders.travelHint'), { lead: formatLeadLabel(lead, t) });
});
</script>

<template>
  <div
    v-if="show"
    class="mt-1 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5"
    style="background-color: var(--tint-silk-20)"
  >
    <span class="text-sm" aria-hidden="true">🔔</span>
    <p class="dark:text-ink text-xs text-[var(--deep-slate)]">
      {{ text }}
      <!-- Deep-links straight into the Reminders drawer — reminders are their
           own Settings category now, so a bare /settings link would land the
           user on the grid with nothing obviously actionable. -->
      <RouterLink
        :to="{ path: '/settings', query: { open: REMINDERS_OPEN } }"
        class="font-semibold text-[var(--heritage-orange)]"
        >{{ t('reminders.travelHintLink') }}</RouterLink
      >
    </p>
  </div>
</template>
