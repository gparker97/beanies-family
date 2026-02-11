<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';

const syncStore = useSyncStore();

const statusConfig = computed(() => {
  switch (syncStore.syncStatus) {
    case 'syncing':
      return {
        icon: 'sync',
        color: 'text-blue-500',
        title: 'Syncing...',
        animate: true,
      };
    case 'error':
      return {
        icon: 'error',
        color: 'text-red-500',
        title: `Sync error: ${syncStore.error}`,
        animate: false,
      };
    case 'needs-permission':
      return {
        icon: 'warning',
        color: 'text-yellow-500',
        title: 'Click to grant file permission and load latest data',
        animate: true,
        pulse: true,
      };
    case 'ready':
      return {
        icon: 'check',
        color: 'text-green-500',
        title: `Synced to ${syncStore.fileName}`,
        animate: false,
      };
    default:
      return null;
  }
});

async function handleClick() {
  if (syncStore.syncStatus === 'needs-permission') {
    await syncStore.requestPermission();
  }
}
</script>

<template>
  <button
    v-if="syncStore.isConfigured && statusConfig"
    class="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
    :title="statusConfig.title"
    @click="handleClick"
  >
    <!-- Sync icon (rotating when syncing) -->
    <svg
      v-if="statusConfig.icon === 'sync'"
      class="h-5 w-5"
      :class="[statusConfig.color, { 'animate-spin': statusConfig.animate }]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>

    <!-- Check icon (synced) -->
    <svg
      v-else-if="statusConfig.icon === 'check'"
      class="h-5 w-5"
      :class="statusConfig.color"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
      />
    </svg>

    <!-- Warning icon (needs permission) -->
    <div v-else-if="statusConfig.icon === 'warning'" class="relative">
      <!-- Pulsing background -->
      <span class="absolute inset-0 animate-ping rounded-full bg-yellow-400 opacity-30" />
      <svg
        class="relative h-5 w-5"
        :class="statusConfig.color"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    </div>

    <!-- Error icon -->
    <svg
      v-else-if="statusConfig.icon === 'error'"
      class="h-5 w-5"
      :class="statusConfig.color"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  </button>
</template>
