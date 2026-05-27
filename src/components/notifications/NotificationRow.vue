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
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  NOTIFICATION_KIND_PRESENTATION,
  ACCENT_TINT_CLASS,
  notificationTitle,
  notificationSummary,
  notificationWhen,
  dutyRoleLabelKey,
} from '@/components/notifications/notificationKinds';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();
const emit = defineEmits<{ select: [id: string]; 'toggle-read': [id: string] }>();

const { t } = useTranslation();

const presentation = computed(() => NOTIFICATION_KIND_PRESENTATION[props.notification.kind]);
const tintClass = computed(() => ACCENT_TINT_CLASS[presentation.value.accent]);
const title = computed(() => notificationTitle(props.notification, t));
const summary = computed(() => notificationSummary(props.notification, t));
const when = computed(() => notificationWhen(props.notification, t));
const roleLabel = computed(() =>
  props.notification.dutyRole ? t(dutyRoleLabelKey(props.notification.dutyRole)) : ''
);
</script>

<template>
  <div
    class="relative flex items-stretch transition-colors"
    :class="
      notification.read ? 'hover:bg-gray-50 dark:hover:bg-slate-700/30' : 'bg-primary-500/[0.045]'
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
        :class="tintClass"
        aria-hidden="true"
      >
        {{ presentation.icon }}
      </span>

      <span class="min-w-0 flex-1">
        <span
          class="font-outfit text-secondary-500 block truncate text-sm dark:text-gray-100"
          :class="notification.read ? 'font-medium opacity-75' : 'font-bold'"
        >
          {{ title }}
        </span>
        <span
          v-if="summary"
          class="text-secondary-500/60 mt-0.5 flex flex-wrap items-center gap-1.5 text-xs dark:text-gray-400"
        >
          <span class="truncate">{{ summary }}</span>
          <span
            v-if="roleLabel"
            class="text-primary-600 bg-primary-500/12 font-outfit dark:text-primary-400 inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[0.625rem] font-bold"
          >
            🚗 {{ roleLabel }}
          </span>
        </span>
        <span
          class="font-outfit mt-1 block text-[0.6875rem] font-semibold"
          :class="
            notification.overdue ? 'text-primary-600' : 'text-secondary-500/45 dark:text-gray-500'
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
            ? 'h-2.5 w-2.5 border-2 border-gray-300 dark:border-slate-500'
            : 'bg-primary-500 h-3 w-3 shadow-[0_0_0_4px_rgba(241,93,34,0.14)]'
        "
        :aria-label="notification.read ? '' : t('notifications.unread')"
      />
    </button>
  </div>
</template>
