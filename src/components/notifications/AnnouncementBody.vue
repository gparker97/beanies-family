<script setup lang="ts">
/**
 * Adhoc announcement detail body (e.g. "join our Discord"). Renders inside the
 * shared `CelebrationDetail` shell — a warm headline + message + optional note +
 * a prominent call-to-action, with greg's Caveat sign-off. Resolves its own
 * `announcement` from the notification's `sourceId`, so `NotificationDetail`
 * hands every rich body the same `:notification` prop.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import { openExternal } from '@/utils/openExternal';
import { getAnnouncement } from '@/content/announcements';
import CelebrationDetail from '@/components/notifications/CelebrationDetail.vue';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();

const router = useRouter();
const store = useNotificationsStore();
const { t } = useTranslation();
const { txt } = useBeanieText();

const announcement = computed(() =>
  props.notification.sourceId ? getAnnouncement(props.notification.sourceId) : undefined
);

const kicker = computed(() =>
  announcement.value?.kicker ? txt(announcement.value.kicker) : t('notifications.kindAnnouncement')
);
const icon = computed(() => announcement.value?.icon ?? '📣');

function handleCta() {
  const cta = announcement.value?.cta;
  if (!cta) return;
  if (cta.route) {
    store.close();
    router.push(cta.route);
  } else if (cta.href) {
    openExternal(cta.href);
  }
}
</script>

<template>
  <CelebrationDetail
    v-if="announcement"
    :date-label="announcement.month"
    :medallion-src="
      announcement.medallion ?? '/brand/beanies_family_hugging_transparent_512x512.png'
    "
    :signature="announcement.signature"
  >
    <template #kick>{{ icon }} {{ kicker }}</template>

    <h3 class="ann-title">{{ txt(announcement.title) }}</h3>
    <p class="ann-message">{{ txt(announcement.message) }}</p>
    <p v-if="announcement.note" class="ann-note">{{ txt(announcement.note) }}</p>
    <button v-if="announcement.cta" type="button" class="ann-cta" @click="handleCta">
      {{ txt(announcement.cta.label) }}<span class="ann-cta-arrow">→</span>
    </button>

    <template #footer>
      <div class="ann-tagline">{{ t('app.tagline') }}</div>
    </template>
  </CelebrationDetail>
</template>

<style scoped>
.ann-title {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 1.25rem;
  font-weight: 800;
  line-height: 1.2;
  margin: 0 0 0.75rem;
  text-align: center;
}

:global(.dark) .ann-title {
  color: #e2e8f0;
}

.ann-message {
  color: rgb(44 62 80 / 78%);
  font-family: Inter, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.62;
  margin: 0;
}

:global(.dark) .ann-message {
  color: rgb(226 232 240 / 82%);
}

.ann-note {
  background: var(--tint-orange-8, rgb(241 93 34 / 8%));
  border-radius: 0.875rem;
  color: rgb(200 70 18 / 90%);
  font-family: Inter, sans-serif;
  font-size: 0.8125rem;
  line-height: 1.5;
  margin: 0.875rem 0 0;
  padding: 0.625rem 0.875rem;
}

:global(.dark) .ann-note {
  background: rgb(241 93 34 / 12%);
  color: rgb(245 158 110 / 95%);
}

.ann-cta {
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
  gap: 0.4375rem;
  justify-content: center;
  margin-top: 1.125rem;
  padding: 0.8125rem 1.125rem;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  width: 100%;
}

.ann-cta:hover {
  box-shadow: 0 6px 18px rgb(241 93 34 / 36%);
  transform: translateY(-1px);
}

.ann-cta-arrow {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative arrow glyph paired with adjacent button text */
  font-size: 1.0625rem;
}

.ann-tagline {
  color: rgb(44 62 80 / 30%);
  font-family: Outfit, sans-serif;
  font-size: 0.625rem;
  font-style: italic;
  letter-spacing: 0.06em;
}

:global(.dark) .ann-tagline {
  color: rgb(226 232 240 / 30%);
}
</style>
