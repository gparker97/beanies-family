<script setup lang="ts">
/**
 * One synced calendar (a `CalendarConnection`) in Settings -> Google Calendar.
 *
 * A view: it renders the connection in a `CalendarCardShell` and emits intents. The
 * drawer (`CalendarSyncSettings`) owns the confirm, the store calls, the busy state
 * and the repair rule, and passes the outcome in as props. The destination is fixed
 * text: it is chosen in the add step and never switched here.
 *
 * Reconnect, Sync now, Import events and Disconnect share one action row that wraps
 * on a narrow drawer. Disconnect is a neutral outlined button: the confirm it opens
 * carries the destructive styling.
 */
import { computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import CalendarCardShell from '@/components/settings/CalendarCardShell.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { CalendarConnection } from '@/types/models';

export type SyncedCalendarAction = 'reconnect' | 'sync' | 'import' | 'disconnect';

const props = withDefaults(
  defineProps<{
    connection: CalendarConnection;
    /** The destination calendar's Google name; empty falls back to "Primary calendar". */
    calendarName: string;
    /** Whoever can finish the account-bound sign-in (`canViewerRepair`). */
    canRepair: boolean;
    /** The action running on this connection, if any (its button spins, the others wait). */
    busyAction?: SyncedCalendarAction | null;
  }>(),
  { busyAction: null }
);

const emit = defineEmits<{
  reconnect: [];
  sync: [];
  import: [];
  disconnect: [];
}>();

const open = defineModel<boolean>('open', { default: false });

const { t } = useTranslation();

const statusKey = computed<UIStringKey>(() => {
  switch (props.connection.status) {
    case 'needs_reconnect':
      return 'calendarSync.status.needsReconnect';
    case 'error':
      return 'calendarSync.status.error';
    case 'disconnecting':
      return 'calendarSync.status.disconnecting';
    default:
      return 'calendarSync.status.ok';
  }
});
const needsAttention = computed(
  () => props.connection.status === 'needs_reconnect' || props.connection.status === 'error'
);
const busy = computed(() => props.busyAction !== null);
</script>

<template>
  <CalendarCardShell
    v-model:open="open"
    :name="calendarName || t('calendarSync.primaryCalendar')"
    :account="connection.accountEmail"
    :status-label="t(statusKey)"
    :status-tone="needsAttention ? 'attention' : 'neutral'"
    :data-testid="`synced-calendar-${connection.id}`"
  >
    <template #actions>
      <!-- Reconnect works on every surface (P2): desktop via popup, PWA/iOS/
           native via the redirect transport. No desktop-only gate. -->
      <BaseButton
        v-if="connection.status === 'needs_reconnect' && canRepair"
        variant="primary"
        size="sm"
        :loading="busyAction === 'reconnect'"
        :disabled="busy"
        data-testid="synced-calendar-reconnect"
        @click="emit('reconnect')"
      >
        {{ t('calendarSync.action.reconnect') }}
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :loading="busyAction === 'sync'"
        :disabled="busy"
        data-testid="synced-calendar-sync"
        @click="emit('sync')"
      >
        {{ t('calendarSync.action.syncNow') }}
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :loading="busyAction === 'import'"
        :disabled="busy"
        data-testid="synced-calendar-import"
        @click="emit('import')"
      >
        {{ t('calendarImport.start') }}
      </BaseButton>
      <BaseButton
        variant="outline"
        size="sm"
        :loading="busyAction === 'disconnect'"
        :disabled="busy"
        data-testid="synced-calendar-disconnect"
        @click="emit('disconnect')"
      >
        {{ t('calendarSync.action.disconnect') }}
      </BaseButton>
    </template>
  </CalendarCardShell>
</template>
