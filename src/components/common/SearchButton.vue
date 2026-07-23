<script setup lang="ts">
/**
 * Global-search affordance — the squircle magnifier button plus its own
 * `GlobalSearch` overlay and `showSearch` state, self-contained. Extracted from
 * `AppHeader` so the planner's reclaimed mobile command bar can offer search
 * (which lives ONLY in the header today) by reusing the SAME component rather
 * than copying the button + overlay wiring into a second place. Only one
 * instance is ever live at a time (the header and the reclaimed command bar are
 * mutually exclusive via `useHeaderReclaimed`), so `GlobalSearch` never
 * double-mounts.
 */
import { ref } from 'vue';
import GlobalSearch from '@/components/common/GlobalSearch.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const showSearch = ref(false);
</script>

<template>
  <!-- #55: bigger, circle-less glyph (matches the notification bell) — the 40px
       flex box stays the tap target, only the visible magnifier grows. -->
  <button
    type="button"
    class="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-[14px] text-gray-400 transition-colors hover:bg-black/5 dark:text-gray-500 dark:hover:bg-white/10"
    :aria-label="t('search.placeholder')"
    @click="showSearch = true"
  >
    <svg
      class="text-gray-400 dark:text-gray-500"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-3.6-3.6" />
    </svg>
  </button>

  <GlobalSearch :open="showSearch" @close="showSearch = false" />
</template>
