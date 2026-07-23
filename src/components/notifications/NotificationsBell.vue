<script setup lang="ts">
/**
 * Header notification bell (#55) — the "beanie bell": the bell body IS a knitted
 * beanie cap (ribbed body, folded cuff = the rim, Heritage-Orange pom, slate
 * clapper). Stateless squircle-free button driving the shared `notificationsStore`
 * singleton, so every mount reflects the same unread state + toggles the same
 * drawer.
 *
 * Unread is signalled by warm orange→terracotta ringing lines (NOT a dot). A NEW
 * reminder fires a one-shot ring (bell-local watch on `unreadCount`/`isOpen`,
 * via the shared `useAttentionPulse`), suppressed under prefers-reduced-motion.
 * The pom greys when OS reminders are switched off in Settings.
 */
import { computed, ref, watch, nextTick } from 'vue';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useAttentionPulse } from '@/composables/useAttentionPulse';

const store = useNotificationsStore();
const settingsStore = useSettingsStore();
const { t } = useTranslation();
const { pulse } = useAttentionPulse();

const bellEl = ref<HTMLElement>();

// Pom greys when OS reminders are off (informational — the in-app drawer still works).
const pomColor = computed(() => (settingsStore.remindersEnabled ? '#F15D22' : '#94A3B8'));

// One-shot ring when a NEW reminder arrives while the drawer is closed. Purely
// presentational, so the edge lives here (not in the store).
let prevCount = store.unreadCount;
watch(
  () => store.unreadCount,
  (count) => {
    if (count > prevCount && !store.isOpen) {
      void nextTick(() => pulse(bellEl.value, 'bell-ring'));
    }
    prevCount = count;
  }
);

function toggle() {
  if (store.isOpen) store.close();
  else store.open();
}
</script>

<template>
  <button
    type="button"
    class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] text-gray-400 transition-colors hover:bg-black/5 dark:text-gray-500 dark:hover:bg-white/10"
    :aria-label="t('notifications.title')"
    @click="toggle"
  >
    <span ref="bellEl" class="inline-flex">
      <svg
        width="39"
        height="34"
        viewBox="0 0 46 40"
        fill="none"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <!-- cap/bell body -->
        <path
          d="M20 6C14.2 6 10.8 10.8 10.8 18c0 5.2-1.4 7.6-2.7 9.4-.7 1 0 2.5 1.2 2.5h21.4c1.2 0 1.9-1.5 1.2-2.5-1.3-1.8-2.7-4.2-2.7-9.4C29.2 10.8 25.8 6 20 6Z"
        />
        <!-- folded cuff = the bell rim -->
        <path d="M9.9 24.6c3.4 1.35 16.8 1.35 20.2 0" />
        <!-- knit ribs -->
        <path d="M20 7.6V24.3" stroke-opacity=".55" />
        <path d="M15.7 9V24.4" stroke-opacity=".45" />
        <path d="M24.3 9V24.4" stroke-opacity=".45" />
        <!-- clapper poking out (slate = currentColor) -->
        <path
          d="M20 30.2c-1.7 0-2.8 1.1-2.8 2.6a2.8 2.8 0 0 0 5.6 0c0-1.5-1.1-2.6-2.8-2.6Z"
          fill="currentColor"
          stroke="none"
        />
        <!-- pom (the one colour accent; greys when reminders are off) -->
        <circle cx="20" cy="4.4" r="2.1" :fill="pomColor" stroke="none" />
        <!-- unread → warm ringing lines (never a red dot) -->
        <template v-if="store.hasUnread">
          <path
            d="M34.5 17a7 7 0 0 1 0 10"
            stroke="#F15D22"
            :aria-label="t('notifications.unread')"
          />
          <path d="M38 14a11.5 11.5 0 0 1 0 16" stroke="#E67E22" />
        </template>
      </svg>
    </span>
  </button>
</template>
