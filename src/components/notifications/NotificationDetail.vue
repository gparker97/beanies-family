<script setup lang="ts">
/**
 * Notification detail view. Renders the per-kind `detailBody` from the table
 * (whats-new → WhatsNewBody) or a default meta card — no per-kind `v-if` ladder.
 * `Open` is the SOLE prominent primary action; `Mark unread` is a quiet text
 * link beneath it (read/unread is primarily a row-level toggle now, so the two
 * never compete).
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { getReleaseNote } from '@/content/release-notes';
import {
  NOTIFICATION_KIND_PRESENTATION,
  ACCENT_TINT_CLASS,
  kindLabelKey,
  notificationTitle,
  notificationSummary,
  notificationWhen,
  dutyRoleLabelKey,
} from '@/components/notifications/notificationKinds';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();

const router = useRouter();
const { t } = useTranslation();
const store = useNotificationsStore();

const presentation = computed(() => NOTIFICATION_KIND_PRESENTATION[props.notification.kind]);
const tintClass = computed(() => ACCENT_TINT_CLASS[presentation.value.accent]);
const labelKey = computed(() => kindLabelKey(props.notification.kind, props.notification.overdue));
const title = computed(() => notificationTitle(props.notification, t));
const summary = computed(() => notificationSummary(props.notification, t));
const when = computed(() => notificationWhen(props.notification, t));
const roleLabel = computed(() =>
  props.notification.dutyRole ? t(dutyRoleLabelKey(props.notification.dutyRole)) : ''
);
const release = computed(() =>
  props.notification.kind === 'whats-new' && props.notification.sourceId
    ? getReleaseNote(props.notification.sourceId)
    : undefined
);
const showCustomBody = computed(() => Boolean(presentation.value.detailBody && release.value));

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
  <div class="space-y-5">
    <!-- Custom per-kind body (whats-new) — or the default meta card -->
    <component :is="presentation.detailBody" v-if="showCustomBody" :release="release" />
    <div v-else class="flex items-start gap-3">
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
            notification.overdue ? 'text-primary-600' : 'text-secondary-500/45 dark:text-gray-500'
          "
        >
          {{ t(labelKey) }}
        </div>
        <h3 class="font-outfit text-secondary-500 text-xl font-extrabold dark:text-gray-100">
          {{ title }}
        </h3>
        <div
          class="font-outfit text-secondary-500/70 mt-0.5 text-sm font-semibold dark:text-gray-300"
        >
          {{ when }}
        </div>
        <div
          v-if="summary"
          class="text-secondary-500/60 mt-2 flex flex-wrap items-center gap-1.5 text-sm dark:text-gray-400"
        >
          <span>{{ summary }}</span>
          <span
            v-if="roleLabel"
            class="text-primary-600 bg-primary-500/12 font-outfit dark:text-primary-400 inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-bold"
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
        class="text-secondary-500/40 hover:text-secondary-500/70 font-outfit mx-auto block text-xs font-medium transition-colors dark:text-gray-500"
        @click="handleMarkUnread"
      >
        {{ t('notifications.markUnread') }}
      </button>
    </div>
    <!-- No deep-link (e.g. whats-new): just the quiet mark-unread link. -->
    <button
      v-else
      type="button"
      class="text-secondary-500/40 hover:text-secondary-500/70 font-outfit mx-auto block text-xs font-medium transition-colors dark:text-gray-500"
      @click="handleMarkUnread"
    >
      {{ t('notifications.markUnread') }}
    </button>
  </div>
</template>
