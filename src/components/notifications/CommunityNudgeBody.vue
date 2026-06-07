<script setup lang="ts">
/**
 * Community-nudge detail body — the recurring "join our Discord" card shown in
 * the notification bell. Reuses the shared `CelebrationDetail` shell (same idiom
 * as `AnnouncementBody`), so there's no bespoke "tip card" scaffold. The rotating
 * message is resolved by `useNotificationPresentation` from the notification's
 * sourceId; the three actions are wired to `useCommunityNudge` and then close the
 * drawer. The only Discord blurple is the `DiscordGlyph` on the CTA (over a white
 * ring for contrast); everything else stays on-brand Heritage Orange.
 */
import { computed } from 'vue';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useNotificationPresentation } from '@/composables/useNotificationPresentation';
import { useCommunityNudge } from '@/composables/useCommunityNudge';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import CelebrationDetail from '@/components/notifications/CelebrationDetail.vue';
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
</script>

<template>
  <CelebrationDetail
    date-label=""
    medallion-src="/brand/beanies_family_hugging_transparent_512x512.png"
  >
    <template #kick>💬 {{ t('communityNudge.label') }}</template>

    <p class="cn-message">{{ message }}</p>

    <button type="button" class="cn-cta" @click="onJoin">
      <DiscordGlyph :size="18" />{{ t('communityNudge.join') }}
    </button>

    <div class="cn-actions">
      <button type="button" class="cn-secondary" @click="onSnooze">
        {{ t('communityNudge.snooze') }}
      </button>
      <button type="button" class="cn-secondary" @click="onAlreadyThere">
        {{ t('communityNudge.joined') }}
      </button>
    </div>
  </CelebrationDetail>
</template>

<style scoped>
.cn-message {
  color: rgb(44 62 80 / 80%);
  font-family: Inter, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.6;
  margin: auto 0 0;
  text-align: center;
}

:global(.dark) .cn-message {
  color: rgb(226 232 240 / 82%);
}

.cn-cta {
  align-items: center;
  background: linear-gradient(135deg, #f15d22, #e67e22);
  border: none;
  border-radius: 0.875rem;
  box-shadow: 0 4px 14px rgb(241 93 34 / 28%);
  color: #fff;
  cursor: pointer;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 1.125rem;
  padding: 0.8125rem 1.125rem;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  width: 100%;
}

.cn-cta:hover {
  box-shadow: 0 6px 18px rgb(241 93 34 / 36%);
  transform: translateY(-1px);
}

/* Keep the glyph blurple (recognition) on the orange CTA — a white ring lifts it. */
.cn-cta :deep(svg) {
  background: #fff;
  border-radius: 50%;
  flex-shrink: 0;
  padding: 3px;
}

.cn-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 0.75rem;
}

.cn-secondary {
  background: none;
  border: none;
  color: rgb(44 62 80 / 55%);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 0.375rem 0.5rem;
  transition: color 0.15s;
}

.cn-secondary:hover {
  color: #f15d22;
}

:global(.dark) .cn-secondary {
  color: rgb(226 232 240 / 60%);
}
</style>
