<script setup lang="ts">
// Google Calendar sync settings (#32 Layer 6). Mirrors the AiSettings card→drawer
// pattern (BeanieFormModal variant="drawer"). Lets the user connect one or more
// Google calendars (family-wide), pick a destination calendar, sync now, reconnect,
// and disconnect. Standalone official feature — reached from the Settings → Google
// Calendar card, gated on the googleCalendarSync flag (a kill-switch), not the Lab.
import { ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import { BaseButton } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { confirm } from '@/composables/useConfirm';
import { isFlagEnabled } from '@/config/flags';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { CalendarConnection } from '@/types/models';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const store = useCalendarSyncStore();

// #34 clash nudge — only surfaced when its flag is on (launch-coupled with sync).
const clashNudgeFlagOn = isFlagEnabled('calendarClashNudge');
const settingsStore = useSettingsStore();

async function onToggleClash(enabled: boolean) {
  try {
    await settingsStore.setCalendarClashNudgeEnabled(enabled);
  } catch {
    // setCalendarClashNudgeEnabled already toasts + logs the failure; the toggle
    // reverts automatically because its model-value reads the (unchanged) store.
  }
}

const connecting = ref(false);
const busyId = ref<string | null>(null);
/** Bumped to remount the destination selects (revert to the store value on a failed switch). */
const pickerRevertKey = ref(0);
/** connectionId → destination calendar options for the picker. */
const calendarOptions = ref<Record<string, Array<{ value: string; label: string }>>>({});

/** Load destination-calendar options for every connection when the drawer opens. */
watch(
  () => store.connections,
  async (connections) => {
    for (const c of connections) {
      if (calendarOptions.value[c.id]) continue;
      const cals = await store.listCalendarsFor(c.id);
      calendarOptions.value = {
        ...calendarOptions.value,
        [c.id]: cals.map((cal) => ({
          value: cal.id,
          label: cal.summary || t('calendarSync.primaryCalendar'),
        })),
      };
    }
  },
  { immediate: true, deep: true }
);

function statusKey(status: CalendarConnection['status']): UIStringKey {
  switch (status) {
    case 'needs_reconnect':
      return 'calendarSync.status.needsReconnect';
    case 'error':
      return 'calendarSync.status.error';
    case 'disconnecting':
      return 'calendarSync.status.disconnecting';
    default:
      return 'calendarSync.status.ok';
  }
}

async function onConnect() {
  connecting.value = true;
  try {
    const result = await store.connect();
    if (result.status === 'connected') {
      showToast(
        'success',
        t('calendarSync.toast.connected.title'),
        t('calendarSync.toast.connected.message')
      );
    } else if (result.code !== 'cancelled') {
      // missing_scope is user-recoverable input → silent (no Slack noise).
      showToast('error', t('calendarSync.toast.connectFailed.title'), result.message, {
        silent: result.code === 'missing_scope' || result.code === 'redirect_unsupported',
      });
    }
  } finally {
    connecting.value = false;
  }
}

async function onReconnect(connection: CalendarConnection) {
  busyId.value = connection.id;
  try {
    const result = await store.reconnect(connection.id);
    if (result.status === 'connected') {
      showToast(
        'success',
        t('calendarSync.toast.reconnected.title'),
        t('calendarSync.toast.reconnected.message')
      );
    } else if (result.code !== 'cancelled') {
      showToast('error', t('calendarSync.toast.connectFailed.title'), result.message, {
        silent: true,
      });
    }
  } finally {
    busyId.value = null;
  }
}

async function onSyncNow(connection: CalendarConnection) {
  busyId.value = connection.id;
  try {
    // syncNow swallows API errors into the connection status, so toast from the
    // returned outcome — NOT an unconditional "Synced!".
    const outcome = await store.syncNow(connection.id);
    if (outcome === 'needs_reconnect') {
      showToast(
        'error',
        t('calendarSync.toast.syncReconnect.title'),
        t('calendarSync.toast.syncReconnect.message'),
        { silent: true } // user-recoverable (reconnect); no Slack noise
      );
    } else if (outcome === 'error') {
      showToast(
        'error',
        t('calendarSync.toast.syncFailed.title'),
        t('calendarSync.toast.syncFailed.message'),
        { silent: true } // the store already reported the API error to Slack
      );
    } else {
      // 'ok' | 'skipped' (a no-op is still "up to date").
      showToast(
        'success',
        t('calendarSync.toast.synced.title'),
        t('calendarSync.toast.synced.message')
      );
    }
  } catch (e) {
    // Unexpected throw (e.g. IndexedDB write) — never fail silently.
    showToast(
      'error',
      t('calendarSync.toast.syncFailed.title'),
      t('calendarSync.toast.syncFailed.message'),
      {
        silent: true,
        surface: 'calendar-sync',
        error: e,
        context: { action: 'syncNow', connectionId: connection.id },
      }
    );
  } finally {
    busyId.value = null;
  }
}

async function onDisconnect(connection: CalendarConnection) {
  const ok = await confirm({
    title: 'calendarSync.disconnect.title',
    message: 'calendarSync.disconnect.message',
    variant: 'danger',
    confirmLabel: 'calendarSync.disconnect.confirm',
  });
  if (!ok) return;
  busyId.value = connection.id;
  try {
    // disconnect returns whether teardown fully completed — a partial teardown
    // leaves the connection parked 'disconnecting', so don't claim success.
    const cleared = await store.disconnect(connection.id);
    if (cleared) {
      showToast(
        'success',
        t('calendarSync.toast.disconnected.title'),
        t('calendarSync.toast.disconnected.message')
      );
    } else {
      showToast(
        'error',
        t('calendarSync.toast.disconnectPartial.title'),
        t('calendarSync.toast.disconnectPartial.message'),
        { silent: true }
      );
    }
  } catch (e) {
    showToast(
      'error',
      t('calendarSync.toast.syncFailed.title'),
      t('calendarSync.toast.syncFailed.message'),
      {
        silent: true,
        surface: 'calendar-sync',
        error: e,
        context: { action: 'disconnect', connectionId: connection.id },
      }
    );
  } finally {
    busyId.value = null;
  }
}

async function onPickCalendar(connection: CalendarConnection, value: string | number) {
  if (String(value) === connection.destinationCalendarId) return;
  busyId.value = connection.id;
  try {
    const { ok } = await store.setDestinationCalendar(connection.id, String(value));
    if (!ok) {
      // Switch aborted (old-calendar cleanup failed) — destination unchanged.
      showToast(
        'error',
        t('calendarSync.toast.destinationFailed.title'),
        t('calendarSync.toast.destinationFailed.message')
      );
      pickerRevertKey.value++; // remount the select so it re-reads the unchanged store value
    }
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('settings.card.calendarSync')"
    icon="📅"
    icon-bg="var(--tint-silk-20)"
    :save-label="t('action.close')"
    @close="emit('close')"
    @save="emit('close')"
  >
    <div class="space-y-5">
      <p class="text-[0.85rem] leading-snug text-[var(--deep-slate)]/70 dark:text-slate-300">
        {{ t('calendarSync.intro') }}
      </p>

      <!-- Connected calendars -->
      <div v-if="store.connections.length > 0" class="space-y-3">
        <div
          v-for="connection in store.connections"
          :key="connection.id"
          class="space-y-2 rounded-2xl border border-[var(--tint-slate-05)] p-3 dark:border-slate-700"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="truncate font-medium text-[var(--deep-slate)] dark:text-slate-100">
              {{ connection.accountEmail }}
            </span>
            <span class="shrink-0 text-[0.75rem] text-[var(--deep-slate)]/60 dark:text-slate-400">
              {{ t(statusKey(connection.status)) }}
            </span>
          </div>

          <BaseSelect
            v-if="calendarOptions[connection.id]?.length"
            :key="`cal-${connection.id}-${pickerRevertKey}`"
            :model-value="connection.destinationCalendarId"
            :options="calendarOptions[connection.id]"
            :label="t('calendarSync.destinationLabel')"
            @update:model-value="(v) => onPickCalendar(connection, v)"
          />

          <div class="flex flex-wrap gap-2">
            <BaseButton
              v-if="connection.status === 'needs_reconnect'"
              variant="primary"
              size="sm"
              :loading="busyId === connection.id"
              @click="onReconnect(connection)"
            >
              {{ t('calendarSync.action.reconnect') }}
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="busyId === connection.id"
              @click="onSyncNow(connection)"
            >
              {{ t('calendarSync.action.syncNow') }}
            </BaseButton>
            <BaseButton variant="ghost" size="sm" @click="onDisconnect(connection)">
              {{ t('calendarSync.action.disconnect') }}
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- Clash nudge toggle (#34) — shown once a calendar is connected. -->
      <div
        v-if="clashNudgeFlagOn && store.connections.length > 0"
        class="rounded-2xl border border-[var(--tint-slate-05)] px-3 dark:border-slate-700"
      >
        <SettingToggleRow
          :model-value="settingsStore.calendarClashNudgeEnabled"
          :title="t('calendarSync.clashNudge.title')"
          :hint="t('calendarSync.clashNudge.hint')"
          testid="calendar-clash-toggle"
          @update:model-value="onToggleClash"
        />
      </div>

      <!-- Connect a new calendar -->
      <BaseButton
        v-if="store.isConnectSupported"
        variant="primary"
        :loading="connecting"
        @click="onConnect"
      >
        {{ t('calendarSync.action.connect') }}
      </BaseButton>
      <p
        v-else
        class="rounded-2xl bg-[var(--tint-silk-20)] px-3 py-2.5 text-[0.8rem] leading-snug text-[var(--deep-slate)]/70 dark:bg-slate-800 dark:text-slate-300"
      >
        {{ t('calendarSync.connectOnDesktop') }}
      </p>
    </div>
  </BeanieFormModal>
</template>
