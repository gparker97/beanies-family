<script setup lang="ts">
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import SyncStatusIndicator from '@/components/common/SyncStatusIndicator.vue';

const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

const currentMember = computed(() => familyStore.currentMember);

function toggleTheme() {
  const newTheme = settingsStore.theme === 'dark' ? 'light' : 'dark';
  settingsStore.setTheme(newTheme);
}
</script>

<template>
  <header class="h-16 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 flex items-center justify-between">
    <!-- Left side - Page title or breadcrumb -->
    <div>
      <slot name="left">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          <slot name="title" />
        </h2>
      </slot>
    </div>

    <!-- Right side - User actions -->
    <div class="flex items-center gap-4">
      <!-- Sync status indicator -->
      <SyncStatusIndicator />

      <!-- Theme toggle -->
      <button
        type="button"
        class="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
        @click="toggleTheme"
      >
        <!-- Sun icon -->
        <svg
          v-if="settingsStore.theme === 'dark'"
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
        <!-- Moon icon -->
        <svg
          v-else
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </button>

      <!-- Profile dropdown -->
      <div class="flex items-center gap-3">
        <div
          v-if="currentMember"
          class="flex items-center gap-2"
        >
          <!-- Avatar -->
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
            :style="{ backgroundColor: currentMember.color || '#3b82f6' }"
          >
            {{ currentMember.name.charAt(0).toUpperCase() }}
          </div>
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ currentMember.name }}
          </span>
        </div>
      </div>
    </div>
  </header>
</template>
