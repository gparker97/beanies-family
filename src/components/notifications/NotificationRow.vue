<script setup lang="ts">
/**
 * Notification list row — useful at a glance: emoji (kind) · bold title (the
 * thing) · summary (who · where, with a chip for your drop-off / pick-up duty) ·
 * the real date + time. Reads everything off `NOTIFICATION_KIND_PRESENTATION` +
 * the composition helpers — no per-kind logic here.
 *
 * Two separate actions: tapping the row body opens the detail (`select`);
 * tapping the right-edge pip toggles read/unread without opening (`toggle-read`).
 */
import { useTranslation } from '@/composables/useTranslation';
import { useNotificationPresentation } from '@/composables/useNotificationPresentation';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();
const emit = defineEmits<{ select: [id: string]; 'toggle-read': [id: string] }>();

const { t } = useTranslation();
const { presentation, tintClass, title, summary, when, roleLabel } = useNotificationPresentation(
  () => props.notification
);
</script>

<template>
  <div
    class="relative flex items-stretch transition-colors"
    :class="
      notification.read
        ? 'dark:hover:bg-surface-hover/30 hover:bg-gray-50'
        : 'bg-primary-500/[0.045]'
    "
  >
    <!-- Body: opens the detail -->
    <button
      type="button"
      class="flex min-w-0 flex-1 items-start gap-3 py-3 pr-1 pl-4 text-left"
      @click="emit('select', notification.id)"
    >
      <span
        class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[13px] text-lg"
        :class="
          notification.kind === 'whats-new'
            ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br'
            : tintClass
        "
        aria-hidden="true"
      >
        {{ presentation.icon }}
      </span>

      <span class="min-w-0 flex-1">
        <span
          class="font-outfit text-secondary-500 dark:text-ink block truncate text-sm"
          :class="notification.read ? 'font-medium opacity-75' : 'font-bold'"
        >
          {{ title }}
        </span>
        <span
          v-if="summary"
          class="text-secondary-500/60 dark:text-ink-soft mt-0.5 flex flex-wrap items-center gap-1.5 text-xs"
        >
          <span class="truncate">{{ summary }}</span>
          <span
            v-if="roleLabel"
            class="text-primary-600 bg-primary-500/12 font-outfit dark:text-accent-lift inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[0.625rem] font-bold"
          >
            🚗 {{ roleLabel }}
          </span>
        </span>
        <span
          class="font-outfit mt-1 block text-[0.6875rem] font-semibold"
          :class="
            notification.overdue ? 'text-primary-600' : 'text-secondary-500/45 dark:text-ink-faint'
          "
        >
          {{ when }}
        </span>
      </span>
    </button>

    <!-- Read/unread pip toggle (does NOT open the detail) -->
    <button
      type="button"
      class="flex w-11 flex-shrink-0 items-center justify-center"
      :aria-label="t(notification.read ? 'notifications.markUnread' : 'notifications.markAllRead')"
      :title="t(notification.read ? 'notifications.markUnread' : 'notifications.markAllRead')"
      @click="emit('toggle-read', notification.id)"
    >
      <span
        class="rounded-full transition-all"
        :class="
          notification.read
            ? 'dark:border-line-strong h-2.5 w-2.5 border-2 border-gray-300'
            : 'bg-primary-500 h-3 w-3 shadow-[0_0_0_4px_rgba(241,93,34,0.14)]'
        "
        :aria-label="notification.read ? '' : t('notifications.unread')"
      />
    </button>
  </div>
</template>
