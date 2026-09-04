<script setup lang="ts">
/**
 * Notification detail view. For whats-new it hands the WHOLE detail area to
 * `WhatsNewBody` (a full celebratory hero + content + footer that manages its
 * own layout — no meta card, no Open/mark-unread). For task/activity kinds it
 * renders the default meta card with `Open` as the sole prominent primary and a
 * quiet `Mark unread` link beneath (read/unread is primarily a row-level toggle).
 */
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useNotificationPresentation } from '@/composables/useNotificationPresentation';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();

const router = useRouter();
const { t } = useTranslation();
const store = useNotificationsStore();
const { presentation, tintClass, labelKey, hasRichBody, title, summary, when, roleLabel } =
  useNotificationPresentation(() => props.notification);

function handleOpen() {
  if (!props.notification.route) return;
  router.push({ path: props.notification.route, query: props.notification.query });
  store.close();
}

function handleMarkUnread() {
  store.markUnread(props.notification.id);
}
</script>

<template>
  <!-- whats-new / announcement: a full celebratory body (manages its own hero + footer) -->
  <component :is="presentation.detailBody" v-if="hasRichBody" :notification="notification" />

  <!-- every other kind: meta card + actions -->
  <div v-else class="space-y-5">
    <div class="flex items-start gap-3">
      <span
        class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[16px] text-2xl"
        :class="tintClass"
        aria-hidden="true"
      >
        {{ presentation.icon }}
      </span>
      <div class="min-w-0 flex-1">
        <div
          class="font-outfit text-[0.6875rem] font-bold tracking-[0.06em] uppercase"
          :class="
            notification.overdue ? 'text-primary-600' : 'text-secondary-500/45 dark:text-ink-faint'
          "
        >
          {{ t(labelKey) }}
        </div>
        <h3 class="font-outfit text-secondary-500 dark:text-ink text-xl font-extrabold">
          {{ title }}
        </h3>
        <div
          class="font-outfit text-secondary-500/70 dark:text-ink-soft mt-0.5 text-sm font-semibold"
        >
          {{ when }}
        </div>
        <div
          v-if="summary"
          class="text-secondary-500/60 dark:text-ink-soft mt-2 flex flex-wrap items-center gap-1.5 text-sm"
        >
          <span>{{ summary }}</span>
          <span
            v-if="roleLabel"
            class="text-primary-600 bg-primary-500/12 font-outfit dark:text-accent-lift inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-bold"
          >
            🚗 {{ roleLabel }}
          </span>
        </div>
      </div>
    </div>

    <!-- Actions: Open is the sole prominent primary; mark-unread is a quiet link -->
    <div v-if="notification.route" class="space-y-2">
      <button
        type="button"
        class="from-primary-500 to-terracotta-400 font-outfit w-full rounded-2xl bg-gradient-to-r px-5 py-3.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(241,93,34,0.28)] transition-all hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(241,93,34,0.36)]"
        @click="handleOpen"
      >
        {{ t('notifications.open') }} →
      </button>
      <button
        type="button"
        class="text-secondary-500/40 hover:text-secondary-500/70 font-outfit dark:text-ink-faint mx-auto block text-xs font-medium transition-colors"
        @click="handleMarkUnread"
      >
        {{ t('notifications.markUnread') }}
      </button>
    </div>
    <!-- No deep-link (e.g. whats-new): just the quiet mark-unread link. -->
    <button
      v-else
      type="button"
      class="text-secondary-500/40 hover:text-secondary-500/70 font-outfit dark:text-ink-faint mx-auto block text-xs font-medium transition-colors"
      @click="handleMarkUnread"
    >
      {{ t('notifications.markUnread') }}
    </button>
  </div>
</template>
