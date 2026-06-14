<script setup lang="ts">
/**
 * Install-nudge detail body — the one-time "add beanies to your home screen"
 * card shown in the notification bell to iOS Safari users. Renders through the
 * shared `NudgeDetailBody` chrome (same as `CommunityNudgeBody`). The message is
 * a single static line (no rotating registry), so it resolves straight from
 * `t()`. The three actions wire to `useInstallNudge` and close the drawer.
 */
import { computed } from 'vue';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useInstallNudge } from '@/composables/useInstallNudge';
import { useTranslation } from '@/composables/useTranslation';
import NudgeDetailBody from '@/components/notifications/NudgeDetailBody.vue';

const store = useNotificationsStore();
const { t } = useTranslation();
const nudge = useInstallNudge();

function onShowHow(): void {
  nudge.showHow();
  store.back();
}
function onDismiss(): void {
  nudge.dismiss();
  store.back();
}
function onInstalled(): void {
  nudge.markInstalled();
  store.back();
}

const actions = computed(() => [
  { label: t('installNudge.dismiss'), onClick: onDismiss },
  { label: t('installNudge.installed'), onClick: onInstalled },
]);
</script>

<template>
  <NudgeDetailBody :message="t('installNudge.description')" :actions="actions" @cta="onShowHow">
    <template #kick>📲 {{ t('installNudge.label') }}</template>
    <template #cta>{{ t('installNudge.showHow') }}</template>
  </NudgeDetailBody>
</template>
