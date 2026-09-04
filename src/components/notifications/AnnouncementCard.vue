<script setup lang="ts">
/**
 * The "letter card" row for an announcement (see `isAnnouncementCard`). A
 * calmer, paper-warm cousin of the celebratory `WhatsNewGiftCard` — same row
 * rhythm (chip + body-tap + right-edge pip), same brand language (Heritage
 * Orange gradient chip + orange-ink kicker), but a softer wash, a dialed-back
 * gradient ring, no sparkles, a cool-slate timeline, and a slim Heritage Orange
 * "ribbon" on the left edge that reads as "an addressed message." Reserves the
 * gift card's energy for what's-new releases; says "a note worth a moment" for
 * announcements. Emits the same events as a row.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useNotificationPresentation } from '@/composables/useNotificationPresentation';
import { getAnnouncement } from '@/content/announcements';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();
const emit = defineEmits<{ select: [id: string]; 'toggle-read': [id: string] }>();

const { t } = useTranslation();
const { title, summary, when } = useNotificationPresentation(() => props.notification);

const announcement = computed(() =>
  props.notification.sourceId ? getAnnouncement(props.notification.sourceId) : undefined
);
const icon = computed(() => announcement.value?.icon ?? '📣');
// `summary` is the resolved bilingual `kicker` (or empty); fall back to the
// generic kind label so the kicker line is always meaningful.
const kickerText = computed(() => summary.value || t('notifications.kindAnnouncement'));
</script>

<template>
  <div class="ann-card relative mx-2 flex items-center gap-3">
    <!-- Body: opens the detail -->
    <button
      type="button"
      class="relative z-[1] flex min-w-0 flex-1 items-center gap-3 py-3.5 pr-1 pl-4 text-left"
      @click="emit('select', notification.id)"
    >
      <span class="stamp" aria-hidden="true">{{ icon }}</span>
      <span class="min-w-0 flex-1">
        <span class="kicker">{{ kickerText }}</span>
        <span class="ann-title">{{ title }}</span>
        <span class="ann-when">{{ when }}</span>
      </span>
    </button>

    <!-- Read/unread pip (does NOT open the detail) -->
    <button
      type="button"
      class="relative z-[1] flex w-11 flex-shrink-0 items-center justify-center self-stretch"
      :aria-label="t(notification.read ? 'notifications.markUnread' : 'notifications.markAllRead')"
      :title="t(notification.read ? 'notifications.markUnread' : 'notifications.markAllRead')"
      @click="emit('toggle-read', notification.id)"
    >
      <span
        class="rounded-full transition-all"
        :class="
          notification.read
            ? 'dark:border-line-strong h-2.5 w-2.5 border-2 border-gray-300'
            : 'bg-primary-500 h-3 w-3 shadow-[0_0_0_4px_rgba(241,93,34,0.16)]'
        "
        :aria-label="notification.read ? '' : t('notifications.unread')"
      />
    </button>
  </div>
</template>

<style scoped>
.ann-card {
  background:
    radial-gradient(120% 120% at 0% 0%, rgb(255 255 255 / 65%), transparent 60%),
    linear-gradient(135deg, rgb(241 93 34 / 5%) 0%, rgb(230 126 34 / 7%) 100%);
  border-radius: 20px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 55%),
    0 4px 16px -10px rgb(44 62 80 / 18%);
  overflow: hidden;
}

/* The Heritage-Orange ribbon on the left edge — the key tell. Clipped by the
   card's rounded corners (overflow: hidden), so its ends follow the radius. */
.ann-card::before {
  background: linear-gradient(180deg, #f15d22, #e67e22);
  content: '';
  height: 100%;
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}

/* Dialed-back hairline gradient ring (vs the gift card's bolder 50/35). */
.ann-card::after {
  background: linear-gradient(135deg, rgb(241 93 34 / 35%), rgb(230 126 34 / 25%));
  border-radius: 20px;
  content: '';
  inset: 0;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  padding: 1px;
  pointer-events: none;
  position: absolute;
}

html.dark .ann-card {
  background:
    radial-gradient(120% 120% at 0% 0%, rgb(255 255 255 / 6%), transparent 60%),
    linear-gradient(135deg, rgb(241 93 34 / 10%) 0%, rgb(230 126 34 / 10%) 100%);
}

.stamp {
  background: linear-gradient(135deg, #f15d22, #e67e22);
  border-radius: 14px;
  box-shadow: 0 6px 16px -4px rgb(241 93 34 / 55%);
  display: grid;
  flex-shrink: 0;
  font-size: 1.25rem;
  height: 2.5rem;
  place-items: center;
  width: 2.5rem;
}

.kicker {
  color: #c84612;
  display: block;
  font-family: Outfit, sans-serif;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ann-title {
  -webkit-box-orient: vertical;
  color: #2c3e50;
  display: -webkit-box;
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 700;
  -webkit-line-clamp: 2;
  line-height: 1.3;
  margin-top: 0.125rem;
  overflow: hidden;
}

html.dark .ann-title {
  color: #f2f5f7;
}

.ann-when {
  color: rgb(44 62 80 / 55%);
  display: block;
  font-family: Outfit, sans-serif;
  font-size: 0.6875rem;
  font-weight: 600;
  margin-top: 0.3125rem;
}

html.dark .ann-when {
  color: rgb(226 232 240 / 55%);
}
</style>
