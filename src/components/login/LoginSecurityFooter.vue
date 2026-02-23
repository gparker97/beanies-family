<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <div class="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 opacity-40">
    <!-- End-to-End Encrypted -->
    <div class="flex items-center gap-1.5">
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
      <span class="text-[0.65rem] font-medium text-[#2C3E50] dark:text-gray-300">{{
        t('loginV6.badgeEncrypted')
      }}</span>
    </div>

    <!-- Bank-Grade Security -->
    <div class="flex items-center gap-1.5">
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
      <span class="text-[0.65rem] font-medium text-[#2C3E50] dark:text-gray-300">{{
        t('loginV6.badgeSecurity')
      }}</span>
    </div>

    <!-- Built with Love -->
    <div class="flex items-center gap-1.5">
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
      <span class="text-[0.65rem] font-medium text-[#2C3E50] dark:text-gray-300">{{
        t('loginV6.badgeLove')
      }}</span>
    </div>

    <!-- Zero Data on Our Servers -->
    <div class="flex items-center gap-1.5">
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
        />
      </svg>
      <span class="text-[0.65rem] font-medium text-[#2C3E50] dark:text-gray-300">{{
        t('loginV6.badgeZeroServers')
      }}</span>
    </div>
  </div>
</template>
