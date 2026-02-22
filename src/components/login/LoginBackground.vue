<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#F8F9FA] via-[#FEF0E8] to-[#EBF5FD] p-4 dark:from-[#1a252f] dark:via-[#2C3E50] dark:to-[#1a252f]"
  >
    <div class="w-full max-w-[580px]">
      <div class="mb-8 text-center">
        <img
          src="/brand/beanies_celebrating_line_transparent_600x600.png"
          alt="beanies celebrating"
          class="mx-auto -mb-[7.5rem] w-full max-w-sm"
        />
        <h1 class="font-outfit text-5xl font-bold">
          <span class="text-secondary-500 dark:text-gray-100">beanies</span
          ><span class="text-primary-500">.family</span>
        </h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">{{ t('app.tagline') }}</p>
      </div>

      <slot />

      <slot name="below-card" />
    </div>
  </div>
</template>
