<script setup lang="ts">
/**
 * Settings → Reminders (#55) — device-scoped OS local-notification preferences.
 *
 * A card-opened DRAWER (same shape as `CalendarSyncSettings`), not an inline
 * panel: reminders are a configuration area with several controls, not a quick
 * toggle like sound effects or beanie mode, so they get their own category card
 * rather than sitting loose on the settings page.
 *
 * A master on/off toggle plus adjustable lead-times: per travel type (flights,
 * cruise, train, ferry) and one for timed to-dos. Activities keep their own
 * per-item reminder time (this row just links to the activity editor). Mirrors
 * the BeanieLabSection toggle-handler contract (persist via the store, which
 * toasts + re-throws; the control reads the persisted value so a failed write
 * self-heals).
 *
 * The MASTER TOGGLE governs OS notifications, which are native-only. The
 * LEAD-TIME selects apply on every platform: the to-do lead is honoured by the
 * in-app bell too (injected into the deriver as `todoLeadMinutes`), so nothing
 * here is an inert control on web.
 *
 * Permission state is read from `useNotificationPermission` — the shared module
 * the scheduler also writes to — rather than calling the plugin directly, so a
 * mid-session grant/revoke is reflected without a remount and this component
 * doesn't transitively pull in the whole scheduler.
 */
import { computed } from 'vue';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { isNative } from '@/services/sync/capabilities';
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import {
  notificationPermission,
  exactAlarmPermission,
  openExactAlarmSettings,
} from '@/composables/useNotificationPermission';
import { LEAD_OPTIONS, formatLeadLabel } from '@/utils/reminderSchedule';
import type { SupportedTravelType } from '@/types/models';

defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();

const remindersEnabled = computed(() => settingsStore.remindersEnabled);

// Lead-time options for every select (shared list, human labels).
const leadOptions = computed(() =>
  LEAD_OPTIONS.map((m) => ({ value: m, label: formatLeadLabel(m, t) }))
);

// One row per travel type the app can fire on. "Flights" drives both the
// outbound and return legs (they share a lead).
const TRAVEL_ROWS: {
  key: string;
  emoji: string;
  types: SupportedTravelType[];
  labelKey: 'reminders.flights' | 'reminders.cruises' | 'reminders.trains' | 'reminders.ferries';
}[] = [
  {
    key: 'flights',
    emoji: '✈️',
    types: ['flight_outbound', 'flight_return'],
    labelKey: 'reminders.flights',
  },
  { key: 'cruises', emoji: '🚢', types: ['cruise'], labelKey: 'reminders.cruises' },
  { key: 'trains', emoji: '🚆', types: ['train'], labelKey: 'reminders.trains' },
  { key: 'ferries', emoji: '⛴️', types: ['ferry'], labelKey: 'reminders.ferries' },
];
const ACTIVITIES_EMOJI = '🗓️';
const TODO_EMOJI = '✅';

const travelLeadFor = (types: SupportedTravelType[]): number =>
  settingsStore.travelReminderLeads[types[0]];

async function onToggle(enabled: boolean): Promise<void> {
  try {
    await settingsStore.setRemindersEnabled(enabled);
  } catch {
    // Already surfaced (toast + console.error) and re-thrown; the toggle reads
    // the persisted value, so a failed write simply stays where it was.
  }
}

async function onTravelLead(types: SupportedTravelType[], value: string | number): Promise<void> {
  const minutes = Number(value);
  try {
    for (const type of types) await settingsStore.setTravelReminderLead(type, minutes);
  } catch {
    // Surfaced + re-thrown by the store; the select re-reads the persisted value.
  }
}

async function onTodoLead(value: string | number): Promise<void> {
  try {
    await settingsStore.setTodoReminderLead(Number(value));
  } catch {
    // Surfaced + re-thrown by the store.
  }
}

// OS-permission nudge — native only, and ONLY once a denial has actually been
// observed. Never on 'prompt' or 'unknown': telling a user notifications are off
// before we have ever asked is a pre-emptive block warning (CLAUDE.md § Cloud
// Auth UX). The ref is live, so granting permission in OS settings and swiping
// back clears the nudge without a remount.
const showPermissionNudge = computed(
  () => isNative() && remindersEnabled.value && notificationPermission.value === 'denied'
);

// Exact-alarm recovery — Android 12/12L only in practice, where
// SCHEDULE_EXACT_ALARM is user-revocable (from API 33 the app declares
// USE_EXACT_ALARM, which is auto-granted and non-revocable). The ref stays
// 'unknown' off Android, so this never shows there.
const showExactAlarmNudge = computed(
  () => isNative() && remindersEnabled.value && exactAlarmPermission.value === 'denied'
);

