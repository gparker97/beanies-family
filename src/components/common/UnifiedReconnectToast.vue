<script setup lang="ts">
/**
 * Unified Google reconnect toast (tracker #62, commit 5) — the SINGLE reconnect
 * prompt that supersedes the separate Drive (`GoogleReconnectToast`) and Calendar
 * (`CalendarReconnectToast`) toasts. Binds `useReconnectCoordinator` to the shared,
 * presentational `ReconnectToast`.
 *
 * It names exactly what's down — "Google Drive + Calendar" when both, or the single
 * feature when only one — and its one button reconnects everything in as few
 * consents as possible (one unified consent for a same-account Drive+Calendar pair;
 * delegated per-feature otherwise). State-driven (like the toasts it replaces): the
 * prompt appears/clears off the stores' reconnect state, so it never routes through
 * `claimInterruption`, and there is no per-incident local dismiss to flash.
 */
import { computed } from 'vue';
import { useReconnectCoordinator } from '@/composables/useReconnectCoordinator';
import { useTranslation } from '@/composables/useTranslation';
import ReconnectToast from '@/components/common/ReconnectToast.vue';

const { t } = useTranslation();
const { activeReconnectPrompt, reconnectAll, isReconnecting, reconnectError } =
  useReconnectCoordinator();

const subtitle = computed(() => {
  if (reconnectError.value) return reconnectError.value;
  return activeReconnectPrompt.value ? t(activeReconnectPrompt.value.bodyKey) : undefined;
});
</script>

<template>
  <ReconnectToast
    v-if="activeReconnectPrompt"
    :title="t(activeReconnectPrompt.titleKey)"
    :subtitle="subtitle"
    :subtitle-is-error="!!reconnectError"
    :busy="isReconnecting"
    :reconnect-label="t('reconnectPrompt.action')"
    @reconnect="reconnectAll"
  >
    <template #icon>
      <span class="text-base" aria-hidden="true">&#x1F517;</span>
    </template>
  </ReconnectToast>
</template>
