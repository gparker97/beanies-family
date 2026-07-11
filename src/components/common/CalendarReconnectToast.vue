<script setup lang="ts">
/**
 * App-level Google Calendar reconnect toast — the user-facing signal that a
 * calendar connection died and needs re-consent. Binds the calendar store's
 * `showCalendarReconnect` computed (needs_reconnect only, self-healing) to the
 * shared `ReconnectToast`. Mirrors `GoogleReconnectToast` for Drive.
 *
 * P1 recovery: on a desktop (popup) surface it reconnects inline; on a redirect
 * surface (PWA/iOS/native) the redirect transport doesn't exist yet (P2), so it
 * routes to Settings → Google Calendar, where the `connectOnDesktop` explanation
 * lives — never a dead-end error toast. Every failure path surfaces (errorText +
 * console.warn + reportError); nothing fails silently.
 */
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { reportError } from '@/utils/errorReporter';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';
import ReconnectToast from '@/components/common/ReconnectToast.vue';

const store = useCalendarSyncStore();
const { t } = useTranslation();
const router = useRouter();

const isReconnecting = ref(false);
const hasError = ref(false);
// Session-scoped dismiss. Reset whenever the connection heals (see watch), so a
// future disconnect surfaces again. The bell keeps the durable record meanwhile.
const dismissed = ref(false);

const visible = computed(() => store.showCalendarReconnect && !dismissed.value);

const subtitle = computed(() => {
  if (hasError.value) return t('calendarSync.reconnect.bannerError');
  const email = store.reconnectNeededConnection?.accountEmail;
  return email && email !== 'unknown'
    ? fillTemplate(t('calendarSync.reconnect.bannerSub'), { account: email })
    : t('calendarSync.reconnect.bannerSubGeneric');
});

// Self-heal: when the connection returns to `ok` the computed drops the surface;
// clear the local flags so a later disconnect starts clean (no stale error, and
// the dismiss doesn't carry over to the next incident).
watch(
  () => store.showCalendarReconnect,
  (needsReconnect) => {
    if (!needsReconnect) {
      dismissed.value = false;
      hasError.value = false;
      isReconnecting.value = false;
    }
  }
);

async function handleReconnect(): Promise<void> {
  const connection = store.reconnectNeededConnection;
  if (!connection) return; // self-healed between render and click — nothing to do

  // Redirect surface (PWA/iOS/native): inline re-consent isn't available until
  // P2. Route to Settings → Google Calendar rather than dead-end with the
  // "desktop browser" error toast. router.push rejects on aborted/redirected
  // nav — report rather than fail silently.
  if (!store.isConnectSupported) {
    router.push({ path: '/settings', query: { open: CALENDAR_SYNC_OPEN } }).catch((err) =>
      reportError({
        surface: 'calendar-reconnect-toast',
        message: 'calendar reconnect toast → Settings navigation failed',
        error: err,
        severity: 'warning',
      })
    );
    return;
  }

  // Desktop popup surface: reconnect inline. `store.reconnect` returns a typed
  // result for the connectGoogleCalendar path, but its surrounding CRDT writes
  // can throw — guard so a throw becomes a visible error, never an unhandled
  // rejection (mirrors useGoogleReconnect's per-call catch).
  isReconnecting.value = true;
  hasError.value = false;
  try {
    const result = await store.reconnect(connection.id);
    hasError.value = result.status !== 'connected';
  } catch (err) {
    hasError.value = true;
    console.warn('[CalendarReconnectToast] reconnect threw:', err);
    reportError({
      surface: 'calendar-reconnect-toast',
      message: 'calendar reconnect handler threw',
      error: err,
      severity: 'warning',
    });
  } finally {
    isReconnecting.value = false;
  }
}
</script>

<template>
  <ReconnectToast
    v-if="visible"
    :title="t('calendarSync.reconnect.bannerTitle')"
    :subtitle="subtitle"
    :subtitle-is-error="hasError"
    :busy="isReconnecting"
    :reconnect-label="t('calendarSync.action.reconnect')"
    dismissible
    :dismiss-label="t('calendarSync.reconnect.dismiss')"
    @reconnect="handleReconnect"
    @dismiss="dismissed = true"
  >
    <template #icon>
      <span class="text-base" aria-hidden="true">&#x1F4C5;</span>
    </template>
  </ReconnectToast>
</template>
