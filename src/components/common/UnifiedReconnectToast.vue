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
import { useRoute } from 'vue-router';
import { useReconnectCoordinator } from '@/composables/useReconnectCoordinator';
import { useTranslation } from '@/composables/useTranslation';
import { isExternalLandingRoute } from '@/utils/appChrome';
import ReconnectToast from '@/components/common/ReconnectToast.vue';

const { t } = useTranslation();
const route = useRoute();
const { activeReconnectPrompt, reconnectAll, isReconnecting, reconnectError } =
  useReconnectCoordinator();

/**
 * Display-only. `activeReconnectPrompt` remains the STATE and is deliberately
 * untouched: `reconnectAll` reads its `variant` to label its own telemetry, so
 * nulling the state would quietly relabel every one of those events `'none'`.
 *
 * This is a SUPPRESSION, not a cancellation — the two names are the comment.
 * Nobody reading `visibleReconnectPrompt` concludes the reconnect was cancelled,
 * and the prompt appears the instant the user navigates to a real app route.
 *
 * WHY: someone opening a shared-recipe link is a visitor, not a user. They have
 * no Google connection of ours to repair, and asking them to reconnect one is
 * both meaningless and alarming. `isExternalLandingRoute` is exactly the right
 * test — `ShareTarget` and `SharedRecipe`, the two routes whose whole job is to
 * serve content to someone arriving from outside. The broader
 * `isPublicEntryRoute` is NOT used: it also covers `OpenFromDrive` and `Login`,
 * where a reconnect prompt is legitimate and hiding it would build a dead end.
 *
 * The computed lives HERE rather than in `useReconnectCoordinator` because this
 * is the composable's only consumer and it is component-scoped, so the composable
 * and its six existing tests keep a zero-line diff.
 */
const visibleReconnectPrompt = computed(() =>
  isExternalLandingRoute(route) ? null : activeReconnectPrompt.value
);

const subtitle = computed(() => {
  if (reconnectError.value) return reconnectError.value;
  return visibleReconnectPrompt.value ? t(visibleReconnectPrompt.value.bodyKey) : undefined;
});
</script>

<template>
  <ReconnectToast
    v-if="visibleReconnectPrompt"
    :title="t(visibleReconnectPrompt.titleKey)"
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