async function onOpenExactAlarmSettings(): Promise<void> {
  try {
    await openExactAlarmSettings();
  } catch (e) {
    // Some OEM builds have no exact-alarm Settings activity. Give the user the
    // manual route rather than a dead button.
    showToast('error', t('reminders.exactAlarmHelp'), t('reminders.exactAlarmManual'), {
      silent: true,
    });
    reportError({
      surface: 'local-notifications-permission',
      severity: 'warning',
      message: 'exact-alarm settings hand-off failed; user given the manual path',
      error: e,
      context: { notif_error_stage: 'exact_alarm_settings' },
    });
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('reminders.title')"
    icon="🔔"
    icon-bg="var(--tint-orange-8)"
    :save-label="t('action.close')"
    @close="$emit('close')"
    @save="$emit('close')"
  >
    <p class="-mt-1 text-sm text-[var(--deep-slate)]/45 dark:text-slate-500">
      {{ t('reminders.description') }}
    </p>

    <!-- Master toggle -->
    <SettingToggleRow
      testid="reminders-master"
      :title="t('reminders.masterToggle')"
      :hint="t('reminders.masterToggleHint')"
      :model-value="remindersEnabled"
      @update:model-value="onToggle"
    />

    <!-- Lead-time controls -->
    <p
      class="font-outfit mt-5 mb-1 text-xs font-semibold tracking-[0.08em] text-[var(--deep-slate)]/40 uppercase dark:text-slate-500"
    >
      {{ t('reminders.howMuchNotice') }}
    </p>

    <!-- Activities — informational (each activity keeps its own reminder) -->
    <div
      class="flex items-center justify-between gap-4 border-b border-[var(--tint-slate-05)] py-3"
    >
      <div class="flex items-center gap-2.5">
        <span class="text-base" aria-hidden="true">{{ ACTIVITIES_EMOJI }}</span>
        <div>
          <p class="font-outfit text-sm font-semibold text-[var(--deep-slate)] dark:text-slate-200">
            {{ t('reminders.activities') }}
          </p>
          <p class="text-xs text-[var(--deep-slate)]/40 dark:text-slate-500">
            {{ t('reminders.activitiesHint') }}
          </p>
        </div>
      </div>
      <RouterLink
        to="/activities"
        class="font-outfit text-sm font-semibold text-[var(--heritage-orange)]"
      >
        {{ t('reminders.editActivity') }}
      </RouterLink>
    </div>

    <!-- Travel types -->
    <div
      v-for="row in TRAVEL_ROWS"
      :key="row.key"
      class="flex items-center justify-between gap-4 border-b border-[var(--tint-slate-05)] py-3"
    >
      <div class="flex items-center gap-2.5">
        <span class="text-base" aria-hidden="true">{{ row.emoji }}</span>
        <p class="font-outfit text-sm font-semibold text-[var(--deep-slate)] dark:text-slate-200">
          {{ t(row.labelKey) }}
        </p>
      </div>
      <BaseSelect
        class="w-40 flex-none"
        :model-value="travelLeadFor(row.types)"
        :options="leadOptions"
        :aria-label="t(row.labelKey)"
        @update:model-value="(v) => onTravelLead(row.types, v)"
      />
    </div>

    <!-- Timed to-dos -->
    <div class="flex items-center justify-between gap-4 py-3">
      <div class="flex items-center gap-2.5">
        <span class="text-base" aria-hidden="true">{{ TODO_EMOJI }}</span>
        <div>
          <p class="font-outfit text-sm font-semibold text-[var(--deep-slate)] dark:text-slate-200">
            {{ t('reminders.timedTodos') }}
          </p>
          <p class="text-xs text-[var(--deep-slate)]/40 dark:text-slate-500">
            {{ t('reminders.timedTodosHint') }}
          </p>
        </div>
      </div>
      <BaseSelect
        class="w-40 flex-none"
        :model-value="settingsStore.todoReminderLead"
        :options="leadOptions"
        :aria-label="t('reminders.timedTodos')"
        @update:model-value="onTodoLead"
      />
    </div>

    <!-- OS-permission nudge (Heritage Orange — never red) -->
    <div
      v-if="showPermissionNudge"
      class="mt-4 flex items-start gap-3 rounded-2xl p-4"
      style="background-color: var(--tint-orange-8)"
      role="status"
    >
      <span class="flex-none text-base text-[var(--heritage-orange)]" aria-hidden="true">🔔</span>
      <p class="text-xs text-[var(--deep-slate)] dark:text-slate-300">
        {{ t('reminders.permissionNudge') }}
      </p>
    </div>

    <!-- Exact-alarm recovery. Only after a denial is observed — never a
         pre-emptive capability warning. Orange, never red: this is routine
         friction, not a destructive action. -->
    <div
      v-if="showExactAlarmNudge"
      class="mt-4 flex items-start gap-3 rounded-2xl p-4"
      style="background-color: var(--tint-orange-8)"
      role="status"
    >
      <span class="flex-none text-base text-[var(--heritage-orange)]" aria-hidden="true">⏰</span>
      <div class="min-w-0">
        <p class="text-xs text-[var(--deep-slate)] dark:text-slate-300">
          {{ t('reminders.exactAlarmHelp') }}
        </p>
        <button
          type="button"
          class="mt-2 cursor-pointer text-xs font-semibold text-[var(--heritage-orange)] underline"
          @click="onOpenExactAlarmSettings"
        >
          {{ t('reminders.openDeviceSettings') }}
        </button>
      </div>
    </div>
  </BeanieFormModal>
</template>
