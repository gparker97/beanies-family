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
import CalendarImportModal from '@/components/settings/CalendarImportModal.vue';
import { useCalendarImportStore } from '@/stores/calendarImportStore';
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
/**
 * `${connectionId}:${action}`, not a bare connection id. It used to be the id
 * alone, so starting any per-connection action spun EVERY button on that card.
 * With the import added that becomes four buttons pretending to be busy because
 * one of them is. One helper, four buttons correct, no extra state.
 */
const busyId = ref<string | null>(null);
type ConnAction = 'reconnect' | 'sync' | 'disconnect' | 'import';
function busyKey(connectionId: string, action: ConnAction): string {
  return `${connectionId}:${action}`;
}
/** Does THIS button show a spinner? One action, one spinner. */
function isBusy(connectionId: string, action: ConnAction): boolean {
  return busyId.value === busyKey(connectionId, action);
}
/**
 * Is ANY action running on this connection? Splitting `busyId` per action fixed
 * four buttons spinning at once, but it also removed the mutual exclusion the old
 * bare-id key gave for free — and the disconnect button never read the flag at
 * all. So "Sync now" stayed live all through a teardown, and one click re-inserted
 * events onto a calendar whose links were being deleted, leaving orphans in the
 * user's Google account that beanies no longer knew about.
 *
 * The spinner stays per-action; DISABLING is per-connection.
 */
function isConnectionBusy(connectionId: string): boolean {
  return busyId.value?.startsWith(`${connectionId}:`) === true;
}

/** The one-time import (#94). Its own drawer, opened per connection. */
const importConnectionId = ref<string | null>(null);

async function onImport(connection: CalendarConnection) {
  busyId.value = busyKey(connection.id, 'import');
  try {
    await useCalendarImportStore().open(connection.id);
    importConnectionId.value = connection.id;
  } catch (e) {
    // NOT `calendarImport.failed.*` — that copy says "nothing was imported",
    // which is about a COMMIT. Nothing has been offered yet at this point; the
    // chooser simply could not be opened.
    showToast('error', t('calendarImport.scanFailed.title'), t('calendarImport.scanFailed.body'), {
      surface: 'calendar-import',
      error: e,
    });
  } finally {
    busyId.value = null;
  }
}
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
    } else if (result.status === 'redirecting') {
      // Handed off to the redirect transport (PWA/iOS/native). The page is
      // navigating away (web) or the system browser is open (native); the resume
      // toasts the outcome post-redirect. Nothing to show here.
    } else if (result.code !== 'cancelled') {
      // missing_scope is user-recoverable input → silent (no Slack noise).
      showToast('error', t('calendarSync.toast.connectFailed.title'), result.message, {
        silent: result.code === 'missing_scope',
      });
    }
  } finally {
    connecting.value = false;
  }
}

async function onReconnect(connection: CalendarConnection) {
  busyId.value = busyKey(connection.id, 'reconnect');
  try {
    const result = await store.reconnect(connection.id);
    if (result.status === 'connected') {
      showToast(
        'success',
        t('calendarSync.toast.reconnected.title'),
        t('calendarSync.toast.reconnected.message')
      );
    } else if (result.status === 'redirecting') {
      // Redirect transport handed off — resume toasts post-redirect.
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
  busyId.value = busyKey(connection.id, 'sync');
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
  busyId.value = busyKey(connection.id, 'disconnect');
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
  busyId.value = busyKey(connection.id, 'sync');
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
      <p class="dark:text-ink-soft text-[0.85rem] leading-snug text-[var(--deep-slate)]/70">
        {{ t('calendarSync.intro') }}
      </p>

      <!-- Connected calendars -->
      <div v-if="store.connections.length > 0" class="space-y-3">
        <div
          v-for="connection in store.connections"
          :key="connection.id"
          class="dark:border-line space-y-2 rounded-2xl border border-[var(--tint-slate-05)] p-3"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="dark:text-ink truncate font-medium text-[var(--deep-slate)]">
              {{ connection.accountEmail }}
            </span>
            <span class="dark:text-ink-soft shrink-0 text-[0.75rem] text-[var(--deep-slate)]/60">
              {{ t(statusKey(connection.status)) }}
            </span>
          </div>

          <BaseSelect
            v-if="calendarOptions[connection.id]?.length"
            :key="`cal-${connection.id}-${pickerRevertKey}`"
            :model-value="connection.destinationCalendarId"
            :options="calendarOptions[connection.id]"
            :disabled="isConnectionBusy(connection.id)"
            :label="t('calendarSync.destinationLabel')"
            @update:model-value="(v) => onPickCalendar(connection, v)"
          />

          <div class="flex flex-wrap gap-2">
            <!-- Reconnect works on every surface (P2): desktop via popup, PWA/iOS/
                 native via the redirect transport. No desktop-only gate. -->
            <BaseButton
              v-if="connection.status === 'needs_reconnect'"
              variant="primary"
              size="sm"
              :loading="isBusy(connection.id, 'reconnect')"
              :disabled="isConnectionBusy(connection.id)"
              @click="onReconnect(connection)"
            >
              {{ t('calendarSync.action.reconnect') }}
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="isBusy(connection.id, 'sync')"
              :disabled="isConnectionBusy(connection.id)"
              @click="onSyncNow(connection)"
            >
              {{ t('calendarSync.action.syncNow') }}
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="isBusy(connection.id, 'import')"
              :disabled="isConnectionBusy(connection.id)"
              @click="onImport(connection)"
            >
              {{ t('calendarImport.start') }}
            </BaseButton>
            <BaseButton
              variant="ghost"
              size="sm"
              :loading="isBusy(connection.id, 'disconnect')"
              :disabled="isConnectionBusy(connection.id)"
              @click="onDisconnect(connection)"
            >
              {{ t('calendarSync.action.disconnect') }}
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- Clash nudge toggle (#34) — shown once a calendar is connected. -->
      <div
        v-if="clashNudgeFlagOn && store.connections.length > 0"
        class="dark:border-line rounded-2xl border border-[var(--tint-slate-05)] px-3"
      >
        <SettingToggleRow
          :model-value="settingsStore.calendarClashNudgeEnabled"
          :title="t('calendarSync.clashNudge.title')"
          :hint="t('calendarSync.clashNudge.hint')"
          testid="calendar-clash-toggle"
          @update:model-value="onToggleClash"
        />
      </div>

      <!-- Connect a new calendar — works on every surface (popup on desktop,
           redirect transport on PWA/iOS/native). -->
      <BaseButton variant="primary" :loading="connecting" @click="onConnect">
        {{ t('calendarSync.action.connect') }}
      </BaseButton>
    </div>
  </BeanieFormModal>

  <!-- The one-time import (#94). A sibling drawer, not nested: it has its own
       scroll container and sticky action bar, and nesting two drawers would put
       two scroll contexts inside one another. -->
  <!-- `v-if`, not just `:open`. The modal resolves its own Pinia store at setup,
       so binding `:open` alone would construct the store and the whole component
       every time anyone opens calendar settings, for a drawer most people never
       use. Gating instantiation costs a close transition on a rare surface, which
       is the better trade. -->
  <CalendarImportModal
    v-if="importConnectionId !== null"
    :open="true"
    :connection-id="importConnectionId"
    @close="importConnectionId = null"
  />
</template>
