<script setup lang="ts">
/**
 * The celebratory "gift card" row for a SPOTLIGHT what's-new (see
 * `isCelebratoryWhatsNew`). Every other notification is a chore; this one is a
 * gift, so it gets a soft Heritage Orange → Terracotta wash, a hairline gradient
 * ring, a ✨ gradient medallion, and a couple of quiet twinkles — while keeping
 * the row rhythm (same body-tap = open, same right-edge read/unread pip).
 *
 * Minor (non-spotlight) what's-new notes are NOT rendered here — they stay a flat
 * `NotificationRow` with the ✨ gradient chip. Emits the same events as a row.
 */
import { useTranslation } from '@/composables/useTranslation';
import { useNotificationPresentation } from '@/composables/useNotificationPresentation';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();
const emit = defineEmits<{ select: [id: string]; 'toggle-read': [id: string] }>();

const { t } = useTranslation();
const { summary, when } = useNotificationPresentation(() => props.notification);
</script>

<template>
  <div class="wn-card relative mx-2 flex items-center gap-3">
    <span class="spark spark-1" aria-hidden="true">✦</span>
    <span class="spark spark-2" aria-hidden="true">✦</span>

    <!-- Body: opens the detail -->
    <button
      type="button"
      class="relative z-[1] flex min-w-0 flex-1 items-center gap-3 py-3.5 pr-1 pl-4 text-left"
      @click="emit('select', notification.id)"
    >
      <span class="gift" aria-hidden="true">✨</span>
      <span class="min-w-0 flex-1">
        <span class="kicker">{{ t('notifications.kindWhatsNew') }}</span>
        <span class="wn-title">{{ summary }}</span>
        <span class="wn-when">{{ when }}</span>
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
            ? 'h-2.5 w-2.5 border-2 border-gray-300 dark:border-slate-500'
            : 'bg-primary-500 h-3 w-3 shadow-[0_0_0_4px_rgba(241,93,34,0.16)]'
        "
        :aria-label="notification.read ? '' : t('notifications.unread')"
      />
    </button>
  </div>
</template>

<style scoped>
.wn-card {
  background:
    radial-gradient(120% 120% at 0% 0%, rgb(255 255 255 / 50%), transparent 55%),
    linear-gradient(135deg, rgb(241 93 34 / 13%) 0%, rgb(230 126 34 / 13%) 100%);
  border-radius: 20px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 60%),
    0 6px 20px -10px rgb(241 93 34 / 45%);
  overflow: hidden;
}

/* hairline gradient ring */
.wn-card::after {
  background: linear-gradient(135deg, rgb(241 93 34 / 50%), rgb(230 126 34 / 35%));
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

:global(.dark) .wn-card {
  background:
    radial-gradient(120% 120% at 0% 0%, rgb(255 255 255 / 8%), transparent 55%),
    linear-gradient(135deg, rgb(241 93 34 / 18%) 0%, rgb(230 126 34 / 16%) 100%);
}

.gift {
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

.wn-title {
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

:global(.dark) .wn-title {
  color: #ecf0f1;
}

.wn-when {
  color: rgb(200 70 18 / 70%);
  display: block;
  font-family: Outfit, sans-serif;
  font-size: 0.6875rem;
  font-weight: 600;
  margin-top: 0.3125rem;
}

/* twinkles — decorative, motion-safe */
.spark {
  color: #e67e22;
  font-size: 0.625rem;
  opacity: 0.6;
  pointer-events: none;
  position: absolute;
}

.spark-1 {
  right: 3rem;
  top: 0.5rem;
}

.spark-2 {
  bottom: 0.625rem;
  font-size: 0.4375rem;
  opacity: 0.45;
  right: 4.25rem;
}

@media (prefers-reduced-motion: no-preference) {
  .spark {
    animation: wn-twinkle 2.4s ease-in-out infinite;
  }

  .spark-2 {
    animation-delay: 1.1s;
  }
}

@keyframes wn-twinkle {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
</style>
