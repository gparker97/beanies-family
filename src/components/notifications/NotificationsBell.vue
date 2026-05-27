<script setup lang="ts">
/**
 * Header notification bell — a stateless squircle button driving the shared
 * `notificationsStore` singleton (so every mount — AppHeader desktop/mobile and
 * the planner command bar's reclaimed row — reflects the same unread state and
 * toggles the same drawer). Heritage Orange unread dot per the design-system
 * header spec (NEVER red for this calm indicator).
 */
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTranslation } from '@/composables/useTranslation';

const store = useNotificationsStore();
const { t } = useTranslation();

function toggle() {
  if (store.isOpen) store.close();
  else store.open();
}
</script>

<template>
  <button
    type="button"
    class="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors hover:bg-gray-50 dark:bg-slate-800 dark:shadow-none dark:hover:bg-slate-700"
    :aria-label="t('notifications.title')"
    @click="toggle"
  >
    <svg
      class="h-[18px] w-[18px] text-gray-400 dark:text-gray-500"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
    <span
      v-if="store.hasUnread"
      class="bg-primary-500 absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-800"
      :aria-label="t('notifications.unread')"
    />
  </button>
</template>
