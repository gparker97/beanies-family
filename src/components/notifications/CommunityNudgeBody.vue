<script setup lang="ts">
/**
 * Community-nudge detail body — the recurring "join our Discord" card shown in
 * the notification bell. Renders through the shared `NudgeDetailBody` chrome
 * (same as `InstallNudgeBody`). The rotating message is resolved by
 * `useNotificationPresentation` from the notification's sourceId; the three
 * actions are wired to `useCommunityNudge` and then close the drawer. The only
 * Discord blurple is the `DiscordGlyph` on the CTA (over a white ring for
 * contrast); everything else stays on-brand Heritage Orange.
 */
import { computed } from 'vue';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useNotificationPresentation } from '@/composables/useNotificationPresentation';
import { useCommunityNudge } from '@/composables/useCommunityNudge';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import NudgeDetailBody from '@/components/notifications/NudgeDetailBody.vue';
import DiscordGlyph from '@/components/ui/DiscordGlyph.vue';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();

const store = useNotificationsStore();
const { t } = useTranslation();
const { txt } = useBeanieText();
const { nudgeMessage } = useNotificationPresentation(() => props.notification);
const nudge = useCommunityNudge();

const message = computed(() => (nudgeMessage.value ? txt(nudgeMessage.value) : ''));

function onJoin(): void {
  nudge.join();
  store.back();
}
function onSnooze(): void {
  nudge.snooze();
  store.back();
}
function onAlreadyThere(): void {
  nudge.markJoined();
  store.back();
}

const actions = computed(() => [
  { label: t('communityNudge.snooze'), onClick: onSnooze },
  { label: t('communityNudge.joined'), onClick: onAlreadyThere },
]);
</script>

<template>
  <NudgeDetailBody :message="message" :actions="actions" @cta="onJoin">
    <template #kick>💬 {{ t('communityNudge.label') }}</template>
    <template #cta><DiscordGlyph :size="18" />{{ t('communityNudge.join') }}</template>
  </NudgeDetailBody>
</template>
