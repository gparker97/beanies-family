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
  <button
    type="button"
    class="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors hover:bg-gray-50 dark:bg-slate-800 dark:shadow-none dark:hover:bg-slate-700"
    :aria-label="t('search.placeholder')"
    @click="showSearch = true"
  >
    <svg
      class="h-[18px] w-[18px] text-gray-400 dark:text-gray-500"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </button>

  <GlobalSearch :open="showSearch" @close="showSearch = false" />
</template>
