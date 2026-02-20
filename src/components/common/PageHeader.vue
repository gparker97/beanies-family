<script setup lang="ts">
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

interface Props {
  /** BeanieIcon name (should match sidebar nav icon for consistency) */
  icon: string;
  /** Page title text */
  title: string;
  /** Optional subtitle text */
  subtitle?: string;
}

defineProps<Props>();
</script>

<template>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div
        class="bg-primary-50 dark:bg-primary-900/30 flex h-10 w-10 items-center justify-center rounded-xl"
      >
        <BeanieIcon :name="icon" size="lg" class="text-primary-500" />
      </div>
      <div>
        <h1 class="font-outfit text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ title }}
        </h1>
        <p v-if="subtitle" class="text-sm text-gray-500 dark:text-gray-400">
          {{ subtitle }}
        </p>
      </div>
    </div>
    <slot />
  </div>
</template>
