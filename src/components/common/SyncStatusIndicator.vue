<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';

const syncStore = useSyncStore();
const { t } = useTranslation();

const statusConfig = computed(() => {
  // Save failure warning takes priority over normal ready state
  if (syncStore.saveFailureLevel === 'warning' || syncStore.saveFailureLevel === 'critical') {
    return {
      icon: 'save-warning',
      color: 'text-amber-500',
      title: t('googleDrive.saveRetrying'),
      animate: true,
    };
  }

  switch (syncStore.syncStatus) {
    case 'syncing':
      return {
        icon: 'sync',
        color: 'text-blue-500',
        title: 'Saving...',
        animate: true,
      };
    case 'error':
      return {
        icon: 'error',
        color: 'text-red-500',
        title: `Save error: ${syncStore.error}`,
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
    case 'ready': {
      const emailSuffix = syncStore.providerAccountEmail
        ? ` (${syncStore.providerAccountEmail})`
        : '';
      return {
        icon: 'check',
        color: 'text-green-500',
        title: `Data saved to ${syncStore.fileName}${emailSuffix}`,
        animate: false,
      };
    }
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
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt="Needs permission"
        class="relative h-5 w-5"
      />
    </div>

    <!-- Save warning icon (pulsing amber) -->
    <div v-else-if="statusConfig.icon === 'save-warning'" class="relative">
      <span class="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-30" />
      <svg
        class="relative h-5 w-5 text-amber-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.072 16.5c-.77.833.192 2.5 1.732 2.5z"
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
