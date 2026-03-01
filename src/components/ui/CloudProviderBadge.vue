<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

const props = withDefaults(
  defineProps<{
    providerType: 'local' | 'google_drive' | null;
    fileName?: string | null;
    accountEmail?: string | null;
    size?: 'xs' | 'sm' | 'md';
    variant?: 'light' | 'dark';
  }>(),
  {
    fileName: null,
    accountEmail: null,
    size: 'sm',
    variant: 'light',
  }
);

const { t } = useTranslation();

const iconClass = computed(() => {
  const sizeMap = { xs: 'h-3 w-3', sm: 'h-3 w-3', md: 'h-3.5 w-3.5' };
  return `${sizeMap[props.size]} flex-shrink-0`;
});

const textClass = computed(() => {
  const sizeMap = { xs: 'text-xs', sm: 'text-xs', md: 'text-sm' };
  const colorMap = {
    light: 'text-gray-500 dark:text-gray-400',
    dark: 'text-white/30',
  };
  return `${sizeMap[props.size]} ${colorMap[props.variant]}`;
});

const emailClass = computed(() => {
  const sizeMap = { xs: 'text-xs', sm: 'text-xs', md: 'text-xs' };
  const colorMap = {
    light: 'text-gray-400 dark:text-gray-500',
    dark: 'text-white/20',
  };
  return `${sizeMap[props.size]} ${colorMap[props.variant]}`;
});

const driveIconColor = computed(() => {
  return props.variant === 'dark' ? 'text-white/30' : 'text-blue-500';
});

const localIconColor = computed(() => {
  return props.variant === 'dark' ? 'text-white/30' : 'text-gray-400 dark:text-gray-500';
});

const tooltip = computed(() => {
  if (props.providerType === 'google_drive' && props.accountEmail) {
    return t('googleDrive.connectedAs').replace('{email}', props.accountEmail);
  }
  return props.fileName ?? undefined;
});

const isGoogleDrive = computed(() => props.providerType === 'google_drive');
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1" :title="tooltip">
    <!-- Google Drive icon -->
    <svg
      v-if="isGoogleDrive"
      :class="[iconClass, driveIconColor]"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path
        d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"
      />
    </svg>
    <!-- Folder icon for local files -->
    <svg
      v-else-if="providerType === 'local'"
      :class="[iconClass, localIconColor]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
    <!-- File icon fallback (sidebar/hamburger style) -->
    <svg
      v-else
      :class="[iconClass, localIconColor]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
    <!-- Filename -->
    <span v-if="fileName" :class="textClass" class="truncate">{{ fileName }}</span>
    <!-- Account email separator + email -->
    <template v-if="isGoogleDrive && accountEmail">
      <span :class="emailClass">&middot;</span>
      <span :class="emailClass" class="truncate">{{ accountEmail }}</span>
    </template>
  </span>
</template>
