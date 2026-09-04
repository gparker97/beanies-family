<script setup lang="ts">
import { ref, onMounted } from 'vue';
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

const showBounce = ref(false);
onMounted(() => {
  showBounce.value = true;
});
</script>

<template>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div
        class="bg-primary-50 dark:bg-primary-900/30 flex h-10 w-10 items-center justify-center rounded-xl"
        :class="{ 'animate-beanie-bounce': showBounce }"
        @animationend="showBounce = false"
      >
        <BeanieIcon :name="icon" size="lg" class="text-primary-500" />
      </div>
      <div>
        <h1 class="font-outfit dark:text-ink text-2xl font-bold text-gray-900">
          {{ title }}
        </h1>
        <p v-if="subtitle" class="dark:text-ink-soft text-sm text-gray-500">
          {{ subtitle }}
        </p>
      </div>
    </div>
    <slot />
  </div>
</template>
