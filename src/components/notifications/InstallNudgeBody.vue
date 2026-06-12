<script setup lang="ts">
/**
 * Install-nudge detail body — the one-time "add beanies to your home screen"
 * card shown in the notification bell to iOS Safari users. Reuses the shared
 * `CelebrationDetail` shell (same idiom as `CommunityNudgeBody`/`AnnouncementBody`).
 * The message is a single static line (no rotating registry), so it resolves
 * straight from `t()`. The three actions wire to `useInstallNudge` and close the
 * drawer.
 */
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useInstallNudge } from '@/composables/useInstallNudge';
import { useTranslation } from '@/composables/useTranslation';
import CelebrationDetail from '@/components/notifications/CelebrationDetail.vue';

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
</script>

<template>
  <CelebrationDetail
    date-label=""
    medallion-src="/brand/beanies_family_hugging_transparent_512x512.png"
  >
    <template #kick>📲 {{ t('installNudge.label') }}</template>

    <p class="in-message">{{ t('installNudge.description') }}</p>

    <button type="button" class="in-cta" @click="onShowHow">
      {{ t('installNudge.showHow') }}
    </button>

    <div class="in-actions">
      <button type="button" class="in-secondary" @click="onDismiss">
        {{ t('installNudge.dismiss') }}
      </button>
      <button type="button" class="in-secondary" @click="onInstalled">
        {{ t('installNudge.installed') }}
      </button>
    </div>
  </CelebrationDetail>
</template>

<style scoped>
.in-message {
  color: rgb(44 62 80 / 80%);
  font-family: Inter, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.6;
  margin: auto 0 0;
  text-align: center;
}

:global(.dark) .in-message {
  color: rgb(226 232 240 / 82%);
}

.in-cta {
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

.in-cta:hover {
  box-shadow: 0 6px 18px rgb(241 93 34 / 36%);
  transform: translateY(-1px);
}

.in-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 0.75rem;
}

.in-secondary {
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

.in-secondary:hover {
  color: #f15d22;
}

:global(.dark) .in-secondary {
  color: rgb(226 232 240 / 60%);
}
</style>
